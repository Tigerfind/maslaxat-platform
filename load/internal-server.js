const express = require('../backend/api/node_modules/express');
const sharedApp = require('../backend/api/src/server');
const loadTestRouter = require('../backend/api/src/routes/load-test');
const { sequelize } = require('../backend/api/src/models');
const { assertLoadSeedEnvironment } = require('../backend/api/src/seeds/load-seed');

function createInternalLoadApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/load-test', loadTestRouter);
  app.use(sharedApp);
  return app;
}

async function startInternalLoadServer(env = process.env) {
  assertLoadSeedEnvironment(env);
  await sequelize.authenticate();
  const host = env.LOAD_TEST_BIND_HOST || '127.0.0.1';
  const port = Number(env.LOAD_TEST_PORT || env.PORT || 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('LOAD_TEST_PORT must be a valid port');
  }
  return createInternalLoadApp().listen(port, host);
}

module.exports = { createInternalLoadApp, startInternalLoadServer };

if (require.main === module) {
  startInternalLoadServer().catch(async (error) => {
    process.stderr.write(`Internal load server failed: ${error.message}\n`);
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
}
