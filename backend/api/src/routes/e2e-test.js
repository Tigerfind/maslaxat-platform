const crypto = require('node:crypto');
const express = require('express');

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,47}$/;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]{4,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const INTEGRATION_MODES = {
  E2E_PAYME_MODE: 'disabled',
  E2E_CLAUDE_MODE: 'disabled',
  E2E_SMTP_MODE: 'stubbed',
  E2E_PUSH_MODE: 'disabled',
  E2E_JOBS_MODE: 'disabled',
};
const PROVIDER_SECRETS = [
  'PAYME_KEY', 'PAYME_MERCHANT_ID', 'ANTHROPIC_API_KEY',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'VAPID_PRIVATE_KEY',
];

function secureEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function assertHarnessActivation(env) {
  const targetEnv = String(env.NODE_ENV || '').toLowerCase();
  if (!['test', 'staging'].includes(targetEnv)) throw new Error('E2E test API requires NODE_ENV exactly test or staging');
  if (env.E2E_TEST_API_ENABLED !== '1') throw new Error('E2E test API is not enabled');
  let database;
  try {
    const url = new URL(env.E2E_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    database = { name: decodeURIComponent(url.pathname.replace(/^\//, '')), host: url.hostname.toLowerCase() };
  } catch (error) {
    throw new Error('E2E_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!database.name.endsWith('_e2e')) throw new Error('E2E fixture database name must end in _e2e');
  if (env.E2E_TEST_DB_CONFIRM !== database.name) throw new Error('E2E database confirmation must exactly match');
  if (env.E2E_TEST_HOST_CONFIRM !== database.host) throw new Error('E2E host confirmation must exactly match');
  const deniedHosts = String(env.E2E_PRODUCTION_DB_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (deniedHosts.some((host) => database.host === host || database.host.endsWith(`.${host}`))) {
    throw new Error('E2E database host is production-denied');
  }
  if (!env.E2E_TEST_API_TOKEN || !env.E2E_TEST_API_SECRET || !env.E2E_DB_ATTESTATION_SECRET) {
    throw new Error('E2E test API credentials and database attestation secret are required');
  }
  if (!NONCE_PATTERN.test(env.E2E_SAFETY_ATTESTATION_NONCE || '')) throw new Error('E2E safety nonce is required');
  return { databaseName: database.name, hostname: database.host, targetEnv };
}

function assertIntegrationSafety(env) {
  const activation = assertHarnessActivation(env);
  const violations = Object.entries(INTEGRATION_MODES)
    .filter(([name, expected]) => env[name] !== expected)
    .map(([name, expected]) => `${name}=${expected}`);
  PROVIDER_SECRETS.forEach((name) => { if (env[name]) violations.push(`${name} must be empty`); });
  if (violations.length) throw new Error(`Unsafe E2E integrations: ${violations.join(', ')}`);
  return activation;
}

async function databaseIdentity(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT current_database() AS database,
           current_user AS role,
           COALESCE(inet_server_addr()::text, 'local') AS address,
           COALESCE(inet_server_port(), 0) AS port
  `);
  const identity = rows && rows[0];
  if (!identity?.database || !identity?.role) throw new Error('Unable to identify live E2E database');
  return identity;
}

function fingerprintIdentity(identity, nonce, secret) {
  const payload = ['e2e-db-v1', nonce, identity.database, identity.address, identity.port].join('\n');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function assertLiveDatabaseSafety(env, sequelize, nonce) {
  const activation = assertHarnessActivation(env);
  const identity = await databaseIdentity(sequelize);
  if (identity.database !== activation.databaseName) throw new Error('Live database does not match E2E confirmation');
  const fingerprint = fingerprintIdentity(identity, nonce, env.E2E_DB_ATTESTATION_SECRET);
  const denied = String(env.E2E_PRODUCTION_DB_FINGERPRINTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (denied.includes(fingerprint)) throw new Error('E2E database fingerprint is production-denied');
  return fingerprint;
}

function authorize(env) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!secureEqual(token, env.E2E_TEST_API_TOKEN)
      || !secureEqual(req.get('x-e2e-test-secret'), env.E2E_TEST_API_SECRET)
      || !secureEqual(req.get('x-e2e-safety-nonce'), env.E2E_SAFETY_ATTESTATION_NONCE)) {
      return res.status(401).json({ error: 'E2E test API authentication required' });
    }
    return next();
  };
}

function createE2ETestRouter({ env = process.env, fixtures, sequelize }) {
  assertIntegrationSafety(env);
  if (!fixtures || !sequelize) throw new Error('E2E fixture runtime and live database are required');
  const router = express.Router();
  router.use(authorize(env));
  router.use(async (req, res, next) => {
    try {
      assertIntegrationSafety(env);
      req.e2eDatabaseFingerprint = await assertLiveDatabaseSafety(env, sequelize, req.get('x-e2e-safety-nonce'));
      return next();
    } catch (error) {
      return res.status(503).json({ error: error.message, code: 'UNSAFE_E2E_TARGET' });
    }
  });
  router.get('/integrations/status', (req, res) => {
    const { runId, nonce } = req.query;
    if (!RUN_ID_PATTERN.test(runId || '') || !NONCE_PATTERN.test(nonce || '')
      || !secureEqual(nonce, req.get('x-e2e-safety-nonce'))) {
      return res.status(400).json({ error: 'Valid runId and nonce are required' });
    }
    return res.json({
      safe: true,
      runId,
      nonce,
      integrations: {
        payme: env.E2E_PAYME_MODE,
        claude: env.E2E_CLAUDE_MODE,
        smtp: env.E2E_SMTP_MODE,
        push: env.E2E_PUSH_MODE,
        jobs: env.E2E_JOBS_MODE,
      },
      providerSecretsPresent: false,
      databaseFingerprint: req.e2eDatabaseFingerprint,
    });
  });
  router.get('/capabilities', async (req, res, next) => {
    try {
      if (!RUN_ID_PATTERN.test(req.query.runId || '')) return res.status(400).json({ error: 'Invalid E2E run ID' });
      return res.json(await fixtures.capabilities(req.query.runId));
    } catch (error) { return next(error); }
  });
  router.post('/runs/:runId/fixtures', async (req, res, next) => {
    try {
      if (!RUN_ID_PATTERN.test(req.params.runId || '')) return res.status(400).json({ error: 'Invalid E2E run ID' });
      const result = await fixtures.allocate(req.params.runId, req.body, req.get('x-e2e-run-token'));
      return res.status(result.created ? 201 : 200).json(result.fixture);
    } catch (error) { return next(error); }
  });
  router.delete('/runs/:runId/fixtures/:scope', async (req, res, next) => {
    try {
      if (!RUN_ID_PATTERN.test(req.params.runId || '') || !SCOPE_PATTERN.test(req.params.scope || '')) {
        return res.status(400).json({ error: 'Invalid E2E lifecycle ID' });
      }
      await fixtures.cleanupScope(req.params.runId, req.params.scope, req.get('x-e2e-run-token'));
      return res.status(204).end();
    } catch (error) { return next(error); }
  });
  router.delete('/runs/:runId', async (req, res, next) => {
    try {
      await fixtures.cleanupRun(req.params.runId, req.get('x-e2e-run-token'));
      return res.status(204).end();
    } catch (error) { return next(error); }
  });
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
  return router;
}

module.exports = {
  assertHarnessActivation,
  assertIntegrationSafety,
  assertLiveDatabaseSafety,
  createE2ETestRouter,
  fingerprintIdentity,
  INTEGRATION_MODES,
  PROVIDER_SECRETS,
};
