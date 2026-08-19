const crypto = require('crypto');
const path = require('path');

const validatorPath = path.join(__dirname, '..', 'src', 'scripts', 'validateMigrationBackupEvidence');
const RELEASE_SHA = 'a'.repeat(40);
const CLUSTER_ID = 'production-cluster-1';
const CLUSTER_SHA = crypto.createHash('sha256').update(CLUSTER_ID, 'utf8').digest('hex');
const DIGEST = 'b'.repeat(64);
const NOW = Date.parse('2026-08-19T12:00:00Z');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function evidence(overrides = {}) {
  const fields = {
    evidence_version: '2',
    created_at: '2026-08-19T11:30:00Z',
    backup_id: '20260819T113000Z-aaaaaaaaaaaa',
    release_sha: RELEASE_SHA,
    source_cluster_sha256: CLUSTER_SHA,
    backup_job_result: 'success',
    committed_triplet: 'true',
    manifest_sha256: DIGEST,
    manifest_signature_sha256: 'c'.repeat(64),
    backup_signing_key_id: 'backup-2026q3',
    migration_count: '42',
    migration_digest: 'd'.repeat(64),
    evidence_signing_key_id: 'backup-finalizer-2026q3',
    ...overrides,
  };
  return `${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

function signed(text = evidence(), key = privateKey) {
  return crypto.sign('sha256', Buffer.from(text), key);
}

function input(overrides = {}) {
  const text = overrides.text || evidence();
  return {
    evidence: Buffer.from(text),
    signature: overrides.signature || signed(text),
    publicKey: overrides.publicKey || publicKey.export({ type: 'spki', format: 'pem' }),
    expectedKeyId: 'backup-finalizer-2026q3',
    expectedReleaseSha: RELEASE_SHA,
    expectedClusterId: CLUSTER_ID,
    maxAgeSeconds: 3600,
    nowMs: NOW,
    ...overrides,
  };
}

test('accepts fresh signed successful evidence bound to the exact cluster and release', () => {
  const { validateMigrationBackupEvidence } = require(validatorPath);
  expect(validateMigrationBackupEvidence(input())).toEqual(expect.objectContaining({
    backup_id: '20260819T113000Z-aaaaaaaaaaaa',
    migration_count: '42',
    migration_digest: 'd'.repeat(64),
  }));
});

test.each([
  ['stale evidence', { text: evidence({ created_at: '2026-08-19T10:59:59Z', backup_id: '20260819T105959Z-aaaaaaaaaaaa' }) }, /stale/i],
  ['future evidence', { text: evidence({ created_at: '2026-08-19T12:05:01Z', backup_id: '20260819T120501Z-aaaaaaaaaaaa' }) }, /future/i],
  ['wrong release', { expectedReleaseSha: 'e'.repeat(40) }, /release/i],
  ['wrong cluster', { expectedClusterId: 'other-cluster' }, /cluster/i],
  ['unsuccessful backup', { text: evidence({ backup_job_result: 'failure' }) }, /success/i],
  ['uncommitted triplet', { text: evidence({ committed_triplet: 'false' }) }, /committed/i],
  ['wrong signing key ID', { expectedKeyId: 'other-key' }, /key/i],
  ['bad signature', { signature: Buffer.from('not-a-signature') }, /signature/i],
  ['excessive freshness window', { maxAgeSeconds: 3601 }, /max.*age/i],
])('rejects %s', (_label, overrides, message) => {
  const { validateMigrationBackupEvidence } = require(validatorPath);
  const values = input(overrides);
  if (overrides.text && !overrides.signature) values.signature = signed(overrides.text);
  expect(() => validateMigrationBackupEvidence(values)).toThrow(message);
});

test.each([
  ['missing field', evidence().replace(/^migration_digest=.*\n/m, '')],
  ['duplicate field', `${evidence()}migration_digest=${'d'.repeat(64)}\n`],
  ['unknown field', `${evidence()}unknown=value\n`],
  ['noncanonical line endings', evidence().replace(/\n/g, '\r\n')],
])('rejects a %s in otherwise signed evidence', (_label, text) => {
  const { validateMigrationBackupEvidence } = require(validatorPath);
  expect(() => validateMigrationBackupEvidence(input({ text, signature: signed(text) }))).toThrow(/canonical|field/i);
});

test('CLI fails closed when required Railway evidence configuration is absent', () => {
  const { spawnSync } = require('child_process');
  const script = `${validatorPath}.js`;
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/required|missing/i);
});
