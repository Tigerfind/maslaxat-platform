const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('canonical deployment docs describe current Docker migration-safe readiness contract', () => {
  const deploy = read('DEPLOY.md');

  for (const text of [deploy]) {
    expect(text).toMatch(/Dockerfile/i);
    expect(text).toMatch(/db:migrate:locked/);
    expect(text).toMatch(/exact.*SequelizeMeta|SequelizeMeta.*exact/i);
    expect(text).toContain('/api/ready');
    expect(text).toMatch(/A1[\s\S]*A2[\s\S]*A3[\s\S]*A4/);
    expect(text).toMatch(/external.*block|внешн.*блок/i);
    expect(text).not.toMatch(/prod[^\n]*—[^\n]*sync\(\)|первый старт[^\n]*создаст[^\n]*sync|creates? schema[^\n]*sync/i);
    expect(text).not.toMatch(/NIXPACKS|Nixpacks/);
  }
  expect(deploy).not.toMatch(/P3\.5 BLOCKER:[^\n]*чистая PostgreSQL/);
  expect(deploy).not.toMatch(/healthcheck[^\n]*\/api\/health/i);

  const productionMinimum = deploy.slice(
    deploy.indexOf('минимум для production-запуска'),
    deploy.indexOf('Опциональные провайдеры'),
  );
  expect(productionMinimum).toMatch(/AUTHORIZATION_MODE=compatibility/);
  for (const variable of ['RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_SERVICE_ID']) {
    expect(productionMinimum).toContain(variable);
  }
  expect(productionMinimum).toMatch(/AUTHORIZATION_METADATA_TOKEN[^\n]*(?:>=\s*32|минимум 32)/i);
  expect(productionMinimum).toMatch(/AUTHORIZATION_EVIDENCE_\*[^\n]*(?:absent|empty|не заполнять|оставить пуст)/i);

  const blockingStart = deploy.search(/^## .*blocking release gates/im);
  const nonBlockingStart = deploy.search(/^## .*BACKLOG.*(?:не блокирует|non-blocking)/im);
  expect(blockingStart).toBeGreaterThan(0);
  expect(nonBlockingStart).toBeGreaterThan(blockingStart);
  const blocking = deploy.slice(blockingStart, nonBlockingStart);
  const nonBlocking = deploy.slice(nonBlockingStart);
  expect(blocking).toMatch(/Docker[\s\S]*Railway[\s\S]*staging migration[\s\S]*(?:readiness|\/api\/ready)/i);
  expect(nonBlocking).not.toMatch(/Docker|Railway|staging migration|readiness|\/api\/ready/i);
});

test('both environment examples preserve supported release controls and every A4 operational variable', () => {
  const examples = [read('.env.example'), read('backend/api/.env.example')];
  const releaseControls = {
    DB_SSL: '0',
    SOCKET_REDIS: '0',
    CATALOG_COOKIE_CROSS_SITE: '0',
    MIGRATION_LOCK_WAIT_MS: '120000',
    MIGRATION_LOCK_POLL_MS: '1000',
  };
  const a4Variables = [
    'AUTHORIZATION_MODE', 'RAILWAY_GIT_COMMIT_SHA', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_SERVICE_ID',
    'AUTHORIZATION_METADATA_TOKEN', 'AUTHORIZATION_EVIDENCE_PATH',
    'AUTHORIZATION_EVIDENCE_PUBLIC_KEY_B64', 'AUTHORIZATION_EVIDENCE_KEY_ID',
    'AUTHORIZATION_SECURITY_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_SECURITY_APPROVAL_KEY_ID',
    'AUTHORIZATION_RELEASE_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_RELEASE_APPROVAL_KEY_ID',
    'AUTHORIZATION_CUTOVER_APPROVAL_PUBLIC_KEY_B64', 'AUTHORIZATION_CUTOVER_APPROVAL_KEY_ID',
  ];

  for (const example of examples) {
    for (const [variable, value] of Object.entries(releaseControls)) {
      expect(example).toMatch(new RegExp(`^${variable}=${value}$`, 'm'));
    }
    expect(example).toMatch(/^AUTH_RATE_LIMIT_MAX=(?:20|100)$/m);
    for (const variable of a4Variables) expect(example).toMatch(new RegExp(`^${variable}=`, 'm'));
    expect(example).toMatch(/^AUTHORIZATION_MODE=compatibility$/m);
    expect(example).not.toMatch(/^AUTHORIZATION_MODE=capability_only$/m);
  }
  expect(examples[0]).toMatch(/curated|supported operator/i);
  expect(examples[0]).not.toMatch(/ТОЛЬКО те переменные[\s\S]*Ничего лишнего/);
});

test('backend package, lock, and operator docs require the reviewed Node 22 range', () => {
  const packageJson = JSON.parse(read('backend/api/package.json'));
  const lock = JSON.parse(read('backend/api/package-lock.json'));
  const deploy = read('DEPLOY.md');

  expect(packageJson.engines.node).toBe('>=22.18.0 <23');
  expect(lock.packages[''].engines.node).toBe('>=22.18.0 <23');
  expect(deploy).toMatch(/Node(?:\.js)? 22\.18\.0|Node(?:\.js)? `>=22\.18\.0 <23`/);
});

test('Session A status records current dependency and full-test evidence without reopening closed blockers', () => {
  const deploy = read('DEPLOY.md');
  const audit = read('docs/security/wave1-dependency-audit.md');

  expect(deploy).not.toMatch(/full backend A3 run[\s\S]{0,160}production-jobs.*blocker/i);
  expect(deploy).toMatch(/101 suites[^\n]*1201\/1201|101[^\n]*suites[^\n]*1201[^\n]*tests/i);
  expect(audit).toMatch(/@aws-sdk\/client-s3@3\.1113\.0/);
  expect(audit).toMatch(/Backend[^\n]*0 critical[^\n]*0 high[^\n]*2 moderate/i);
  expect(audit).toMatch(/Node(?:\.js)? 22\.18\.0|Node `>=22\.18\.0 <23`/i);
  expect(audit).toMatch(/Frontend[^\n]*31[^\n]*14 high/i);
  expect(audit).not.toMatch(/Node 18 Override Investigation|build the Node 18 image/);

  expect(deploy).toMatch(/A1-A4 task contracts[^\n]*APPROVED_LOCAL/i);
  expect(deploy).toMatch(/release gate[^\n]*red/i);
  expect(audit).toMatch(/47-warning[\s\S]{0,200}Session B/i);
  expect(audit).toMatch(/Session B[^\n]*Router\/CRA/i);
});

test('active payment and capability cutover remain refused and legacy role removal remains absent', () => {
  const payment = read('backend/api/src/config/payment.js');
  const env = read('backend/api/src/config/env.js');
  const migrations = fs.readdirSync(path.join(root, 'backend/api/migrations')).join('\n');

  expect(payment).toMatch(/active[\s\S]*throw|throw[\s\S]*active/);
  expect(env).toMatch(/AUTHORIZATION_MODE[\s\S]*compatibility/);
  expect(migrations).not.toMatch(/remove.*role|drop.*role/i);
});
