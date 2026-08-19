const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '../..');
const loadRoot = path.join(repoRoot, 'load/k6');
const seedPath = path.join(apiRoot, 'src/seeds/load-seed.js');
const routePath = path.join(apiRoot, 'src/routes/load-test.js');
const internalServerPath = path.join(repoRoot, 'load/internal-server.js');
const summaryValidatorPath = path.join(repoRoot, 'load/validate-summary.js');

function approvedEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'staging',
    LOAD_TEST_ENABLED: 'true',
    K6_LOAD_APPROVED: 'true',
    LOAD_TEST_ALLOWED_HOSTS: 'api.staging.example.test',
    LOAD_TEST_PRODUCTION_HOSTS: 'api.maslaxat.uz,maslaxat.uz',
    PAYMENT_SANDBOX_ENABLED: 'true',
    ...overrides,
  };
}

describe('load-test safety contracts', () => {
  test('seed and route reject every missing staging approval independently', () => {
    const { assertLoadSeedEnvironment } = require(seedPath);
    const { assertLoadTestEnvironment } = require(routePath);
    const required = [
      ['APP_ENV', 'development'],
      ['LOAD_TEST_ENABLED', 'false'],
      ['K6_LOAD_APPROVED', 'false'],
      ['PAYMENT_SANDBOX_ENABLED', 'false'],
    ];

    for (const [name, value] of required) {
      expect(() => assertLoadSeedEnvironment(approvedEnv({ [name]: value }), 'https://api.staging.example.test'))
        .toThrow(name);
      expect(() => assertLoadTestEnvironment(approvedEnv({ [name]: value }), 'api.staging.example.test'))
        .toThrow(name);
    }
  });

  test('guards reject production, HTTP, unlisted, and production-listed targets', () => {
    const { assertLoadSeedEnvironment } = require(seedPath);
    const { assertLoadTestEnvironment } = require(routePath);

    expect(() => assertLoadSeedEnvironment(approvedEnv({ NODE_ENV: 'production' }), 'https://api.staging.example.test'))
      .toThrow('NODE_ENV');
    expect(() => assertLoadSeedEnvironment(approvedEnv(), 'http://api.staging.example.test')).toThrow('HTTPS');
    expect(() => assertLoadSeedEnvironment(approvedEnv(), 'https://other.example.test')).toThrow('allowlist');
    expect(() => assertLoadTestEnvironment(approvedEnv(), 'other.example.test')).toThrow('allowlist');
    expect(() => assertLoadTestEnvironment(approvedEnv({
      LOAD_TEST_ALLOWED_HOSTS: 'api.maslaxat.uz',
    }), 'api.maslaxat.uz')).toThrow('production');
    expect(() => assertLoadSeedEnvironment(approvedEnv({
      LOAD_TEST_ALLOWED_HOSTS: 'load.api.maslaxat.uz',
    }), 'https://load.api.maslaxat.uz')).toThrow('production');
    expect(() => assertLoadTestEnvironment(approvedEnv({
      LOAD_TEST_ALLOWED_HOSTS: 'load.api.maslaxat.uz',
    }), 'load.api.maslaxat.uz')).toThrow('production');
    const replacedDenylist = approvedEnv({
      LOAD_TEST_ALLOWED_HOSTS: 'api.maslaxat.uz',
      LOAD_TEST_PRODUCTION_HOSTS: 'unrelated.production.test',
    });
    expect(() => assertLoadSeedEnvironment(replacedDenylist, 'https://api.maslaxat.uz'))
      .toThrow('production');
    expect(() => assertLoadTestEnvironment(replacedDenylist, 'api.maslaxat.uz'))
      .toThrow('production');
  });

  test('seed accepts HTTP only for the isolated loopback load service', () => {
    const { assertLoadSeedEnvironment } = require(seedPath);
    const loopback = approvedEnv({ LOAD_TEST_ALLOWED_HOSTS: '127.0.0.1' });

    expect(assertLoadSeedEnvironment(loopback, 'http://127.0.0.1:3002')).toBe('http://127.0.0.1:3002');
    expect(() => assertLoadSeedEnvironment(approvedEnv(), 'http://api.staging.example.test')).toThrow('HTTPS');
  });
});

