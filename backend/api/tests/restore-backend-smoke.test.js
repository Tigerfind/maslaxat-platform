const express = require('express');
const http = require('http');
const { createHealthRouter } = require('../src/routes/health');
const { probeApplication, runRestoreBackendSmoke } = require('../src/scripts/restoreBackendSmoke');

async function createRuntime({ failedDependency = null, coreStatus = 200 } = {}) {
  let ready = false;
  let server;
  const app = express();
  const probes = Object.fromEntries(
    ['database', 'redis', 'objectStorage', 'migrations'].map((name) => [name, async () => {
      if (name === failedDependency) throw new Error('unavailable');
    }]),
  );
  app.use('/api', createHealthRouter({ probes, lifecycle: { isReady: () => ready } }));
  app.get('/api/lawyers', (_req, res) => res.status(coreStatus).json({ lawyers: [] }));
  return {
    events: [],
    async start(options) {
      this.events.push(['start', options]);
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      ready = true;
      return {
        migrationState: { appliedCount: 42 },
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      };
    },
    async shutdown() {
      this.events.push(['shutdown']);
      ready = false;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('restore smoke owns the application lifecycle and probes actual live, dependency-ready, and core routes', async () => {
  const runtime = await createRuntime();
  const result = await runRestoreBackendSmoke({
    databaseUrl: 'postgres://restore@isolated/emaslaxat_restore_drill_unit',
    loadRuntime: () => runtime,
  });
  expect(result).toEqual({ migrationState: 'ok', readiness: 'ok', apiSmoke: 'ok', appliedCount: 42 });
  expect(runtime.events).toEqual([
    ['start', { restoreSmoke: true, databaseUrl: 'postgres://restore@isolated/emaslaxat_restore_drill_unit' }],
    ['shutdown'],
  ]);
});

test.each([
  ['dependency readiness', { failedDependency: 'redis' }, 'ready'],
  ['core API', { coreStatus: 503 }, 'core'],
])('restore smoke fails on %s and still shuts the lifecycle down', async (_name, setup, message) => {
  const runtime = await createRuntime(setup);
  await expect(runRestoreBackendSmoke({
    databaseUrl: 'postgres://restore@isolated/emaslaxat_restore_drill_unit',
    loadRuntime: () => runtime,
  })).rejects.toThrow(message);
  expect(runtime.events.at(-1)).toEqual(['shutdown']);
});

test('probeApplication uses the current health payload instead of the obsolete OK/service payload', async () => {
  const runtime = await createRuntime();
  const started = await runtime.start({ restoreSmoke: true });
  await expect(probeApplication(started.baseUrl)).resolves.toEqual({ live: 'live', ready: 'ready', core: 'ok' });
  await runtime.shutdown();
});
