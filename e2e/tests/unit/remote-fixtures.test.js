const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allocateRemoteFixture,
  cleanupRemoteFixture,
  createFixtureScope,
} = require('../../helpers/remote-fixtures');

test('remote fixture scopes differ by project and retry while remaining run-owned', () => {
  const chromium = createFixtureScope('q-123-1', {
    file: 'tests/auth-modes.spec.js', project: { name: 'chromium' }, retry: 0, titlePath: ['auth', 'login'],
  });
  const firefox = createFixtureScope('q-123-1', {
    file: 'tests/auth-modes.spec.js', project: { name: 'firefox' }, retry: 0, titlePath: ['auth', 'login'],
  });
  const retry = createFixtureScope('q-123-1', {
    file: 'tests/auth-modes.spec.js', project: { name: 'chromium' }, retry: 1, titlePath: ['auth', 'login'],
  });

  assert.match(chromium, /^q-123-1-chromium-r0-[a-f0-9]{16}$/);
  assert.notEqual(chromium, firefox);
  assert.notEqual(chromium, retry);
  assert.ok(chromium.length <= 64);
});

test('allocation and cleanup use the exact lifecycle scope and cleanup token', async () => {
  const calls = [];
  const request = {
    post: async (url, options) => {
      calls.push(['post', url, options]);
      return { ok: () => true, json: async () => ({ seedState: { runId: 'scope' } }) };
    },
    delete: async (url, options) => {
      calls.push(['delete', url, options]);
      return { ok: () => true };
    },
  };
  const config = {
    apiUrl: 'https://api.staging.example/api', runId: 'q-123-1', cleanupToken: 'cleanup-token',
    token: 'bearer', secret: 'secret', nonce: 'nonce-12345678',
  };
  const info = { file: 'a.spec.js', project: { name: 'webkit' }, retry: 0, titlePath: ['flow'] };

  const fixture = await allocateRemoteFixture(request, config, info);
  await cleanupRemoteFixture(request, config, fixture.scope);

  assert.equal(calls[0][2].data.scope, fixture.scope);
  assert.equal(calls[0][2].data.ownerMarker, `e2e:${config.runId}:${fixture.scope}`);
  assert.equal(calls[0][2].headers['x-e2e-run-token'], config.cleanupToken);
  assert.match(calls[1][1], new RegExp(encodeURIComponent(fixture.scope)));
});