describe('load seed and manifest contracts', () => {
  test('binds seed mutations to the target-issued live database fingerprint and restricted role', async () => {
    const { assertDatabaseIdentity } = require(seedPath);
    const crypto = require('crypto');
    const identity = {
      database: 'maslaxat_load_test', role: 'load_runner', address: '127.0.0.1', port: 5432,
      rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false,
    };
    const nonce = 'nonce-0123456789';
    const secret = 'database-attestation-secret';
    const fingerprint = crypto.createHmac('sha256', secret)
      .update(['e2e-db-v1', nonce, identity.database, identity.address, identity.port].join('\n'))
      .digest('hex');
    const database = { query: jest.fn(async () => [[identity]]) };
    const attestationEnv = {
      LOAD_DB_ATTESTATION_NONCE: nonce,
      LOAD_DB_ATTESTATION_SECRET: secret,
      LOAD_TARGET_DB_FINGERPRINT: fingerprint,
      LOAD_DATABASE_ROLE_CONFIRM: 'load_runner',
      LOAD_TEST_PRODUCTION_DB_FINGERPRINTS: 'f'.repeat(64),
    };

    await expect(assertDatabaseIdentity(attestationEnv, database)).resolves.toMatchObject({ fingerprint, role: 'load_runner' });
    await expect(assertDatabaseIdentity({ ...attestationEnv, LOAD_TARGET_DB_FINGERPRINT: 'a'.repeat(64) }, database))
      .rejects.toThrow('target-issued fingerprint');
    await expect(assertDatabaseIdentity(attestationEnv, {
      query: jest.fn(async () => [[{ ...identity, rolsuper: true }]]),
    })).rejects.toThrow('privileged');
  });

  test('declares the audited deterministic dataset and a secret-free manifest', () => {
    const { LOAD_DATASET, buildLoadManifest } = require(seedPath);
    expect(LOAD_DATASET).toEqual({ lawyers: 50, clients: 200, consultations: 1000 });

    const manifest = buildLoadManifest({
      clients: [{ id: 'client-id', email: 'client-000@load.test' }],
      lawyers: [{ id: 'lawyer-id', email: 'lawyer-000@load.test' }],
      consultations: [{ id: 'consultation-id', clientId: 'client-id', lawyerId: 'lawyer-id' }],
    });
    expect(manifest).toMatchObject({ seedVersion: expect.any(String), dataset: LOAD_DATASET });
    expect(JSON.stringify(manifest)).not.toMatch(/password|secret|token|authorization/i);
  });

  test('gives every client a payment-pending checkout without changing dataset counts', () => {
    const { buildLoadManifest } = require(seedPath);
    const clients = Array.from({ length: 200 }, (_, index) => ({
      id: `client-${index}`,
      email: `client-${index}@load.test`,
    }));
    const lawyers = Array.from({ length: 50 }, (_, index) => ({
      id: `lawyer-${index}`,
      email: `lawyer-${index}@load.test`,
    }));
    const statuses = ['payment_pending', 'pending', 'accepted', 'completed', 'cancelled'];
    const consultations = Array.from({ length: 1000 }, (_, index) => ({
      id: `consultation-${index}`,
      clientId: clients[index % clients.length].id,
      lawyerId: lawyers[index % lawyers.length].id,
      status: statuses[(Math.floor(index / clients.length) + 1) % statuses.length],
    }));

    const manifest = buildLoadManifest({ clients, lawyers, consultations });
    const byId = new Map(consultations.map((consultation) => [consultation.id, consultation]));
    expect(manifest.clients).toHaveLength(200);
    expect(manifest.consultations).toHaveLength(1000);
    for (const client of manifest.clients) {
      expect(client.consultationIds).toHaveLength(5);
      expect(client.checkoutConsultationIds).toHaveLength(1);
      expect(byId.get(client.checkoutConsultationIds[0]).status).toBe('payment_pending');
    }
  });

  test('builds exactly five deterministic statuses per client including one checkout', () => {
    const { buildLoadRecords } = require(seedPath);
    const records = buildLoadRecords();

    expect(records.lawyers).toHaveLength(50);
    expect(records.clients).toHaveLength(200);
    expect(records.consultations).toHaveLength(1000);
    for (const client of records.clients) {
      const owned = records.consultations.filter(({ clientId }) => clientId === client.id);
      expect(owned.map(({ status }) => status).sort()).toEqual([
        'accepted', 'cancelled', 'completed', 'payment_pending', 'pending',
      ]);
    }
    expect(buildLoadRecords()).toEqual(records);
  });

  test('reports duplicate checkout business objects by run without exposing rows', async () => {
    const { verifyCheckoutBusinessObjects } = require(routePath);
    const payments = {
      findAll: jest.fn().mockResolvedValue([
        { id: 'payment-1', userId: 'client-1', idempotencyKey: 'load:run-123:checkout:1' },
        { id: 'payment-2', userId: 'client-1', idempotencyKey: 'load:run-123:checkout:1' },
        { id: 'payment-3', userId: 'client-2', idempotencyKey: 'load:run-123:checkout:2' },
      ]),
    };

    await expect(verifyCheckoutBusinessObjects(payments, 'run-123')).resolves.toEqual({
      runId: 'run-123',
      checkoutBusinessObjects: 3,
      duplicateBusinessObjects: 1,
      duplicateKeys: 1,
    });
    expect(payments.findAll).toHaveBeenCalledWith(expect.objectContaining({
      attributes: ['id', 'userId', 'idempotencyKey'],
    }));
  });

  test('rejects malformed post-run verification identifiers', async () => {
    const { verifyCheckoutBusinessObjects } = require(routePath);
    await expect(verifyCheckoutBusinessObjects({ findAll: jest.fn() }, '../production'))
      .rejects.toThrow('runId');
    await expect(verifyCheckoutBusinessObjects({ findAll: jest.fn() }, 'run_123'))
      .rejects.toThrow('runId');
  });

  test('sandbox mutations accept only synthetic load users', () => {
    const { isSyntheticLoadUser } = require(routePath);
    expect(isSyntheticLoadUser({ email: 'client-001@load.test' })).toBe(true);
    expect(isSyntheticLoadUser({ email: 'client@example.test' })).toBe(false);
    expect(isSyntheticLoadUser({ email: 'client@load.test.example.test' })).toBe(false);
    expect(isSyntheticLoadUser(null)).toBe(false);
  });

  test('computes effective baseline capacity and refuses default staging limits', () => {
    const { buildLoadCapacity } = require(routePath);
    expect(buildLoadCapacity(approvedEnv(), 'baseline')).toMatchObject({
      profile: 'baseline',
      safe: false,
      required: { globalMax: 18027, authMax: 25 },
      effective: { globalMax: 1000, authMax: 20, globalWindowMs: 900000 },
    });
    expect(buildLoadCapacity(approvedEnv({
      RATE_LIMIT_MAX: '18027',
      AUTH_RATE_LIMIT_MAX: '25',
    }), 'baseline')).toMatchObject({ safe: true });
  });

  test('rejects unknown capacity profiles and run identifiers over 40 characters', async () => {
    const { buildLoadCapacity, verifyCheckoutBusinessObjects } = require(routePath);
    expect(() => buildLoadCapacity(approvedEnv(), 'production')).toThrow('profile');
    await expect(verifyCheckoutBusinessObjects({ findAll: jest.fn().mockResolvedValue([]) }, 'a'.repeat(40)))
      .resolves.toMatchObject({ runId: 'a'.repeat(40) });
    await expect(verifyCheckoutBusinessObjects({ findAll: jest.fn() }, 'a'.repeat(41)))
      .rejects.toThrow('runId');
  });

  test('deletes only pending sandbox objects owned by the requested run', async () => {
    const { cleanupRunObjects } = require(routePath);
    const transaction = { id: 'tx' };
    const models = {
      sequelize: { transaction: jest.fn((callback) => callback(transaction)) },
      Payment: {
        findAll: jest.fn().mockResolvedValue([
          { id: 'payment-1', status: 'pending', providerData: { sandbox: true, loadTest: true } },
        ]),
        destroy: jest.fn().mockResolvedValue(1),
      },
      Consultation: {
        findAll: jest.fn().mockResolvedValue([
          { id: 'consultation-1', status: 'payment_pending' },
        ]),
        destroy: jest.fn().mockResolvedValue(1),
      },
      Message: { destroy: jest.fn().mockResolvedValue(0) },
    };

    await expect(cleanupRunObjects(models, 'run-123')).resolves.toEqual({
      runId: 'run-123', paymentsDeleted: 1, messagesDeleted: 0, consultationsDeleted: 1,
    });
    expect(models.Payment.destroy).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { [require('sequelize').Op.in]: ['payment-1'] } }, transaction,
    }));
    expect(models.Consultation.destroy).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
  });

  test('run cleanup refuses provider-confirmed or non-sandbox payment rows before deletion', async () => {
    const { cleanupRunObjects } = require(routePath);
    const destroy = jest.fn();
    const models = {
      sequelize: { transaction: (callback) => callback({}) },
      Payment: {
        findAll: jest.fn().mockResolvedValue([
          { id: 'payment-1', status: 'paid', providerData: { sandbox: true, loadTest: true } },
        ]),
        destroy,
      },
      Consultation: { findAll: jest.fn().mockResolvedValue([]), destroy },
      Message: { destroy },
    };
    await expect(cleanupRunObjects(models, 'run-123')).rejects.toThrow('unsafe payment');
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe('k6 static contracts', () => {
  const scripts = ['common.js', 'smoke.js', 'baseline.js', 'spike.js'];

  test.each(scripts)('%s is valid ECMAScript module syntax', (name) => {
    const source = fs.readFileSync(path.join(loadRoot, name), 'utf8');
    expect(spawnSync(process.execPath, ['--input-type=module', '--check'], {
      input: source,
      encoding: 'utf8',
    })).toMatchObject({ status: 0, stderr: '' });
  });

  test('common request dispatcher preserves the audited weighted mix and endpoint metrics', () => {
    const source = fs.readFileSync(path.join(loadRoot, 'common.js'), 'utf8');
    expect(source).toMatch(/catalog:\s*43/);
    expect(source).toMatch(/dashboards:\s*14/);
    expect(source).toMatch(/authProfile:\s*13/);
    expect(source).toMatch(/consultations:\s*14/);
    expect(source).toMatch(/chatHistory:\s*10/);
    expect(source).toMatch(/checkoutSandbox:\s*6/);
    expect(source).not.toMatch(/\/api\/ai|api\.anthropic|smtp:\/\/|payme\.uz|\/documents\/.*upload/i);
  });

  test('scenario options preserve audited load shape and latency/error gates', () => {
    const smoke = fs.readFileSync(path.join(loadRoot, 'smoke.js'), 'utf8');
    const baseline = fs.readFileSync(path.join(loadRoot, 'baseline.js'), 'utf8');
    const spike = fs.readFileSync(path.join(loadRoot, 'spike.js'), 'utf8');
    const common = fs.readFileSync(path.join(loadRoot, 'common.js'), 'utf8');

    expect(smoke).toMatch(/vus:\s*1/);
    expect(baseline).toMatch(/rate:\s*20/);
    expect(baseline).toMatch(/duration:\s*'2m'/);
    expect(baseline).toMatch(/duration:\s*'15m'/);
    expect(baseline).toMatch(/maxVUs:\s*25/);
    expect(spike).toMatch(/target:\s*20/);
    expect(spike).toMatch(/target:\s*50/);
    expect(spike).toMatch(/duration:\s*'2m'/);
    expect(common).toMatch(/http_req_failed[^\n]*rate<0\.01/);
    for (const metric of [
      'read_duration', 'write_duration', 'catalog_duration', 'auth_duration',
      'consultation_create_duration', 'chat_duration', 'checkout_sandbox_duration',
    ]) {
      expect(common).toContain(`'${metric}{phase:measure}'`);
    }
    expect(common).toMatch(/metric\.add\(response\.timings\.duration,\s*\{ phase \}\)/);
    expect(common).toMatch(/catalog[^\n]*p\(95\)<500/);
    expect(common).toMatch(/auth[^\n]*p\(95\)<800/);
    expect(common).toMatch(/consultation_create[^\n]*p\(95\)<1000/);
    expect(common).toMatch(/chat[^\n]*p\(95\)<500/);
    expect(common).toMatch(/checkout_sandbox[^\n]*p\(95\)<1000/);
    expect(common).toMatch(/checkout_duplicates[^\n]*count==0/);
    expect(common).toMatch(/verification_failures[^\n]*count==0/);
    expect(common).toMatch(/verificationFailures\.add\(0\)/);
    expect(common).toMatch(/export function teardownHarness/);
    expect(common).toMatch(/\/api\/load-test\/verify/);
    expect(common).toMatch(/requestParams\(token,\s*'checkout-verification',\s*'verify'\)/);
    expect(common).toMatch(/load:\$\{data\.runId\}:checkout/);
    expect(common).toMatch(/hostSet\(DEFAULT_PRODUCTION_HOSTS\)[\s\S]*hostSet\(__ENV\.LOAD_TEST_PRODUCTION_HOSTS\)/);
    expect(common).toMatch(/\/api\/load-test\/preflight\?profile=/);
    expect(common).toMatch(/preflight[^\n]*safe/);
    expect(common).toMatch(/\{5,39\}/);
    expect(common).toMatch(/cleanup_failures[^\n]*count==0/);
    expect(common).toMatch(/LOAD_TARGET_DB_FINGERPRINT/);
    expect(common).toMatch(/\/api\/e2e\/integrations\/status/);
    expect(common).toMatch(/databaseFingerprint\s*!==\s*expectedFingerprint/);
    expect(common).toMatch(/\/api\/load-test\/runs\//);
    expect(common).toMatch(/export function summaryHarness/);
    for (const script of [smoke, baseline, spike]) {
      expect(script).toMatch(/export function handleSummary/);
      expect(script).toMatch(/summaryHarness/);
    }
  });

  test('internal launcher mounts the sandbox route before the shared app and binds loopback by default', () => {
    const source = fs.readFileSync(internalServerPath, 'utf8');
    expect(spawnSync(process.execPath, ['--check', internalServerPath], { encoding: 'utf8' }))
      .toMatchObject({ status: 0, stderr: '' });
    expect(source).toMatch(/app\.use\('\/api\/load-test',\s*loadTestRouter\)/);
    expect(source).toMatch(/app\.use\(sharedApp\)/);
    expect(source.indexOf("app.use('/api/load-test', loadTestRouter)"))
      .toBeLessThan(source.indexOf('app.use(sharedApp)'));
    expect(source).toMatch(/LOAD_TEST_BIND_HOST\s*\|\|\s*'127\.0\.0\.1'/);
  });

  test('summary validator requires auditable metadata and rejects production targets', () => {
    const { validateSummary } = require(summaryValidatorPath);
    const artifact = {
      metadata: {
        schemaVersion: 1,
        runId: 'run-123',
        profile: 'baseline',
        seedVersion: 'p3-task8-v1',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
        targetOrigin: 'https://api.staging.example.test',
        startedAt: '2026-08-18T10:00:00.000Z',
        completedAt: '2026-08-18T10:17:00.000Z',
      },
      summary: { metrics: {} },
    };
    expect(validateSummary(artifact)).toEqual(artifact.metadata);
    expect(() => validateSummary({
      ...artifact,
      metadata: { ...artifact.metadata, targetOrigin: 'https://api.maslaxat.uz' },
    })).toThrow('production');
    expect(() => validateSummary({
      ...artifact,
      metadata: { ...artifact.metadata, commitSha: '' },
    })).toThrow('commitSha');
  });
});

test('load-test route remains unmounted from the shared server', () => {
  const server = fs.readFileSync(path.join(apiRoot, 'src/server.js'), 'utf8');
  expect(server).not.toMatch(/routes\/load-test|require\(['"]\.\/routes\/load-test|\/api\/load-test/);
});
