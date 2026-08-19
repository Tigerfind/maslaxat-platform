require('dotenv').config();
const { loadEnv } = require('./config/env');

// Validate before importing logger, models, routes, sockets, or integrations. Those modules
// initialize clients and capture environment values during import.
const env = loadEnv(process.env);
const Sentry = require('@sentry/node');
const { exitAfterFatal, reportCaughtException, setupSentryHandler } = require('./instrument');

const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const models = require('./models');
const { sequelize } = models;
const { assertMigrationState, initializeDatabase } = require('./db/assertMigrationState');
const { runStartup } = require('./startup');
const { assertAuthorizationStartup } = require('./services/authorizationCutover');
const { deriveRuntimeAuthorizationIdentity } = require('./services/authorizationRuntimeIdentity');
const { setAuthorizationRuntimeIdentity } = require('./services/authorizationRuntime');
const { connectRedis, getRedis, closeRedis } = require('./config/redis');
const { createHealthRouter, createReadinessProbes } = require('./routes/health');
const { createProductionJobs } = require('./services/productionJobs');
const { createServerLifecycle, installShutdownHandlers } = require('./serverLifecycle');
const { errorHandler } = require('./middleware/errorHandler');
const { requestContext } = require('./middleware/requestContext');
const { initSignaling } = require('./socket/signaling');
const logger = require('./config/logger');
const { initializeMountedAuthorizationInventory } = require('./config/authorizationSurfaces');
const { getFileStorageService, getObjectStorageService } = require('./services/fileStorageRuntime');
const createUsersRouter = require('./routes/users');
const createCaseDocumentsRouter = require('./routes/case-documents');
const createDocumentsRouter = require('./routes/documents');
const createAdminPortalRouter = require('./routes/admin-portal');
const createLawyerPortalRouter = require('./routes/lawyer-portal');
const { createAuthorizationMetadataRouter } = require('./routes/authorization-metadata');

const app = express();
const server = http.createServer(app);
const PORT = env.port;
const fileStorageService = getFileStorageService();
const usersRouter = createUsersRouter({ fileStorageService });
const caseDocumentsRouter = createCaseDocumentsRouter({ fileStorageService });
const documentsRouter = createDocumentsRouter({ fileStorageService });
const adminPortalRouter = createAdminPortalRouter({ fileStorageService });
const lawyerPortalRouter = createLawyerPortalRouter({ fileStorageService });

// За реверс-прокси (Railway/облако) доверяем ОДНОМУ хопу прокси, чтобы
// req.ip и express-rate-limit корректно читали X-Forwarded-For и не падали с
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. Точное число хопов (1), а не true —
// иначе express-rate-limit ругается на слишком доверчивую настройку.
app.set('trust proxy', env.production ? 1 : false);

// Socket.io for WebRTC signaling
const corsOrigins = env.cors.origins;

const io = new SocketIO(server, {
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
});
initSignaling(io);
require('./socket/io').setIO(io); // реестр для realtime-уведомлений
const jobs = createProductionJobs({
  onError(error, name) {
    reportCaughtException(error, { operation: 'scheduled_job', jobId: name });
    logger.error('scheduled_job_failed', { jobId: name });
  },
});
const redisAdapter = require('./socket/redisAdapter');
const lifecycle = createServerLifecycle({
  server,
  io,
  jobs,
  closeAdapter: redisAdapter.closeRedisAdapter,
  closeRedis,
  sequelize,
  sentry: Sentry,
});

// Security
app.use(requestContext);
app.use(helmet());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Health endpoints precede the global limiter so probes cannot be throttled by application traffic.
app.use('/api', createHealthRouter({
  lifecycle,
  probes: createReadinessProbes({
    sequelize,
    getRedis,
    getObjectStorage: getObjectStorageService,
    assertMigrationState,
  }),
}));

// Rate limiting
const isDev = env.nodeEnv === 'development';

// Общий лимит: щедрый для SPA (много запросов на загрузку страницы), в dev — отключён
app.use('/api/', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 1000,
  message: { error: 'Слишком много запросов, попробуйте позже' },
  skip: () => isDev,
}));

// Строгий лимит на аутентификацию — защита от подбора пароля (действует и в проде, и в dev)
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || (isDev ? 100 : 20),
  message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
  skipSuccessfulRequests: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// The fixture API is part of the actual application process so its safety attestation
// proves the same live database identity used by Playwright and k6.
if (process.env.E2E_TEST_API_ENABLED === '1') {
  const { assertIntegrationSafety, createE2ETestRouter } = require('./routes/e2e-test');
  const { createE2EFixtureRuntime } = require('./e2e/fixture-runtime');
  assertIntegrationSafety(process.env);
  app.use('/api/e2e', createE2ETestRouter({
    env: process.env,
    fixtures: createE2EFixtureRuntime({ env: process.env, models }),
    sequelize,
  }));
}

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, 'http_request', {
      method: req.method,
      pathname: req.path,
      route: req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null,
      statusCode: res.statusCode,
      durationMs: ms,
      userId: req.userId || null,
    });
  });
  next();
});

// Serve uploaded files — ТОЛЬКО аватары (публичные). Приватные документы НЕ отдаём
// напрямую (они доступны лишь через авторизованный GET /api/documents/:id/download).
// БЕЗОПАСНОСТЬ: без этого фильтра юр-документы утекали по угадываемым именам файлов.
app.use('/uploads', (req, res, next) => {
  if (!/^\/avatar-[\w.-]+$/.test(req.path)) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }
  next();
}, express.static(process.env.UPLOAD_DIR || './uploads'));

