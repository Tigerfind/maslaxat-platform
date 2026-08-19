const crypto = require('node:crypto');

function createFixtureScope(runId, testInfo) {
  const project = testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const titlePath = typeof testInfo.titlePath === 'function' ? testInfo.titlePath() : testInfo.titlePath;
  const identity = [testInfo.file, ...(titlePath || [])].join('|');
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16);
  const scope = `${runId}-${project}-r${testInfo.retry}-${digest}`;
  if (!/^[a-z0-9][a-z0-9-]{4,63}$/.test(scope)) throw new Error('Remote fixture scope is invalid');
  return scope;
}

function headers(config) {
  return {
    authorization: `Bearer ${config.token}`,
    'x-e2e-test-secret': config.secret,
    'x-e2e-safety-nonce': config.nonce,
    'x-e2e-run-token': config.cleanupToken,
  };
}

async function allocateRemoteFixture(request, config, testInfo) {
  const scope = createFixtureScope(config.runId, testInfo);
  const response = await request.post(`${config.apiUrl}/e2e/runs/${encodeURIComponent(config.runId)}/fixtures`, {
    headers: headers(config),
    data: {
      scope,
      ownerMarker: `e2e:${config.runId}:${scope}`,
      project: testInfo.project.name,
      retry: testInfo.retry,
    },
  });
  if (!response.ok()) throw new Error(`E2E fixture allocation failed with HTTP ${response.status()}`);
  return { ...(await response.json()), scope };
}

async function cleanupRemoteFixture(request, config, scope) {
  const response = await request.delete(
    `${config.apiUrl}/e2e/runs/${encodeURIComponent(config.runId)}/fixtures/${encodeURIComponent(scope)}`,
    { headers: headers(config) },
  );
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`E2E fixture cleanup failed with HTTP ${response.status()}`);
  }
}

module.exports = { allocateRemoteFixture, cleanupRemoteFixture, createFixtureScope };
