const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const script = path.join(repoRoot, '.github/scripts/retention-evidence-finalizer.sh');

test.each(['failure', 'cancelled'])(
  'retention finalizer signs evidence and exits nonzero for %s',
  (jobResult) => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-finalizer-'));
    const privateKey = path.join(output, 'private.pem');
    const publicKey = path.join(output, 'public.pem');
    expect(spawnSync('openssl', ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', privateKey]).status).toBe(0);
    expect(spawnSync('openssl', ['pkey', '-in', privateKey, '-pubout', '-out', publicKey]).status).toBe(0);
    const result = spawnSync('bash', [script], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        RETENTION_JOB_RESULT: jobResult, RETENTION_RUN_ID: '777', RETENTION_RUN_ATTEMPT: '2',
        RETENTION_REPOSITORY: 'emaslaxat/platform', RETENTION_GIT_REF: 'refs/heads/main',
        RETENTION_COMMIT_SHA: 'd'.repeat(40), RETENTION_FINALIZER_EVIDENCE_DIR: output,
        RETENTION_FINALIZER_SIGNING_KEY_FILE: privateKey,
        RETENTION_FINALIZER_SIGNING_KEY_ID: 'retention-finalizer-2026q3',
      },
    });
    expect(result.status).toBe(1);
    const evidencePath = path.join(output, 'retention-finalizer-777.evidence');
    expect(fs.readFileSync(evidencePath, 'utf8')).toContain(`retention_job_result=${jobResult}`);
    expect(spawnSync('openssl', ['dgst', '-sha256', '-verify', publicKey,
      '-signature', `${evidencePath}.sig`, evidencePath]).status).toBe(0);
  },
);

test('retention workflow has a separate always-running signed finalizer', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/database-backup-retention.yml'), 'utf8');
  expect(workflow).toMatch(/finalize-evidence:[\s\S]*needs: \[validate-images, retention\][\s\S]*if: \$\{\{ always\(\) \}\}/);
  expect(workflow).toContain('retention-evidence-finalizer.sh');
  expect(workflow).toContain('RETENTION_FINALIZER_SIGNING_KEY_B64');
});
