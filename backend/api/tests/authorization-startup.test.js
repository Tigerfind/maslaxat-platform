const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnv } = require('../src/config/env');
const { assertAuthorizationStartup } = require('../src/services/authorizationCutover');

test('authorization defaults to compatibility without evidence', async () => {
  const config = loadEnv({ NODE_ENV: 'test' });
  expect(config.authorization).toEqual({ mode: 'compatibility', metadataToken: null, evidence: null });
  await expect(assertAuthorizationStartup({ config: config.authorization })).resolves.toEqual({ mode: 'compatibility' });
});

test.each(['unknown', 'capability-only', ''])('rejects unsupported authorization mode %j', (mode) => {
  const env = { NODE_ENV: 'test', AUTHORIZATION_MODE: mode };
  if (!mode) delete env.AUTHORIZATION_MODE;
  if (!mode) {
    expect(loadEnv(env).authorization.mode).toBe('compatibility');
  } else {
    expect(() => loadEnv(env)).toThrow(/AUTHORIZATION_MODE/);
  }
});

test('production capability_only refuses missing evidence tuple before startup', () => {
  expect(() => loadEnv({
    NODE_ENV: 'production',
    AUTHORIZATION_MODE: 'capability_only',
    JWT_SECRET: 'x'.repeat(40),
  })).toThrow(/AUTHORIZATION_/);
});

test('capability_only refuses unreadable or invalid evidence without calling downstream startup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authorization-startup-'));
  const evidencePath = path.join(directory, 'manifest.json');
  fs.writeFileSync(evidencePath, '{}', { mode: 0o600 });
  const config = {
    mode: 'capability_only',
    evidence: {
      path: evidencePath,
      manifestPublicKey: 'invalid', manifestKeyId: 'authorization-evidence-v1',
      approvalKeys: {},
    },
  };

  await expect(assertAuthorizationStartup({
    config,
    runtimeIdentity: {
      commitSha: 'a'.repeat(40), deploymentId: 'deployment-123', serviceId: 'api-staging',
      configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js',
      authorizationMode: 'capability_only',
    },
  })).rejects.toThrow(/authorization cutover evidence/i);
});
