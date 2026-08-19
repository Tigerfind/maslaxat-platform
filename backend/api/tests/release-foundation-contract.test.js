const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const apiRoot = path.join(__dirname, '..');
const repoRoot = path.join(apiRoot, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function jobBlock(workflow, jobName, nextJobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  const end = nextJobName ? workflow.indexOf(`  ${nextJobName}:`, start + 1) : workflow.length;
  if (start < 0 || end < 0) throw new Error(`Missing workflow job: ${jobName}`);
  return workflow.slice(start, end);
}

function assertTeePipelinesProtected(workflow) {
  const pipelines = workflow.split('\n').filter((line) => line.includes('| tee'));
  if (!pipelines.length) throw new Error('Expected required tee pipelines');
  if (!/defaults:\s*\n\s+run:\s*\n\s+shell: bash .* -eo pipefail \{0\}/.test(workflow)) {
    throw new Error('Required tee pipelines need an explicit Bash -eo pipefail default');
  }
  return pipelines.length;
}

test('production image packages the exact migration CLI and forwards non-API commands', () => {
  const dockerfile = read('backend/api/Dockerfile');
  const dockerignore = read('backend/api/.dockerignore');
  const entrypoint = read('backend/api/docker-entrypoint.sh');
  const packageJson = JSON.parse(read('backend/api/package.json'));
  const toolchain = JSON.parse(read('backend/api/pdf-toolchain/packages.lock'));

  expect(toolchain.images.runtime.reference).toBe('node:22.18.0-bookworm-slim');
  expect(dockerfile).toContain(`FROM ${toolchain.images.runtime.reference}@${toolchain.images.runtime.digest}`);
  expect(dockerfile).toMatch(/COPY migrations\/ \.\/migrations\//);
  expect(dockerfile).toMatch(/COPY \.sequelizerc \.\/\.sequelizerc/);
  expect(dockerfile).toMatch(/COPY Dockerfile \.\/Dockerfile/);
  expect(dockerfile).toMatch(/COPY docker-entrypoint\.sh \.\/docker-entrypoint\.sh/);
  expect(dockerfile).toContain('USER node');
  expect(dockerfile).toContain('CMD ["node", "src/server.js"]');
  expect(packageJson.dependencies['sequelize-cli']).toBe('6.6.5');
  expect(packageJson.devDependencies?.['sequelize-cli']).toBeUndefined();
  expect(entrypoint).toMatch(/exec "\$@"/);
  expect(entrypoint).toContain('node:src/server.js|node:/app/src/server.js|npm:start');
  expect(dockerignore).toMatch(/^node_modules\/$/m);
  expect(dockerignore).toMatch(/^\.env\*$/m);
  expect(dockerignore).toMatch(/^tests\/$/m);
});

test('Railway validates fresh signed backup evidence before the advisory-locked migration wrapper', () => {
  const railway = JSON.parse(read('backend/api/railway.json'));
  const packageJson = JSON.parse(read('backend/api/package.json'));

  expect(packageJson.scripts['db:migrate:locked']).toBe('node src/scripts/runMigrationsLocked.js');
  expect(packageJson.scripts['db:predeploy']).toBe('node src/scripts/runMigrationsLocked.js');
  expect(railway.deploy.preDeployCommand).toBe('npm run db:predeploy');
  expect(railway.deploy.startCommand).toBe('npm start');
});

test('release lockfiles are intentionally unignored', () => {
  const gitignore = read('.gitignore');

  expect(gitignore).toContain('!backend/api/package-lock.json');
  expect(gitignore).toContain('!frontend/package-lock.json');
  expect(fs.existsSync(path.join(repoRoot, 'backend/api/package-lock.json'))).toBe(true);
  expect(fs.existsSync(path.join(repoRoot, 'frontend/package-lock.json'))).toBe(true);
});

test('CI has required PostgreSQL 16, Redis 7, strict gates, and sanitized evidence', () => {
  const ci = read('.github/workflows/ci.yml');
  const staging = read('.github/workflows/staging-gates.yml');

  for (const job of ['secrets:', 'backend:', 'frontend:', 'migration-empty:',
    'migration-representative:', 'dependency-audit:', 'image:', 'gate:']) {
    expect(ci).toContain(job);
  }
  expect(ci).toMatch(/postgres:16(?:\.|\s|$)/);
  expect(ci).toMatch(/redis:7(?:\.|\s|$)/);
  expect(ci).toContain('gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7');
  expect(ci).toMatch(/secrets:[\s\S]*name: secret-scan-\$\{\{ github\.sha \}\}/);
  expect(ci).toMatch(/npm (?:--prefix \S+ )?audit --audit-level=high/g);
  expect(ci).toContain('npm ci');
  expect(ci).toContain('tests/migration-foundation.test.js');
  expect(ci).toContain('tests/representative-db-migration.test.js');
  expect(ci).toContain('tests/representative-db-scale.test.js');
  expect(ci).toContain('/app/pdf-toolchain/p3.5-smoke.sh');
  expect(ci).toContain('test -f /app/Dockerfile');
  expect(ci).toContain('test -f /app/docker-entrypoint.sh');
  expect(ci).toMatch(/gate:[\s\S]*if: always\(\)/);
  expect(ci).toMatch(/actions\/upload-artifact@[a-f0-9]{40}/);
  expect(ci).not.toMatch(/(?:printenv|env\s*>|set\s*>)/);
  expect(staging).toContain('uses: ./.github/workflows/ci.yml');
  expect(staging).toContain('session-b-quality-gates:');
});

test('every required tee pipeline has explicit Bash -eo pipefail protection', () => {
  const ci = read('.github/workflows/ci.yml');

  expect(assertTeePipelinesProtected(ci)).toBeGreaterThanOrEqual(8);
  expect(() => assertTeePipelinesProtected(`jobs:\n  test:\n    steps:\n      - run: false | tee output.txt\n`))
    .toThrow('explicit Bash -eo pipefail');
});

test('every lane writes consistent sanitized final evidence and image initializes it before build', () => {
  const ci = read('.github/workflows/ci.yml');
  const jobs = [
    ['secrets', 'backend'],
    ['backend', 'frontend'],
    ['frontend', 'migration-empty'],
    ['migration-empty', 'migration-representative'],
    ['migration-representative', 'dependency-audit'],
    ['dependency-audit', 'image'],
    ['image', 'gate'],
    ['gate', null],
  ];

  for (const [job, nextJob] of jobs) {
    const block = jobBlock(ci, job, nextJob);
    expect(block).toContain('ci-evidence.sh start');
    expect(block).toContain('ci-evidence.sh finish');
    expect(block).toContain('if: always()');
  }

  const image = jobBlock(ci, 'image', 'gate');
  expect(image.indexOf('ci-evidence.sh start')).toBeLessThan(image.indexOf('docker build'));
  expect(image).toMatch(/if: always\(\)[\s\S]*ci-evidence\.sh finish[\s\S]*name: image-/);
});

test('CI evidence helper writes only the consistent start and final metadata contract', () => {
  const script = path.join(repoRoot, '.github', 'scripts', 'ci-evidence.sh');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-ci-evidence-'));
  const output = path.join(directory, 'lane.txt');
  const env = { ...process.env, GITHUB_SHA: 'abc123', GITHUB_RUN_ID: '456' };

  try {
    const start = spawnSync('bash', [script, 'start', output, 'node-22.18.0'], { env, encoding: 'utf8' });
    expect({ status: start.status, stderr: start.stderr }).toEqual({ status: 0, stderr: '' });
    const finish = spawnSync(
      'bash', [script, 'finish', output, 'test:failure', 'failure'], { env, encoding: 'utf8' }
    );
    expect({ status: finish.status, stderr: finish.stderr }).toEqual({ status: 0, stderr: '' });

    const evidence = fs.readFileSync(output, 'utf8');
    expect(evidence).toContain('sha=abc123\n');
    expect(evidence).toContain('run_id=456\n');
    expect(evidence).toMatch(/started_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    expect(evidence).toContain('tool=node-22.18.0\n');
    expect(evidence).toMatch(/completed_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    expect(evidence).toContain('result=test:failure\n');
    expect(evidence).toContain('final_status=failure\n');
    expect(evidence).not.toMatch(/password|token|secret=/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('quality workflow is reusable, immutable-action-pinned, and serializes one staging database', () => {
  const quality = read('.github/workflows/quality-gates.yml');
  const staging = read('.github/workflows/staging-gates.yml');
  const actionUses = [...quality.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);

  expect(quality).toMatch(/workflow_call:/);
  expect(quality).toContain('node-version: 22.18.0');
  expect(quality).toMatch(/group:\s*quality-staging-\$\{\{ vars\.QUALITY_STAGING_DATABASE_NAME \}\}/);
  expect(quality).toMatch(/cancel-in-progress:\s*false/);
  expect(quality).toContain('E2E_RUN_ID: q-${{ github.run_id }}-${{ github.run_attempt }}');
  expect(quality).toContain('LOAD_TEST_RUN_ID: q-${{ github.run_id }}-${{ github.run_attempt }}');
  expect(quality).toContain('E2E_CONFIRM_DATABASE: ${{ vars.QUALITY_STAGING_DATABASE_NAME }}');
  expect(quality).toContain('npm --prefix e2e audit --audit-level=high');
  expect(quality).toContain('node load/internal-server.js');
  expect(quality).toContain('BASE_URL: http://127.0.0.1:3002');
  for (const value of actionUses) {
    if (value.startsWith('./')) continue;
    expect(value).toMatch(/@[a-f0-9]{40}$/);
  }
  expect(staging).toContain('uses: ./.github/workflows/quality-gates.yml');
  expect(staging).toContain('secrets: inherit');
  expect(staging).not.toContain('Session B Playwright/load staging gates are not integrated');
});
