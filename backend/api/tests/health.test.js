const express = require('express');
const request = require('supertest');

function appFor(overrides = {}) {
  const { createHealthRouter } = require('../src/routes/health');
  const app = express();
  app.use('/api', createHealthRouter({
    probes: {
      database: async () => true,
      redis: async () => true,
      objectStorage: async () => true,
      migrations: async () => true,
      ...overrides.probes,
    },
    lifecycle: overrides.lifecycle || { isReady: () => true },
    dependencyTimeoutMs: overrides.dependencyTimeoutMs || 25,
    totalTimeoutMs: overrides.totalTimeoutMs || 40,
  }));
  return app;
}

test.each(['/api/live', '/api/health'])('%s remains live when dependencies fail', async (path) => {
  const response = await request(appFor({
    probes: { redis: async () => { throw new Error('redis secret'); } },
  })).get(path);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'live' });
});

test('readiness probes dependencies concurrently and returns failed names only', async () => {
  const started = [];
  const response = await request(appFor({
    probes: {
      database: async () => { started.push('database'); throw new Error('postgres secret'); },
      redis: async () => { started.push('redis'); throw new Error('redis secret'); },
      objectStorage: async () => { started.push('objectStorage'); return true; },
      migrations: async () => { started.push('migrations'); return true; },
    },
  })).get('/api/ready');

  expect(started.sort()).toEqual(['database', 'objectStorage', 'redis']);
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'not_ready', failed: ['database', 'redis'] });
  expect(JSON.stringify(response.body)).not.toMatch(/secret|postgres/i);
});

test('migration-only readiness failure reports migrations without database', async () => {
  const migrations = jest.fn(async () => { throw new Error('pending migration secret'); });
  const response = await request(appFor({ probes: { migrations } })).get('/api/ready');

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'not_ready', failed: ['migrations'] });
  expect(migrations).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(response.body)).not.toContain('secret');
});

test('database-only readiness failure skips migration and reports database once', async () => {
  const migrations = jest.fn(async () => true);
  const response = await request(appFor({
    probes: {
      database: async () => { throw new Error('database unavailable'); },
      migrations,
    },
  })).get('/api/ready');

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'not_ready', failed: ['database'] });
  expect(migrations).not.toHaveBeenCalled();
});

test('database success runs migration probe and reports ready when both succeed', async () => {
  const database = jest.fn(async () => true);
  const migrations = jest.fn(async () => true);
  const response = await request(appFor({ probes: { database, migrations } })).get('/api/ready');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ready' });
  expect(database).toHaveBeenCalledTimes(1);
  expect(migrations).toHaveBeenCalledTimes(1);
  expect(database.mock.invocationCallOrder[0]).toBeLessThan(migrations.mock.invocationCallOrder[0]);
});

test('default probes attribute migration-state failure only to migrations', async () => {
  const { createReadinessProbes } = require('../src/routes/health');
  const sequelize = {
    transaction: async (operation) => operation({ LOCK: {} }),
    query: async () => [[], {}],
  };
  const probes = createReadinessProbes({
    sequelize,
    getRedis: () => ({ isReady: true, ping: async () => 'PONG' }),
    getObjectStorage: () => ({ checkReady: async () => true }),
    assertMigrationState: async () => { throw new Error('pending'); },
  });

  const response = await request(appFor({ probes })).get('/api/ready');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'not_ready', failed: ['migrations'] });
});

test('default probes skip migration-state work when SELECT 1 fails', async () => {
  const { createReadinessProbes } = require('../src/routes/health');
  const assertMigrationState = jest.fn(async () => true);
  const sequelize = {
    transaction: async (operation) => operation({ LOCK: {} }),
    query: async (sql) => {
      if (sql === 'SELECT 1') throw new Error('database down');
      return [[], {}];
    },
  };
  const probes = createReadinessProbes({
    sequelize,
    getRedis: () => ({ isReady: true, ping: async () => 'PONG' }),
    getObjectStorage: () => ({ checkReady: async () => true }),
    assertMigrationState,
  });

  const response = await request(appFor({ probes })).get('/api/ready');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ status: 'not_ready', failed: ['database'] });
  expect(assertMigrationState).not.toHaveBeenCalled();
});