// API Routes
if (env.authorization.metadataToken) {
  app.use('/api/internal/authorization-metadata', createAuthorizationMetadataRouter({
    token: env.authorization.metadataToken,
  }));
}
app.use('/api/auth', require('./routes/auth'));
app.use('/api/account', require('./routes/account'));
app.use('/api/users', usersRouter);
app.use('/api/client/users', usersRouter);
app.use('/api/lawyers', require('./routes/lawyers'));
app.use('/api/consultations', require('./routes/consultations'));
// Рабочие документы по делу (участник = клиент или юрист консультации). Отдельный
// роутер: подпути /:id/documents не пересекаются с маршрутами consultations.js.
app.use('/api/consultations', caseDocumentsRouter);
app.use('/api/ai', require('./routes/ai'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/documents', documentsRouter);
app.use('/api/client/documents', documentsRouter);
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/client/notifications', require('./routes/notifications'));
app.use('/api/push', require('./routes/push'));
app.use('/api/2fa', require('./routes/twofa'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/client/chat', require('./routes/chat'));
app.use('/api/video', require('./routes/video'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/client/favorites', require('./routes/favorites'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api', require('./routes/promotions').router);
app.use('/api/support', require('./routes/support'));
app.use('/api/promo', require('./routes/promo'));
app.use('/api/client/promo', require('./routes/promo'));

// Client-facing routes (frontend compatibility)
// Dashboard: frontend calls /api/client/dashboard/stats → rewrite to /client/stats
app.use('/api/client/dashboard', (req, res, next) => {
  // /stats → /client/stats, /activity → /client/activity
  if (!req.path.startsWith('/client/') && !req.path.startsWith('/lawyer/') && !req.path.startsWith('/admin/')) {
    req.url = '/client' + req.url;
  }
  next();
}, require('./routes/dashboard'));

// Consultations: direct pass-through
app.use('/api/client/consultations', require('./routes/consultations'));

// Lawyers search: frontend calls /api/client/lawyers/search → rewrite
app.use('/api/client/lawyers', require('./routes/lawyers'));

// AI chat: frontend calls /api/client/ai-chat/message → router has /chat/message
app.use('/api/client/ai-chat', (req, res, next) => {
  if (!req.path.startsWith('/chat/')) {
    req.url = '/chat' + req.url;
  }
  next();
}, require('./routes/ai'));

// Admin routes — dedicated endpoints
app.use('/api/admin', adminPortalRouter);
app.use('/api/admin/dashboard', (req, res, next) => {
  if (!req.path.startsWith('/admin/')) {
    req.url = '/admin' + req.url;
  }
  next();
}, require('./routes/dashboard'));

// Lawyer portal routes — dedicated endpoints
app.use('/api/lawyer/imports', require('./routes/lawyer-imports'));
app.use('/api/lawyer', lawyerPortalRouter);
app.use('/api/lawyer/dashboard', (req, res, next) => {
  if (!req.path.startsWith('/lawyer/')) {
    req.url = '/lawyer' + req.url;
  }
  next();
}, require('./routes/dashboard'));

// Freeze the exact mounted authorization surface set after every alias/router is registered.
initializeMountedAuthorizationInventory(app);

// Error handling
setupSentryHandler(app);
app.use(errorHandler);

// 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Start
async function start({ restoreSmoke = false, databaseUrl = null } = {}) {
  if (databaseUrl && databaseUrl !== process.env.DATABASE_URL) {
    throw new Error('Restore smoke database does not match process DATABASE_URL');
  }
  const migrationState = await runStartup({
    initializeDatabase: async () => {
      const state = await initializeDatabase({ sequelize, production: env.production || restoreSmoke });
      logger.info('PostgreSQL ready', state || { schemaMode: 'development_sync' });
      return state;
    },
    authorize: async (migrationState) => {
      const runtimeIdentity = deriveRuntimeAuthorizationIdentity({ env: process.env, migrationState });
      await assertAuthorizationStartup({ config: env.authorization, runtimeIdentity });
      setAuthorizationRuntimeIdentity(runtimeIdentity);
    },
    seed: async () => {
      if (restoreSmoke) return;
      if (process.env.RUN_SEED !== '1') return;
      try {
        const { runProdSeed } = require('./seeds/prod-seed');
        const res = await runProdSeed();
        logger.info('Prod seed applied', res);
      } catch (error) {
        reportCaughtException(error, { operation: 'production_seed_startup' });
        logger.error('production_seed_startup_failed');
      }
    },
    connectRedis,
    attachRedisAdapter: () => redisAdapter.attachRedisAdapter(io),
    listen: () => new Promise((resolve) => {
      server.listen(restoreSmoke ? 0 : PORT, restoreSmoke ? '127.0.0.1' : '0.0.0.0', () => {
        const listeningPort = server.address().port;
        logger.info(`eMaslaxat API running on port ${listeningPort}`, { port: listeningPort, env: env.nodeEnv });
        resolve();
      });
    }),
    startJobs: async () => {
      if (!restoreSmoke && process.env.E2E_JOBS_MODE !== 'disabled') jobs.start();
      lifecycle.markReady();
    },
    onFatal: restoreSmoke
      ? async (error) => { throw error; }
      : (error) => exitAfterFatal(error, { operation: 'server_startup' }, { logger }),
  });
  return {
    migrationState,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

// Автозапуск только при прямом запуске (`node src/server.js`).
// При импорте из тестов (supertest) сервер НЕ слушает порт — тесты сами управляют БД.
if (require.main === module) {
  installShutdownHandlers(lifecycle);
  start();
}

module.exports = app;
module.exports.start = start;
module.exports.shutdown = (signal = 'RESTORE_SMOKE') => lifecycle.shutdown(signal, { exitProcess: false });
