const { assertSafeTarget, requireReady } = require('./helpers/http');
const { runSeed } = require('./helpers/seed-process');
const { validateSeedState } = require('./fixtures/contracts');
const { cleanupPrivateResources } = require('./helpers/private-cleanup');
const { request } = require('@playwright/test');

const fixtureHeaders = () => ({
  authorization: `Bearer ${process.env.E2E_TEST_API_TOKEN}`,
  'x-e2e-test-secret': process.env.E2E_TEST_API_SECRET,
  'x-e2e-safety-nonce': process.env.E2E_SAFETY_ATTESTATION_NONCE,
});

async function prepareApplicationFixtures(api) {
  const runId = process.env.E2E_RUN_ID;
  if (!/^[a-z0-9][a-z0-9-]{4,47}$/.test(runId || '')) throw new Error('E2E_RUN_ID must satisfy the application lifecycle contract');
  const capabilityResponse = await fetch(`${api}/e2e/capabilities?runId=${encodeURIComponent(runId)}`, {
    headers: fixtureHeaders(),
  });
  if (!capabilityResponse.ok) throw new Error(`E2E capability request failed with HTTP ${capabilityResponse.status}`);
  const capability = await capabilityResponse.json();
  process.env.E2E_FIXTURE_CLEANUP_TOKEN = capability.fixtures.cleanupToken;
}

module.exports = async function globalSetup() {
  const frontend = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
  const api = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
  assertSafeTarget({ frontendUrl: frontend, apiUrl: api });
  await runSeed('verify');
  await Promise.all([
    requireReady(frontend, 'frontend'),
    requireReady(`${api}/ready`, 'API readiness'),
  ]);
  if (process.env.E2E_TEST_API_ENABLED === '1') {
    await prepareApplicationFixtures(api);
    return;
  }
  const staleState = validateSeedState(await runSeed('describe'));
  const cleanupRequest = await request.newContext();
  try {
    await cleanupPrivateResources({ request: cleanupRequest, apiUrl: api, state: staleState });
  } finally {
    await cleanupRequest.dispose();
  }
  const state = validateSeedState(await runSeed('seed'));
  process.env.E2E_SEED_STATE = JSON.stringify(state);
};
