const { assertSafeTarget, requireReady } = require('./helpers/http');
const { runSeed } = require('./helpers/seed-process');
const { validateSeedState } = require('./fixtures/contracts');
const { cleanupPrivateResources } = require('./helpers/private-cleanup');
const { request } = require('@playwright/test');
const crypto = require('node:crypto');

const fixtureHeaders = () => ({
  authorization: `Bearer ${process.env.E2E_TEST_API_TOKEN}`,
  'x-e2e-test-secret': process.env.E2E_TEST_API_SECRET,
  'x-e2e-safety-nonce': process.env.E2E_SAFETY_ATTESTATION_NONCE,
});

async function seedThroughApplication(api) {
  const runId = process.env.E2E_RUN_ID;
  if (!/^[a-z0-9][a-z0-9-]{4,47}$/.test(runId || '')) throw new Error('E2E_RUN_ID must satisfy the application lifecycle contract');
  const capabilityResponse = await fetch(`${api}/e2e/capabilities?runId=${encodeURIComponent(runId)}`, {
    headers: fixtureHeaders(),
  });
  if (!capabilityResponse.ok) throw new Error(`E2E capability request failed with HTTP ${capabilityResponse.status}`);
  const capability = await capabilityResponse.json();
  const digest = crypto.createHash('sha256').update(`${runId}:playwright-suite`).digest('hex').slice(0, 16);
  const scope = `${runId}-suite-r0-${digest}`;
  const response = await fetch(`${api}/e2e/runs/${encodeURIComponent(runId)}/fixtures`, {
    method: 'POST',
    headers: {
      ...fixtureHeaders(),
      'content-type': 'application/json',
      'x-e2e-run-token': capability.fixtures.cleanupToken,
    },
    body: JSON.stringify({ scope, ownerMarker: `e2e:${runId}:${scope}`, project: 'suite', retry: 0 }),
  });
  if (!response.ok) throw new Error(`E2E fixture allocation failed with HTTP ${response.status}`);
  const fixture = await response.json();
  const state = validateSeedState(fixture.seedState);
  process.env.E2E_FIXTURE_SCOPE = scope;
  process.env.E2E_FIXTURE_CLEANUP_TOKEN = capability.fixtures.cleanupToken;
  return state;
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
    const state = await seedThroughApplication(api);
    process.env.E2E_SEED_STATE = JSON.stringify(state);
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
