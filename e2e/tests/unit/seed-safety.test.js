const assert = require('node:assert/strict');
const test = require('node:test');

const seedPath = '../../../backend/api/src/seeds/e2e-seed';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('seed safety rejects production before models can load', () => {
  const { assertSafeEnvironment } = require(seedPath);
  assert.throws(() => assertSafeEnvironment({
    NODE_ENV: 'production',
    DB_NAME: 'emaslaxat_e2e',
    E2E_CONFIRM_DATABASE: 'emaslaxat_e2e',
    E2E_RUN_ID: 'run-1',
  }), /production/i);
});

test('seed safety requires exact configured database confirmation', () => {
  const { assertSafeEnvironment } = require(seedPath);
  assert.throws(() => assertSafeEnvironment({
    NODE_ENV: 'test',
    DB_NAME: 'emaslaxat_e2e',
    E2E_CONFIRM_DATABASE: 'another_e2e',
    E2E_RUN_ID: 'run-1',
  }), /confirmation/i);
});

test('seed safety permits only explicit test or staging environments', () => {
  const { assertSafeEnvironment } = require(seedPath);
  assert.throws(() => assertSafeEnvironment({
    NODE_ENV: 'development',
    DB_NAME: 'emaslaxat_e2e',
    E2E_CONFIRM_DATABASE: 'emaslaxat_e2e',
    E2E_RUN_ID: 'run-1',
  }), /test or staging/i);
});

test('seed safety refuses production-like database identities', () => {
  const { assertSafeEnvironment } = require(seedPath);
  assert.throws(() => assertSafeEnvironment({
    NODE_ENV: 'staging',
    DB_NAME: 'emaslaxat_production_staging',
    E2E_CONFIRM_DATABASE: 'emaslaxat_production_staging',
    E2E_RUN_ID: 'run-1',
  }), /production/i);
});

test('seed safety accepts an explicit isolated database and run id', () => {
  const { assertSafeEnvironment } = require(seedPath);
  assert.deepEqual(assertSafeEnvironment({
    NODE_ENV: 'test',
    DB_NAME: 'emaslaxat_e2e',
    E2E_CONFIRM_DATABASE: 'emaslaxat_e2e',
    E2E_RUN_ID: 'task7-run-1',
  }), { database: 'emaslaxat_e2e', runId: 'task7-run-1' });
});

test('verify command proves safety without opening a database connection', () => {
  const script = path.resolve(__dirname, '../../../backend/api/src/seeds/e2e-seed.js');
  const result = spawnSync(process.execPath, [script, 'verify'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_NAME: 'emaslaxat_e2e',
      E2E_CONFIRM_DATABASE: 'emaslaxat_e2e',
      E2E_RUN_ID: 'task7-run-1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    safe: true, database: 'emaslaxat_e2e', runId: 'task7-run-1',
  });
});

test('cleanup is idempotent when no run-owned records exist', async () => {
  const { cleanup } = require(seedPath);
  const destroyed = [];
  const model = (name) => ({ destroy: async () => { destroyed.push(name); return 0; } });
  const models = {
    User: { findAll: async () => [], destroy: model('User').destroy },
    ProfileImportAudit: model('ProfileImportAudit'), LawyerProfileImport: model('LawyerProfileImport'),
    Message: model('Message'), Document: model('Document'), LawyerPromotion: model('LawyerPromotion'),
    Payment: model('Payment'), Consultation: model('Consultation'), AuthChallenge: model('AuthChallenge'),
    Notification: model('Notification'), Subscription: model('Subscription'), LawyerProfile: model('LawyerProfile'),
    PromotionPackage: model('PromotionPackage'),
    PlatformSettingAudit: model('PlatformSettingAudit'),
    sequelize: { transaction: async (callback) => callback({}) },
  };
  const result = await cleanup({
    env: { NODE_ENV: 'test', DB_NAME: 'emaslaxat_e2e', E2E_CONFIRM_DATABASE: 'emaslaxat_e2e', E2E_RUN_ID: 'run-1' },
    models,
  });
  assert.deepEqual(result, { cleaned: true, runId: 'run-1' });
  assert.equal(destroyed.includes('User'), true);
  assert.ok(destroyed.indexOf('Payment') < destroyed.indexOf('LawyerPromotion'), 'payments must be removed before their promotion subjects');
  assert.ok(destroyed.indexOf('PlatformSettingAudit') < destroyed.indexOf('User'), 'run-owned audit rows must be removed before users');
});

