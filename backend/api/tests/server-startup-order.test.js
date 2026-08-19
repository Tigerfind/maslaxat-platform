const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

test('production environment validation runs before application dependencies are imported', () => {
  const apiRoot = path.join(__dirname, '..');
  const script = `
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'express' || request === 'socket.io' || request.endsWith('/models') || request.includes('/routes/')) {
        throw new Error('EARLY_IMPORT:' + request);
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      require('./src/server');
    } catch (error) {
      process.stdout.write(error.name + ':' + error.message);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      JWT_SECRET: '',
    },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^EnvConfigError:Invalid environment variables:/);
  expect(result.stdout).toContain('JWT_SECRET');
  expect(result.stdout).not.toContain('EARLY_IMPORT');
});

test('Sentry instrumentation loads before Express, Sequelize models, routes, and sockets', () => {
  const apiRoot = path.join(__dirname, '..');
  const script = `
    const Module = require('module');
    const originalLoad = Module._load;
    let instrumented = false;
    Module._load = function (request, parent, isMain) {
      if (request === './instrument') instrumented = true;
      if (request === 'express' || request.endsWith('/models') || request.includes('/routes/') || request.includes('/socket/')) {
        if (!instrumented) throw new Error('OBSERVABILITY_LATE:' + request);
        throw new Error('ORDER_CONFIRMED');
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      require('./src/server');
    } catch (error) {
      process.stdout.write(error.message);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ORDER_CONFIRMED');
  expect(result.stdout).not.toContain('OBSERVABILITY_LATE');
});

test('ordinary Jest isolates provider env and uses TEST_DB_NAME for runtime and CLI', () => {
  const apiRoot = path.join(__dirname, '..');
  const script = `
    require('./tests/env.setup');
    const cliConfig = require('./src/config/db-cli');
    process.stdout.write(JSON.stringify({
      merchantId: process.env.PAYME_MERCHANT_ID,
      hasPaymeKey: Object.prototype.hasOwnProperty.call(process.env, 'PAYME_KEY'),
      hasV2Mode: Object.prototype.hasOwnProperty.call(process.env, 'PAYMENT_V2_MODE'),
      hasSentryBackendDsn: Object.prototype.hasOwnProperty.call(process.env, 'SENTRY_BACKEND_DSN'),
      databaseUrl: process.env.DATABASE_URL,
      databaseName: process.env.DB_NAME,
      cliDatabaseName: cliConfig.test.database,
    }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PAYME_MERCHANT_ID: 'developer-live-merchant',
      PAYME_KEY: 'developer-live-key',
      PAYMENT_V2_MODE: 'active',
      SENTRY_BACKEND_DSN: 'https://public@example.ingest.sentry.io/1',
      DATABASE_URL: 'postgresql://developer:secret@production.internal:5432/live',
      TEST_DB_NAME: 'emaslaxat_session_a_a1_isolation',
    },
  });

  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    merchantId: 'test-merchant-id',
    hasPaymeKey: false,
    hasV2Mode: false,
    hasSentryBackendDsn: false,
    databaseUrl: undefined,
    databaseName: 'emaslaxat_session_a_a1_isolation',
    cliDatabaseName: 'emaslaxat_session_a_a1_isolation',
  });
});

test('server startup delegates orchestration and has no legacy production mutation path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  expect(source).toContain('await runStartup({');
  expect(source).toContain('await initializeDatabase({ sequelize, production: env.production || restoreSmoke })');
  expect(source).toMatch(/if \(require\.main === module\) \{[\s\S]*installShutdownHandlers\(lifecycle\)/);
  expect(source).not.toMatch(/sequelize\.sync\s*\(/);
  expect(source).not.toContain('ensure-prod-indexes');
  expect(source).not.toContain('ensureProdIndexes');
  expect(source).toContain('probes: createReadinessProbes({');
  expect(source).toContain('getObjectStorage: getObjectStorageService');
});
