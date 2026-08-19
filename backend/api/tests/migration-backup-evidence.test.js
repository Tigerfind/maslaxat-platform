const crypto = require('crypto');
const path = require('path');

const validatorPath = path.join(__dirname, '..', 'src', 'scripts', 'validateMigrationBackupEvidence');
const RELEASE_SHA = 'a'.repeat(40);
const CLUSTER_ID = '72623859790382856';
const CLUSTER_SHA = crypto.createHash('sha256').update(CLUSTER_ID, 'utf8').digest('hex');
const DIGEST = 'b'.repeat(64);
const NOW = Date.parse('2026-08-19T12:00:00Z');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const APPLIED = ['001-initial.js'];
const TARGET = ['001-initial.js', '002-next.js'];
const migrationDigest = (names) => crypto.createHash('sha256').update(`${names.join('\n')}\n`).digest('hex');

function evidence(overrides = {}) {
  const fields = {
    evidence_version: '3',
    created_at: '2026-08-19T11:30:00Z',
    backup_id: '20260819T113000Z-aaaaaaaaaaaa',
    release_sha: RELEASE_SHA,
    source_cluster_sha256: CLUSTER_SHA,
    backup_job_result: 'success',
    committed_triplet: 'true',
    manifest_sha256: DIGEST,
    manifest_signature_sha256: 'c'.repeat(64),
    backup_signing_key_id: 'backup-2026q3',
    applied_migration_count: String(APPLIED.length),
    applied_migration_digest: migrationDigest(APPLIED),
    applied_migration_head: APPLIED.at(-1),
    target_migration_count: String(TARGET.length),
    target_migration_digest: migrationDigest(TARGET),
    target_migration_head: TARGET.at(-1),
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
    maxAgeSeconds: 3600,
    nowMs: NOW,
    ...overrides,
  };
}

test('accepts fresh signed successful evidence for source and intended target migration identities', () => {
  const { validateMigrationBackupEvidence } = require(validatorPath);
  expect(validateMigrationBackupEvidence(input())).toEqual(expect.objectContaining({
    backup_id: '20260819T113000Z-aaaaaaaaaaaa',
    applied_migration_count: '1',
    target_migration_count: '2',
  }));
});

test.each([
  ['stale evidence', { text: evidence({ created_at: '2026-08-19T10:59:59Z', backup_id: '20260819T105959Z-aaaaaaaaaaaa' }) }, /stale/i],
  ['future evidence', { text: evidence({ created_at: '2026-08-19T12:05:01Z', backup_id: '20260819T120501Z-aaaaaaaaaaaa' }) }, /future/i],
  ['wrong release', { expectedReleaseSha: 'e'.repeat(40) }, /release/i],
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
  ['missing field', evidence().replace(/^target_migration_digest=.*\n/m, '')],
  ['duplicate field', `${evidence()}target_migration_digest=${migrationDigest(TARGET)}\n`],
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

test('live target binding accepts the signed applied prefix and exact packaged target', () => {
  const { validateMigrationTargetBindings, validateMigrationBackupEvidence } = require(validatorPath);
  const values = validateMigrationBackupEvidence(input());
  expect(validateMigrationTargetBindings({
    values,
    actualClusterId: CLUSTER_ID,
    appliedMigrations: APPLIED,
    targetMigrations: TARGET,
  })).toEqual(expect.objectContaining({ pendingMigrations: ['002-next.js'] }));
});

test.each([
  ['different live cluster', { actualClusterId: '99999999999999999' }, /cluster/i],
  ['missing applied migration', { appliedMigrations: [] }, /applied migration identity/i],
  ['unknown applied migration', { appliedMigrations: ['999-unknown.js'] }, /applied migration identity/i],
  ['different packaged target', { targetMigrations: [...TARGET, '003-unapproved.js'] }, /target migration identity/i],
  ['reordered applied migrations', { appliedMigrations: [...APPLIED].reverse().concat('000-before.js') }, /ordered|sorted/i],
])('live target binding rejects %s', (_label, overrides, message) => {
  const { validateMigrationTargetBindings, validateMigrationBackupEvidence } = require(validatorPath);
  const values = validateMigrationBackupEvidence(input());
  expect(() => validateMigrationTargetBindings({
    values,
    actualClusterId: CLUSTER_ID,
    appliedMigrations: APPLIED,
    targetMigrations: TARGET,
    ...overrides,
  })).toThrow(message);
});

test('live target binding rejects a signed applied set that is not a target prefix', () => {
  const nonPrefix = ['002-next.js'];
  const text = evidence({
    applied_migration_count: '1',
    applied_migration_digest: migrationDigest(nonPrefix),
    applied_migration_head: nonPrefix[0],
  });
  const { validateMigrationTargetBindings, validateMigrationBackupEvidence } = require(validatorPath);
  const values = validateMigrationBackupEvidence(input({ text, signature: signed(text) }));
  expect(() => validateMigrationTargetBindings({
    values,
    actualClusterId: CLUSTER_ID,
    appliedMigrations: nonPrefix,
    targetMigrations: TARGET,
  })).toThrow(/ordered prefix/i);
});

test('live identity query failure is a clear fail-closed error', async () => {
  const { verifyMigrationBackupTarget, validateMigrationBackupEvidence } = require(validatorPath);
  const client = { query: jest.fn().mockRejectedValue(new Error('permission denied')) };
  await expect(verifyMigrationBackupTarget(client, {
    values: validateMigrationBackupEvidence(input()),
    targetMigrations: TARGET,
  })).rejects.toThrow(/could not query migration target system identifier/i);
});

test('malformed live identity response is a clear fail-closed error', async () => {
  const { verifyMigrationBackupTarget, validateMigrationBackupEvidence } = require(validatorPath);
  const client = { query: jest.fn().mockResolvedValue({}) };
  await expect(verifyMigrationBackupTarget(client, {
    values: validateMigrationBackupEvidence(input()),
    targetMigrations: TARGET,
  })).rejects.toThrow(/system identifier response is invalid/i);
});
