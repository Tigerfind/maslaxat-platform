const express = require('express');
const request = require('supertest');

const {
  assertHarnessActivation,
  createE2ETestRouter,
  fingerprintIdentity,
} = require('../src/routes/e2e-test');
const { createE2EFixtureRuntime } = require('../src/e2e/fixture-runtime');

const env = {
  NODE_ENV: 'test',
  E2E_TEST_API_ENABLED: '1',
  E2E_DATABASE_URL: 'postgres://localhost/maslaxat_e2e',
  E2E_TEST_DB_CONFIRM: 'maslaxat_e2e',
  E2E_TEST_HOST_CONFIRM: 'localhost',
  E2E_TEST_API_TOKEN: 'test-bearer-token',
  E2E_TEST_API_SECRET: 'test-secret-header',
  E2E_DB_ATTESTATION_SECRET: 'database-attestation-secret',
  E2E_SAFETY_ATTESTATION_NONCE: 'nonce-0123456789',
  E2E_PAYME_MODE: 'disabled',
  E2E_CLAUDE_MODE: 'disabled',
  E2E_SMTP_MODE: 'stubbed',
  E2E_PUSH_MODE: 'disabled',
  E2E_JOBS_MODE: 'disabled',
};
const auth = {
  authorization: 'Bearer test-bearer-token',
  'x-e2e-test-secret': 'test-secret-header',
  'x-e2e-safety-nonce': 'nonce-0123456789',
};
const identity = {
  database: 'maslaxat_e2e', role: 'e2e_runner', address: '127.0.0.1', port: 5432,
};
const sequelize = { query: jest.fn(async () => [[identity]]) };

function appFor(fixtures) {
  const app = express();
  app.use(express.json());
  app.use('/api/e2e', createE2ETestRouter({ env, fixtures, sequelize }));
  return app;
}

test.each([
  [{ ...env, NODE_ENV: 'production' }, /test or staging/],
  [{ ...env, E2E_TEST_API_ENABLED: '0' }, /enabled/],
  [{ ...env, E2E_TEST_DB_CONFIRM: 'production' }, /confirmation/],
  [{ ...env, E2E_TEST_HOST_CONFIRM: 'production.internal' }, /host confirmation/],
])('E2E API refuses unsafe activation %#', (candidate, expected) => {
  expect(() => assertHarnessActivation(candidate)).toThrow(expected);
});

test('attestation is authenticated, nonce-bound, and reports the live application database', async () => {
  const fixtures = { capabilities: jest.fn() };
  const url = '/api/e2e/integrations/status?runId=run-abc123&nonce=nonce-0123456789';

  expect((await request(appFor(fixtures)).get(url)).status).toBe(401);
  const response = await request(appFor(fixtures)).get(url).set(auth);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    safe: true,
    runId: 'run-abc123',
    nonce: 'nonce-0123456789',
    integrations: { payme: 'disabled', claude: 'disabled', smtp: 'stubbed', push: 'disabled', jobs: 'disabled' },
    providerSecretsPresent: false,
    databaseFingerprint: fingerprintIdentity(identity, 'nonce-0123456789', env.E2E_DB_ATTESTATION_SECRET),
  });
});

test('actual model runtime exposes exact deterministic IDs and idempotent scoped cleanup', async () => {
  const seeded = [];
  const cleaned = [];
  const seedModule = {
    dataset: (runId) => ({
      runId,
      actors: {
        client: { id: `${runId}-client`, email: `${runId}.client@test`, password: 'secret' },
        otherClient: { id: `${runId}-attacker`, email: `${runId}.attacker@test`, password: 'secret' },
        lawyer: { id: `${runId}-lawyer`, email: `${runId}.lawyer@test`, password: 'secret' },
        admin: { id: `${runId}-admin`, email: `${runId}.admin@test`, password: 'secret' },
      },
      resources: {
        documentId: `${runId}-document`,
        otherConsultationId: `${runId}-private-consultation`,
        consultationId: `${runId}-call-consultation`,
        importId: `${runId}-import`,
        packageId: `${runId}-package`,
      },
    }),
    seed: jest.fn(async ({ env: scopedEnv }) => {
      seeded.push(scopedEnv.E2E_RUN_ID);
      return seedModule.dataset(scopedEnv.E2E_RUN_ID);
    }),
    cleanup: jest.fn(async ({ env: scopedEnv }) => {
      cleaned.push(scopedEnv.E2E_RUN_ID);
      return { cleaned: true };
    }),
  };
  const fixtures = createE2EFixtureRuntime({ env, seedModule });
  const app = appFor(fixtures);
  const capability = await request(app).get('/api/e2e/capabilities?runId=run-abc123').set(auth);
  const token = capability.body.fixtures.cleanupToken;
  const scope = 'run-abc123-chromium-r0-0123456789abcdef';
  const scopedAuth = { ...auth, 'x-e2e-run-token': token };
  const body = { scope, ownerMarker: `e2e:run-abc123:${scope}`, project: 'chromium', retry: 0 };

  expect(capability.status).toBe(200);
  expect(capability.body.fixtures).toMatchObject({
    clientUserId: 'run-abc123-client',
    lawyerUserId: 'run-abc123-lawyer',
    attackerUserId: 'run-abc123-attacker',
    privateDocumentId: 'run-abc123-document',
    privateConsultationId: 'run-abc123-private-consultation',
    callConsultationId: 'run-abc123-call-consultation',
  });
  expect((await request(app).post('/api/e2e/runs/run-abc123/fixtures').set(scopedAuth).send(body)).status).toBe(201);
  expect((await request(app).post('/api/e2e/runs/run-abc123/fixtures').set(scopedAuth).send(body)).status).toBe(200);
  expect(seeded).toEqual([scope]);
  expect((await request(app).delete(`/api/e2e/runs/run-abc123/fixtures/${scope}`).set(scopedAuth)).status).toBe(204);
  expect((await request(app).delete(`/api/e2e/runs/run-abc123/fixtures/${scope}`).set(scopedAuth)).status).toBe(204);
  expect(cleaned).toEqual([scope, scope]);
});