test('cleanup refuses a deterministic resource collision not owned by the run', async () => {
  const { cleanup, dataset } = require(seedPath);
  const state = dataset('run-1');
  const empty = { destroy: async () => 0 };
  const models = {
    User: { findAll: async () => [], destroy: empty.destroy },
    ProfileImportAudit: empty, LawyerProfileImport: empty, Message: empty, Document: empty,
    LawyerPromotion: empty, Payment: empty, Consultation: empty, AuthChallenge: empty,
    Notification: empty, Subscription: empty, LawyerProfile: empty,
    PromotionPackage: {
      ...empty,
      findByPk: async (id) => id === state.resources.packageId ? { id, code: 'UNRELATED' } : null,
    },
    PlatformSettingAudit: empty,
    sequelize: { transaction: async (callback) => callback({}) },
  };
  await assert.rejects(cleanup({
    env: { NODE_ENV: 'test', DB_NAME: 'emaslaxat_e2e', E2E_CONFIRM_DATABASE: 'emaslaxat_e2e', E2E_RUN_ID: 'run-1' },
    models,
  }), /resource collision/i);
});

test('database cleanup refuses to orphan storage-backed private records', async () => {
  const { cleanup } = require(seedPath);
  const empty = { destroy: async () => 0 };
  const models = {
    User: { findAll: async () => [], destroy: empty.destroy },
    ProfileImportAudit: empty,
    LawyerProfileImport: { ...empty, findAll: async () => [{ id: 'private-import', storageKey: 'profile-imports/private.pdf' }] },
    Message: empty, Document: { ...empty, findAll: async () => [] }, LawyerPromotion: empty,
    Payment: empty, Consultation: empty, AuthChallenge: empty, Notification: empty,
    Subscription: empty, LawyerProfile: empty, PlatformSettingAudit: empty,
    PromotionPackage: { ...empty, findByPk: async () => null },
    sequelize: { transaction: async (callback) => callback({}) },
  };
  await assert.rejects(cleanup({
    env: { NODE_ENV: 'test', DB_NAME: 'emaslaxat_e2e', E2E_CONFIRM_DATABASE: 'emaslaxat_e2e', E2E_RUN_ID: 'run-1' },
    models,
  }), /application cleanup/i);
});

test('seed creates a paid refundable campaign isolated from sponsored catalog fixtures', async () => {
  const { seed } = require(seedPath);
  const created = { promotions: [], payments: [] };
  const empty = { destroy: async () => 0 };
  const models = {
    User: { findAll: async () => [], destroy: empty.destroy, create: async () => ({}) },
    ProfileImportAudit: empty, LawyerProfileImport: { ...empty, create: async () => ({}) },
    Message: { ...empty, create: async () => ({}) }, Document: { ...empty, create: async () => ({}) },
    LawyerPromotion: { ...empty, create: async (value) => { created.promotions.push(value); return value; } },
    Payment: { ...empty, create: async (value) => { created.payments.push(value); return value; } },
    Consultation: { ...empty, bulkCreate: async () => [] }, AuthChallenge: empty,
    Notification: empty, Subscription: empty,
    LawyerProfile: { ...empty, create: async () => ({}) },
    LawyerDocument: { ...empty, create: async () => ({}) },
    PromotionPackage: { ...empty, findByPk: async () => null, create: async () => ({}) },
    PlatformSettingAudit: empty,
    sequelize: { transaction: async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }) },
  };
  const state = await seed({
    env: { NODE_ENV: 'test', DB_NAME: 'emaslaxat_e2e', E2E_CONFIRM_DATABASE: 'emaslaxat_e2e', E2E_RUN_ID: 'run-1' },
    models,
  });
  const refundable = created.promotions.find(({ id }) => id === state.resources.refundPromotionId);
  assert.equal(refundable.status, 'paused');
  assert.equal(refundable.specialization, 'E2E Refund Isolation');
  assert.deepEqual(created.payments.find(({ lawyerPromotionId }) => lawyerPromotionId === refundable.id), {
    id: state.resources.refundPaymentId,
    userId: state.actors.lawyer.id,
    lawyerPromotionId: refundable.id,
    purpose: 'lawyer_promotion',
    amount: 100000,
    amountTiyin: 10000000,
    currency: 'UZS',
    provider: 'payme',
    status: 'paid',
    idempotencyKey: `e2e-refund-run-1`,
    providerTransactionId: `e2e-refund-run-1`,
    paidAt: refundable.paidAt,
    providerData: { sandbox: true, e2eRunId: 'run-1' },
  });
});
