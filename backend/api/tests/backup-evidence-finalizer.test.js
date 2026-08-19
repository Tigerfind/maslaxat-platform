const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const script = path.join(repoRoot, '.github/scripts/backup-evidence-finalizer.sh');

test('backup finalizer survives producer failure and signs known-only last-phase evidence', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-finalizer-'));
  const privateKey = path.join(output, 'private.pem');
  const publicKey = path.join(output, 'public.pem');
  expect(spawnSync('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', privateKey]).status).toBe(0);
  expect(spawnSync('openssl', ['pkey', '-in', privateKey, '-pubout', '-out', publicKey]).status).toBe(0);
  const result = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKUP_JOB_RESULT: 'failure', BACKUP_RUN_ID: '555', BACKUP_RUN_ATTEMPT: '3',
      BACKUP_REPOSITORY: 'emaslaxat/platform', BACKUP_GIT_REF: 'refs/heads/main',
      BACKUP_COMMIT_SHA: 'b'.repeat(40), BACKUP_FINALIZER_EVIDENCE_DIR: output,
      BACKUP_FINALIZER_SIGNING_KEY_FILE: privateKey,
      BACKUP_FINALIZER_SIGNING_KEY_ID: 'backup-finalizer-2026q3',
    },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  const evidencePath = path.join(output, 'backup-finalizer-555.evidence');
  const evidence = fs.readFileSync(evidencePath, 'utf8');
  expect(evidence).toContain('backup_job_result=failure');
  expect(evidence).toContain('last_successful_phase=unknown');
  expect(evidence).toContain('committed_triplet=unknown');
  expect(evidence).toContain('repository=emaslaxat/platform');
  const signature = `${evidencePath}.sig`;
  expect(spawnSync('openssl', ['dgst', '-sha256', '-verify', publicKey, '-signature', signature, evidencePath]).status).toBe(0);
});

test('successful backup finalizer emits signed canonical predeploy evidence', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-predeploy-'));
  const privateKey = path.join(output, 'private.pem');
  const publicKey = path.join(output, 'public.pem');
  expect(spawnSync('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', privateKey]).status).toBe(0);
  expect(spawnSync('openssl', ['pkey', '-in', privateKey, '-pubout', '-out', publicKey]).status).toBe(0);
  const env = {
    ...process.env,
    BACKUP_JOB_RESULT: 'success', BACKUP_RUN_ID: '556', BACKUP_RUN_ATTEMPT: '1',
    BACKUP_REPOSITORY: 'emaslaxat/platform', BACKUP_GIT_REF: 'refs/heads/main',
    BACKUP_COMMIT_SHA: 'a'.repeat(40), BACKUP_FINALIZER_EVIDENCE_DIR: output,
    BACKUP_FINALIZER_SIGNING_KEY_FILE: privateKey,
    BACKUP_FINALIZER_SIGNING_KEY_ID: 'backup-finalizer-2026q3',
    BACKUP_LAST_SUCCESSFUL_PHASE: 'triplet_committed', BACKUP_COMMITTED_TRIPLET: 'true',
    BACKUP_FINALIZED_ID: '20260819T113000Z-aaaaaaaaaaaa',
    BACKUP_FINALIZED_CREATED_AT: '2026-08-19T11:30:00Z',
    BACKUP_FINALIZED_SOURCE_CLUSTER_SHA256: 'b'.repeat(64),
    BACKUP_FINALIZED_MANIFEST_SHA256: 'c'.repeat(64),
    BACKUP_FINALIZED_SIGNATURE_SHA256: 'd'.repeat(64),
    BACKUP_FINALIZED_SIGNING_KEY_ID: 'backup-2026q3',
    BACKUP_FINALIZED_MIGRATION_COUNT: '42',
    BACKUP_FINALIZED_MIGRATION_DIGEST: 'e'.repeat(64),
  };
  const result = spawnSync('bash', [script], { cwd: repoRoot, encoding: 'utf8', env });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  const evidencePath = path.join(output, 'migration-backup-556.evidence');
  expect(fs.readFileSync(evidencePath, 'utf8')).toBe([
    'evidence_version=2',
    'created_at=2026-08-19T11:30:00Z',
    'backup_id=20260819T113000Z-aaaaaaaaaaaa',
    `release_sha=${'a'.repeat(40)}`,
    `source_cluster_sha256=${'b'.repeat(64)}`,
    'backup_job_result=success',
    'committed_triplet=true',
    `manifest_sha256=${'c'.repeat(64)}`,
    `manifest_signature_sha256=${'d'.repeat(64)}`,
    'backup_signing_key_id=backup-2026q3',
    'migration_count=42',
    `migration_digest=${'e'.repeat(64)}`,
    'evidence_signing_key_id=backup-finalizer-2026q3',
    '',
  ].join('\n'));
  expect(spawnSync('openssl', [
    'dgst', '-sha256', '-verify', publicKey, '-signature', `${evidencePath}.sig`, evidencePath,
  ]).status).toBe(0);
});