test('readiness bounds hung probes and refuses traffic during shutdown', async () => {
  const startedAt = Date.now();
  const hung = () => new Promise(() => {});
  const timed = await request(appFor({
    probes: { database: hung, objectStorage: hung },
    dependencyTimeoutMs: 20,
    totalTimeoutMs: 30,
  })).get('/api/ready');

  expect(Date.now() - startedAt).toBeLessThan(200);
  expect(timed.status).toBe(503);
  expect(timed.body.failed).toEqual(['database', 'objectStorage']);

  const shuttingDown = await request(appFor({
    lifecycle: { isReady: () => false },
  })).get('/api/ready');
  expect(shuttingDown.status).toBe(503);
  expect(shuttingDown.body).toEqual({ status: 'not_ready', failed: ['shutdown'] });
});

test('readiness aborts a timed-out dependency operation instead of leaving it accumulated', async () => {
  let aborts = 0;
  const response = await request(appFor({
    probes: {
      objectStorage: ({ signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborts += 1;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      }),
    },
    dependencyTimeoutMs: 20,
    totalTimeoutMs: 30,
  })).get('/api/ready');

  expect(response.status).toBe(503);
  expect(response.body.failed).toContain('objectStorage');
  expect(aborts).toBe(1);
});

test('database readiness uses a local statement timeout and closes its transaction', async () => {
  const { createReadinessProbes } = require('../src/routes/health');
  const events = [];
  const sequelize = {
    async transaction(operation) {
      events.push('begin');
      try {
        return await operation({ id: 'health-tx' });
      } finally {
        events.push('closed');
      }
    },
    async query(sql, options) {
      events.push([sql, options.transaction?.id, options.replacements?.timeoutMs]);
      return [[], {}];
    },
  };
  const probes = createReadinessProbes({
    sequelize,
    getRedis: () => ({ isReady: true, ping: async () => 'PONG' }),
    getObjectStorage: () => ({ checkReady: async () => true }),
    assertMigrationState: async () => true,
    statementTimeoutMs: 900,
  });

  await expect(probes.database({ signal: new AbortController().signal })).resolves.toBe(true);
  expect(events).toEqual([
    'begin',
    ['SET LOCAL statement_timeout = :timeoutMs', 'health-tx', 900],
    ['SELECT 1', 'health-tx', undefined],
    'closed',
  ]);
});

test('repeated timed-out readiness calls share one pending database acquisition until it settles', async () => {
  const { createReadinessProbes } = require('../src/routes/health');
  let release;
  let acquisitions = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const sequelize = {
    transaction: jest.fn(() => {
      acquisitions += 1;
      return pending;
    }),
    query: jest.fn(),
  };
  const probes = createReadinessProbes({
    sequelize,
    getRedis: () => ({ isReady: true, ping: async () => 'PONG' }),
    getObjectStorage: () => ({ checkReady: async () => true }),
    assertMigrationState: async () => true,
  });
  const app = appFor({ probes, dependencyTimeoutMs: 10, totalTimeoutMs: 15 });

  expect((await request(app).get('/api/ready')).status).toBe(503);
  expect((await request(app).get('/api/ready')).status).toBe(503);
  expect(acquisitions).toBe(1);

  release(true);
  await pending;
  await Promise.resolve();
  await request(app).get('/api/ready');
  expect(acquisitions).toBe(3);
});

test('object storage readiness uses HeadBucket with the private bucket', async () => {
  const sent = [];
  const { createObjectStorage } = require('../src/services/objectStorage');
  const storage = createObjectStorage({
    bucket: 'private-files',
    client: { send: async (command) => { sent.push(command); return {}; } },
  });

  await expect(storage.checkReady()).resolves.toBe(true);
  expect(sent).toHaveLength(1);
  expect(sent[0].constructor.name).toBe('HeadBucketCommand');
  expect(sent[0].input).toEqual({ Bucket: 'private-files' });
});
