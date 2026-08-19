const { runSeed } = require('./helpers/seed-process');
const { cleanupPrivateResources } = require('./helpers/private-cleanup');
const { validateSeedState } = require('./fixtures/contracts');
const { request } = require('@playwright/test');

module.exports = async function globalTeardown() {
  const api = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
  if (process.env.E2E_TEST_API_ENABLED === '1') {
    const runId = process.env.E2E_RUN_ID;
    const scope = process.env.E2E_FIXTURE_SCOPE;
    const response = await fetch(`${api}/e2e/runs/${encodeURIComponent(runId)}/fixtures/${encodeURIComponent(scope)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${process.env.E2E_TEST_API_TOKEN}`,
        'x-e2e-test-secret': process.env.E2E_TEST_API_SECRET,
        'x-e2e-safety-nonce': process.env.E2E_SAFETY_ATTESTATION_NONCE,
        'x-e2e-run-token': process.env.E2E_FIXTURE_CLEANUP_TOKEN,
      },
    });
    if (!response.ok && response.status !== 404) throw new Error(`E2E fixture cleanup failed with HTTP ${response.status}`);
    return;
  }
  const state = validateSeedState(process.env.E2E_SEED_STATE
    ? JSON.parse(process.env.E2E_SEED_STATE)
    : await runSeed('describe'));
  let applicationError;
  const cleanupRequest = await request.newContext();
  try {
    await cleanupPrivateResources({ request: cleanupRequest, apiUrl: api, state });
  } catch (error) {
    applicationError = error;
  } finally {
    await cleanupRequest.dispose();
  }
  await runSeed('cleanup');
  if (applicationError) throw applicationError;
};
