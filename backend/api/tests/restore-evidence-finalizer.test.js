const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const script = path.join(repoRoot, '.github/scripts/restore-evidence-finalizer.sh');
const workflow = path.join(repoRoot, '.github/workflows/restore-drill.yml');

function createSigningKey(output) {
  const privateKey = path.join(output, 'evidence-private.pem');
  const publicKey = path.join(output, 'evidence-public.pem');
  expect(spawnSync('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', privateKey]).status).toBe(0);
  expect(spawnSync('openssl', ['pkey', '-in', privateKey, '-pubout', '-out', publicKey]).status).toBe(0);
  return { privateKey, publicKey };
}

const boundEnv = (output, privateKey) => ({
  RESTORE_RUN_ID: '12345',
  RESTORE_RUN_ATTEMPT: '2',
  RESTORE_REPOSITORY: 'emaslaxat/platform',
  RESTORE_GIT_REF: 'refs/heads/main',
  RESTORE_COMMIT_SHA: 'a'.repeat(40),
  RESTORE_BACKUP_ID: '20260819T030000Z-testsha',
  RESTORE_FINALIZER_SIGNING_KEY_FILE: privateKey,
  RESTORE_FINALIZER_SIGNING_KEY_ID: 'restore-finalizer-2026q3',
  RESTORE_EVIDENCE_DIR: output,
});

test('independent finalizer does not infer job timeout from the earlier incident clock', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-finalizer-'));
  const { privateKey, publicKey } = createSigningKey(output);
  const result = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RESTORE_INCIDENT_EPOCH: '1000',
      RESTORE_FINAL_EPOCH: '7901',
      RESTORE_JOB_RESULT: 'failure',
      ...boundEnv(output, privateKey),
    },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  const evidence = fs.readFileSync(path.join(output, 'restore-finalizer-12345.evidence'), 'utf8');
  expect(evidence).toContain('restore_job_result=failure');
  expect(evidence).toContain('incident_epoch=1000');
  expect(evidence).toContain('duration_seconds=6901');
  expect(evidence).not.toContain('restore_job_timeout_seconds=');
  expect(evidence).not.toContain('restore_job_timeout=');
  expect(evidence).toContain('restore_job_result=failure');
  expect(evidence).toContain('rto_pass=false');
  expect(evidence).toContain('repository=emaslaxat/platform');
  expect(evidence).toContain('git_ref=refs/heads/main');
  expect(evidence).toContain('backup_id=20260819T030000Z-testsha');
  expect(evidence).toContain('evidence_signing_key_id=restore-finalizer-2026q3');
  const signature = path.join(output, 'restore-finalizer-12345.evidence.sig');
  expect(fs.existsSync(signature)).toBe(true);
  expect(spawnSync('openssl', ['dgst', '-sha256', '-verify', publicKey, '-signature', signature,
    path.join(output, 'restore-finalizer-12345.evidence')]).status).toBe(0);
});

test('independent finalizer evaluates RTO duration even when the restore job reports success', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-finalizer-rto-'));
  const { privateKey } = createSigningKey(output);
  const result = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RESTORE_INCIDENT_EPOCH: '1000',
      RESTORE_FINAL_EPOCH: '9000',
      RESTORE_JOB_RESULT: 'success',
      ...boundEnv(output, privateKey),
      RESTORE_RUN_ID: '12346',
    },
  });
  const evidence = fs.readFileSync(path.join(output, 'restore-finalizer-12346.evidence'), 'utf8');
  expect(evidence).toContain('duration_seconds=8000');
  expect(evidence).toContain('rto_target_seconds=7200');
  expect(evidence).toContain('rto_pass=false');
  expect(result.status).toBe(66);
});

test('independent finalizer authenticates and binds matching primary restore evidence', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-finalizer-primary-'));
  const { privateKey, publicKey } = createSigningKey(output);
  const primary = path.join(output, 'restore-primary.evidence');
  fs.writeFileSync(primary, [
    'evidence_version=3', 'workflow_run_id=12345', 'workflow_run_attempt=2',
    'repository=emaslaxat/platform', 'git_ref=refs/heads/main', `commit_sha=${'a'.repeat(40)}`,
    'backup_id=20260819T030000Z-testsha', `manifest_sha256=${'b'.repeat(64)}`,
    `manifest_signature_sha256=${'c'.repeat(64)}`, 'signing_key_id=release-2026q3',
    'evidence_signing_key_id=restore-evidence-2026q3', 'result=success', 'rto_pass=true', '',
  ].join('\n'));
  expect(spawnSync('openssl', ['dgst', '-sha256', '-sign', privateKey, '-out', `${primary}.sig`, primary]).status).toBe(0);
  const result = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env, ...boundEnv(output, privateKey),
      RESTORE_INCIDENT_EPOCH: '1000', RESTORE_FINAL_EPOCH: '2000', RESTORE_JOB_RESULT: 'success',
      RESTORE_PRIMARY_EVIDENCE_FILE: primary, RESTORE_PRIMARY_EVIDENCE_VERIFY_KEY_FILE: publicKey,
    },
  });
  expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  const evidence = fs.readFileSync(path.join(output, 'restore-finalizer-12345.evidence'), 'utf8');
  expect(evidence).toMatch(/primary_evidence_sha256=[a-f0-9]{64}/);
  expect(evidence).toContain('primary_evidence_verified=true');
  expect(evidence).toContain(`manifest_sha256=${'b'.repeat(64)}`);
  expect(evidence).toContain(`manifest_signature_sha256=${'c'.repeat(64)}`);
  expect(evidence).toContain('signing_key_id=release-2026q3');
  expect(evidence).toContain('primary_evidence_signing_key_id=restore-evidence-2026q3');
  expect(evidence).toContain('rto_pass=true');

  fs.appendFileSync(primary, 'tampered=true\n');
  const invalid = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env, ...boundEnv(output, privateKey),
      RESTORE_INCIDENT_EPOCH: '1000', RESTORE_FINAL_EPOCH: '2000', RESTORE_JOB_RESULT: 'success',
      RESTORE_PRIMARY_EVIDENCE_FILE: primary, RESTORE_PRIMARY_EVIDENCE_VERIFY_KEY_FILE: publicKey,
    },
  });
  expect(invalid.status).toBe(66);
});

test('restore workflow has dispatch incident input, bounded phases, and a separate always-running finalizer job', () => {
  const source = fs.readFileSync(workflow, 'utf8');
  expect(source).toContain('incident_epoch:');
  expect(source).toMatch(/Install locked backend dependencies[\s\S]*timeout-minutes:/);
  expect(source).toMatch(/Restore and run backend[\s\S]*timeout-minutes:/);
  expect(source).toMatch(/finalize-evidence:[\s\S]*needs: \[validate-images, restore\][\s\S]*if: \$\{\{ always\(\) \}\}/);
  expect(source).toContain('restore-evidence-finalizer.sh');
  expect(source).toContain('needs.restore.result');
  expect(source).toContain('image: ${{ needs.validate-images.outputs.redis_image }}');
  expect(source).toContain('REDIS_URL: redis://redis:6379');
  expect(source).toContain('R2_ACCOUNT_ID:');
  expect(source).toContain('R2_PRIVATE_BUCKET: ${{ vars.BACKUP_BUCKET }}');
});
