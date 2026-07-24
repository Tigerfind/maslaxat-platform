require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { sequelize } = require('./models');
const { connectRedis } = require('./config/redis');
const { errorHandler } = require('./middleware/errorHandler');
const { initSignaling } = require('./socket/signaling');
const logger = require('./config/logger');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// Socket.io for WebRTC signaling
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

const io = new SocketIO(server, {
  cors: {
    origin: corsOrigins,
    credentials: true,
  },
});
initSignaling(io);
require('./socket/io').setIO(io); // реестр для realtime-уведомлений

// Security
app.use(helmet());
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Rate limiting
const isDev = process.env.NODE_ENV === 'development';

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

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`, {
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'emaslaxat-api',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/client/users', require('./routes/users'));
app.use('/api/lawyers', require('./routes/lawyers'));
app.use('/api/consultations', require('./routes/consultations'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/client/documents', require('./routes/documents'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/client/notifications', require('./routes/notifications'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/client/chat', require('./routes/chat'));
app.use('/api/video', require('./routes/video'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/client/favorites', require('./routes/favorites'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/support', require('./routes/support'));

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
app.use('/api/admin', require('./routes/admin-portal'));
app.use('/api/admin/dashboard', (req, res, next) => {
  if (!req.path.startsWith('/admin/')) {
    req.url = '/admin' + req.url;
  }
  next();
}, require('./routes/dashboard'));

// Lawyer portal routes — dedicated endpoints
app.use('/api/lawyer', require('./routes/lawyer-portal'));
app.use('/api/lawyer/dashboard', (req, res, next) => {
  if (!req.path.startsWith('/lawyer/')) {
    req.url = '/lawyer' + req.url;
  }
  next();
}, require('./routes/dashboard'));

// Error handling
app.use(errorHandler);

// 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.originalUrl });
});

// Start
async function start() {
  try {
    await sequelize.authenticate();
    logger.info('PostgreSQL connected');

    // Sync models (use { alter: true } in dev, nothing in prod)
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
      logger.info('Models synced');
    }

    await connectRedis();

    // Redis-адаптер для Socket.io (масштаб на >1 инстанс) — по флагу SOCKET_REDIS=1
    await require('./socket/redisAdapter').attachRedisAdapter(io);

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`eMaslaxat API running on port ${PORT}`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
      });
      // Фоновая задача: напоминания за 1 час до консультации
      require('./services/reminderService').startReminderJob();
    });
  } catch (error) {
    logger.error('Failed to start server', { stack: error.stack });
    process.exit(1);
  }
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

start();
