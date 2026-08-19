const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/server');
const {
  resetDb,
  models,
  tokenFor,
  makeAdmin: makeAdminFixture,
  makeClient,
  makeLawyer,
} = require('./helpers');
const { createCheckout, markPaymentPaid, markProviderRefunded } = require('../src/services/paymentService');
const { createPromotionCheckout, reservePromotion } = require('../src/services/promotionService');

const {
  FinancialTransaction,
  LawyerDocument,
  LawyerPromotion,
  Payment,
  PlatformSettingAudit,
  PromotionPackage,
} = models;

const SCOPE = { specialization: 'Гражданское право', location: 'Ташкент' };

beforeAll(async () => {
  await resetDb();
});

afterEach(() => jest.restoreAllMocks());

async function makePackage(overrides = {}) {
  return PromotionPackage.create({
    code: `TOP_${Math.random().toString(36).slice(2)}`,
    name: { ru: 'TOP', uz: 'TOP', en: 'TOP' },
    placement: 'catalog_top',
    durationDays: 7,
    priceAmountTiyin: 7000000,
    currency: 'UZS',
    maxActiveSlots: 2,
    sponsoredPositions: [0, 3],
    isActive: true,
    displayOrder: 10,
    ...overrides,
  });
}

async function makeAdmin(email) {
  const user = await makeAdminFixture(email);
  await user.update({ twoFactorEnabled: true });
  return user;
}

async function eligibleLawyer(email, profile = {}) {
  const result = await makeLawyer(email, {
    location: SCOPE.location,
    promotionPilotEnabled: true,
    ...profile,
  });
  await result.user.update({ twoFactorEnabled: true });
  const approver = await makeAdmin(`approver-${email}`);
  await LawyerDocument.create({
    userId: result.user.id,
    name: 'license.pdf',
    path: '/tmp/license.pdf',
    type: 'license',
    verificationStatus: 'approved',
    approvedByUserId: approver.id,
    approvedAt: new Date(),
  });
  return result;
}

function auth(user) {
  const mode = user.role === 'admin' ? 'admin' : user.role === 'lawyer' ? 'lawyer' : 'client';
  return { Authorization: `Bearer ${tokenFor(user, user.role === 'client' ? 'primary' : 'mfa')}`, 'X-Maslaxat-Mode': mode };
}

test('public package list returns active packages only and exposes no internal timestamps', async () => {
  const active = await makePackage({ displayOrder: 1 });
  await makePackage({ isActive: false, displayOrder: 0 });

  const response = await request(app).get('/api/promotion-packages');

  expect(response.status).toBe(200);
  expect(response.body.packages.map((row) => row.id)).toEqual([active.id]);
  expect(response.body.packages[0]).toEqual(expect.objectContaining({
    code: active.code,
    durationDays: 7,
    priceAmountTiyin: 7000000,
    currency: 'UZS',
  }));
  expect(response.body.packages[0].createdAt).toBeUndefined();
  expect(response.body.packages[0].updatedAt).toBeUndefined();
});

test('checkout rejects clients, pending lawyers, and an intermediate 2FA token', async () => {
  const promotionPackage = await makePackage();
  const client = await makeClient('promotion-api-client@test.uz');
  const pending = await eligibleLawyer('promotion-api-pending@test.uz', { verificationStatus: 'pending' });
  const eligible = await eligibleLawyer('promotion-api-2fa@test.uz');
  const body = { packageId: promotionPackage.id, ...SCOPE };

  const [clientResponse, pendingResponse, twoFactorResponse] = await Promise.all([
    request(app).post('/api/lawyer/promotions/checkout').set(auth(client)).set('Idempotency-Key', 'client-key').send(body),
    request(app).post('/api/lawyer/promotions/checkout').set(auth(pending.user)).set('Idempotency-Key', 'pending-key').send(body),
    request(app).post('/api/lawyer/promotions/checkout')
      .set('Authorization', `Bearer ${jwt.sign({ id: eligible.user.id, twofa: 'pending' }, process.env.JWT_SECRET)}`)
      .set('Idempotency-Key', '2fa-key').send(body),
  ]);

  expect(clientResponse.status).toBe(403);
  expect(pendingResponse.status).toBe(403);
  expect(twoFactorResponse.status).toBe(401);
  expect(await LawyerPromotion.count()).toBe(0);
});

test('checkout ignores browser price and same-key retries return the same server-priced payment', async () => {
  const promotionPackage = await makePackage({ priceAmountTiyin: 1234567 });
  const { user } = await eligibleLawyer('promotion-api-price@test.uz');
  const payload = { packageId: promotionPackage.id, ...SCOPE, amount: 1, amountTiyin: 1, priority: 999 };

  const first = await request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(user)).set('Idempotency-Key', 'same-price-key').send(payload);
  const retry = await request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(user)).set('Idempotency-Key', 'same-price-key').send(payload);

  expect(first.status).toBe(201);
  expect(retry.status).toBe(200);
  expect(retry.body.paymentId).toBe(first.body.paymentId);
  expect(retry.body.promotion.id).toBe(first.body.promotion.id);
  expect(first.body.amountTiyin).toBe(1234567);
  expect(await Payment.count({ where: { lawyerPromotionId: first.body.promotion.id } })).toBe(1);
  expect(first.body.providerData).toBeUndefined();
  expect(first.body.providerResponse).toBeUndefined();
  expect(first.body.providerTransactionId).toBeUndefined();
});

test('concurrent same-key checkout creates one campaign and one payment', async () => {
  const promotionPackage = await makePackage();
  const { user } = await eligibleLawyer('promotion-api-concurrent@test.uz');
  const build = () => request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(user)).set('Idempotency-Key', 'concurrent-checkout-key')
    .send({ packageId: promotionPackage.id, ...SCOPE });

  const responses = await Promise.all([build(), build()]);

  expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
  expect(new Set(responses.map((response) => response.body.paymentId)).size).toBe(1);
  expect(await LawyerPromotion.count({ where: { lawyerId: user.id } })).toBe(1);
  expect(await Payment.count({ where: { userId: user.id, purpose: 'lawyer_promotion' } })).toBe(1);
  const campaign = await LawyerPromotion.findOne({ where: { lawyerId: user.id } });
  expect(await PlatformSettingAudit.count({
    where: { key: `promotion_checkout:${campaign.id}:reserved`, changedByUserId: user.id },
  })).toBe(1);
});

test('checkout rejects disabled packages, malformed identifiers, and overlong idempotency keys', async () => {
  const disabled = await makePackage({ isActive: false });
  const { user } = await eligibleLawyer('promotion-api-disabled@test.uz');

  const [disabledResponse, malformedResponse, longKeyResponse] = await Promise.all([
    request(app).post('/api/lawyer/promotions/checkout').set(auth(user)).set('Idempotency-Key', 'disabled-key')
      .send({ packageId: disabled.id, ...SCOPE }),
    request(app).post('/api/lawyer/promotions/checkout').set(auth(user)).set('Idempotency-Key', 'bad-id')
      .send({ packageId: 'not-a-uuid', ...SCOPE }),
    request(app).post('/api/lawyer/promotions/checkout').set(auth(user)).set('Idempotency-Key', 'x'.repeat(256))
      .send({ packageId: disabled.id, ...SCOPE }),
  ]);

  expect(disabledResponse.status).toBe(409);
  expect(malformedResponse.status).toBe(400);
  expect(longKeyResponse.status).toBe(400);
});

test('lawyer history and detail are owner-scoped and sanitized', async () => {
  const promotionPackage = await makePackage();
  const owner = await eligibleLawyer('promotion-api-owner@test.uz');
  const outsider = await eligibleLawyer('promotion-api-outsider@test.uz');
  const checkout = await request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(owner.user)).set('Idempotency-Key', 'owner-history-key')
    .send({ packageId: promotionPackage.id, ...SCOPE });
  expect(checkout.status).toBe(201);

  const history = await request(app).get('/api/lawyer/promotions?page=1&limit=10').set(auth(owner.user));
  const detail = await request(app).get(`/api/lawyer/promotions/${checkout.body.promotion.id}`).set(auth(owner.user));
  const forbidden = await request(app).get(`/api/lawyer/promotions/${checkout.body.promotion.id}`).set(auth(outsider.user));

  expect(history.status).toBe(200);
  expect(history.body).toEqual(expect.objectContaining({ page: 1, limit: 10, total: 1 }));
  expect(detail.status).toBe(200);
  expect(detail.body.promotion.id).toBe(checkout.body.promotion.id);
  expect(detail.body.promotion.idempotencyKey).toBeUndefined();
  expect(detail.body.payment.providerData).toBeUndefined();
  expect(detail.body.payment.providerResponse).toBeUndefined();
  expect(detail.body.payment.transactionId).toBeUndefined();
  expect(forbidden.status).toBe(404);
});

test('promotion reads enforce UUID and bounded pagination validation', async () => {
  const { user } = await eligibleLawyer('promotion-api-pagination@test.uz');

  const [badId, badPage, excessiveLimit] = await Promise.all([
    request(app).get('/api/lawyer/promotions/not-a-uuid').set(auth(user)),
    request(app).get('/api/lawyer/promotions?page=0').set(auth(user)),
    request(app).get('/api/lawyer/promotions?limit=101').set(auth(user)),
  ]);

  expect(badId.status).toBe(400);
  expect(badPage.status).toBe(400);
  expect(excessiveLimit.status).toBe(400);
});

test('checkout rate limit bounds repeated abuse per authenticated lawyer', async () => {
  const promotionPackage = await makePackage({ isActive: false });
  const { user } = await eligibleLawyer('promotion-api-rate@test.uz');
  const call = () => request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(user)).set('Idempotency-Key', `rate-${Math.random()}`)
    .send({ packageId: promotionPackage.id, ...SCOPE });

  const responses = [];
  for (let index = 0; index < 21; index += 1) responses.push(await call());

  expect(responses.slice(0, 20).every((response) => response.status === 409)).toBe(true);
  expect(responses[20].status).toBe(429);
});

test('admin promotion controls require a full admin token', async () => {
  const client = await makeClient('promotion-api-admin-client@test.uz');
  const admin = await makeAdmin('promotion-api-admin-2fa@test.uz');
  const pendingToken = jwt.sign({ id: admin.id, twofa: 'pending' }, process.env.JWT_SECRET);

  const [anonymous, clientResponse, pending2fa] = await Promise.all([
    request(app).get('/api/admin/promotion-packages'),
    request(app).get('/api/admin/promotion-packages').set(auth(client)),
    request(app).get('/api/admin/promotion-packages').set('Authorization', `Bearer ${pendingToken}`),
  ]);

  expect(anonymous.status).toBe(401);
  expect(clientResponse.status).toBe(403);
  expect(pending2fa.status).toBe(401);
});

test('admin package CRUD validates values, soft-deactivates, and records actor audit metadata', async () => {
  const admin = await makeAdmin('promotion-api-package-admin@test.uz');
  const payload = {
    code: 'TOP_ADMIN_7',
    name: { ru: 'Топ', uz: 'Top', en: 'Top' },
    placement: 'catalog_top',
    durationDays: 7,
    priceAmountTiyin: 9900000,
    currency: 'UZS',
    maxActiveSlots: 2,
    sponsoredPositions: [0, 3],
    displayOrder: 4,
  };

  const invalid = await request(app).post('/api/admin/promotion-packages').set(auth(admin))
    .send({ ...payload, durationDays: 8, maxActiveSlots: 0 });
  const created = await request(app).post('/api/admin/promotion-packages').set(auth(admin)).send(payload);
  expect(created.status).toBe(201);
  const updated = await request(app).put(`/api/admin/promotion-packages/${created.body.package.id}`)
    .set(auth(admin)).send({ ...payload, priceAmountTiyin: 10900000 });
  const disabled = await request(app).delete(`/api/admin/promotion-packages/${created.body.package.id}`)
    .set(auth(admin)).send({ reason: 'pilot capacity review' });
  const enabled = await request(app).patch(`/api/admin/promotion-packages/${created.body.package.id}/activation`)
    .set(auth(admin)).send({ isActive: true, reason: 'pilot resumed' });

  expect(invalid.status).toBe(400);
  expect(created.status).toBe(201);
  expect(updated.body.package.priceAmountTiyin).toBe(10900000);
  expect(disabled.body.package.isActive).toBe(false);
  expect(enabled.body.package.isActive).toBe(true);
  const audits = await PlatformSettingAudit.findAll({ where: { changedByUserId: admin.id } });
  expect(audits).toHaveLength(4);
  expect(audits.every((audit) => audit.key.startsWith('promotion_package:'))).toBe(true);
  expect(audits.some((audit) => audit.newValue.includes('pilot resumed'))).toBe(true);
});

test('admin package creation is always unpublished and rejects direct activation input', async () => {
  const admin = await makeAdmin('promotion-api-inactive-create-admin@test.uz');
  const payload = {
    code: 'TOP_UNPUBLISHED_7',
    name: { ru: 'Новый пакет', uz: 'Yangi paket', en: 'New package' },
    placement: 'catalog_top',
    durationDays: 7,
    priceAmountTiyin: 9100000,
    currency: 'UZS',
    maxActiveSlots: 2,
    sponsoredPositions: [0, 3],
    displayOrder: 9,
  };

  const created = await request(app).post('/api/admin/promotion-packages').set(auth(admin)).send(payload);
  const directActivation = await request(app).post('/api/admin/promotion-packages')
    .set(auth(admin)).send({ ...payload, code: 'TOP_DIRECT_ACTIVE', isActive: true });

  expect(created.status).toBe(201);
  expect(created.body.package.isActive).toBe(false);
  expect(directActivation.status).toBe(400);
  const publicList = await request(app).get('/api/promotion-packages');
  expect(publicList.body.packages.some((row) => row.id === created.body.package.id)).toBe(false);
});

test('package audit rows retain complete before and after configuration snapshots', async () => {
  const admin = await makeAdmin('promotion-api-full-audit-admin@test.uz');
  const promotionPackage = await makePackage({ isActive: false, displayOrder: 17 });
  const update = {
    code: promotionPackage.code,
    name: { ru: 'Полный снимок', uz: 'To‘liq surat', en: 'Full snapshot' },
    placement: 'catalog_top',
    durationDays: 30,
    priceAmountTiyin: 31000000,
    currency: 'UZS',
    maxActiveSlots: 7,
    sponsoredPositions: [1, 4],
    displayOrder: 23,
  };

  const response = await request(app).put(`/api/admin/promotion-packages/${promotionPackage.id}`)
    .set(auth(admin)).send(update);

  expect(response.status).toBe(200);
  const audit = await PlatformSettingAudit.findOne({
    where: { key: `promotion_package:${promotionPackage.id}:update`, changedByUserId: admin.id },
  });
  const before = JSON.parse(audit.oldValue);
  const after = JSON.parse(audit.newValue);
  const fields = [
    'code', 'name', 'placement', 'durationDays', 'priceAmountTiyin', 'currency',
    'maxActiveSlots', 'sponsoredPositions', 'displayOrder', 'isActive',
  ];
  expect(before).toEqual(expect.objectContaining(Object.fromEntries(fields.map((field) => [field, expect.anything()]))));
  expect(after).toEqual(expect.objectContaining({ ...update, code: update.code.toUpperCase(), isActive: false }));
});

test('editing a disabled package cannot implicitly reactivate it', async () => {
  const admin = await makeAdmin('promotion-api-disabled-edit-admin@test.uz');
  const promotionPackage = await makePackage({ isActive: false });
  const payload = {
    code: promotionPackage.code,
    name: promotionPackage.name,
    placement: 'catalog_top',
    durationDays: 7,
    priceAmountTiyin: 8100000,
    currency: 'UZS',
    maxActiveSlots: 2,
    sponsoredPositions: [0, 3],
    displayOrder: 2,
  };

  const response = await request(app).put(`/api/admin/promotion-packages/${promotionPackage.id}`)
    .set(auth(admin)).send(payload);

  expect(response.status).toBe(200);
  expect(response.body.package.isActive).toBe(false);
  await promotionPackage.reload();
  expect(promotionPackage.isActive).toBe(false);
});

test('admin explicitly enables an approved lawyer pilot with reasoned audit metadata', async () => {
  const admin = await makeAdmin('promotion-api-pilot-admin@test.uz');
  const lawyer = await eligibleLawyer('promotion-api-pilot-lawyer@test.uz', { promotionPilotEnabled: false });
  const license = await LawyerDocument.findOne({ where: { userId: lawyer.user.id, type: 'license' } });
  const approval = await request(app)
    .patch(`/api/admin/lawyers/${lawyer.user.id}/verification-documents/${license.id}/status`)
    .set(auth(admin)).send({ status: 'approved', reason: 'license checked for pilot' });
  expect(approval.status).toBe(200);

  const response = await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'invited to closed pilot' });

  expect(response.status).toBe(200);
  expect(response.body).toEqual({ lawyerId: lawyer.user.id, promotionPilotEnabled: true });
  await lawyer.lp.reload();
  expect(lawyer.lp.promotionPilotEnabled).toBe(true);
  const audit = await PlatformSettingAudit.findOne({
    where: { key: `promotion_pilot:${lawyer.user.id}`, changedByUserId: admin.id },
  });
  expect(audit).not.toBeNull();
  expect(JSON.parse(audit.newValue)).toEqual(expect.objectContaining({
    enabled: true,
    reason: 'invited to closed pilot',
  }));
});

test('pilot enable rejects arbitrary or unapproved documents and accepts an admin-approved license', async () => {
  const admin = await makeAdmin('promotion-api-document-admin@test.uz');
  const lawyer = await makeLawyer('promotion-api-document-lawyer@test.uz', {
    location: SCOPE.location,
    promotionPilotEnabled: false,
  });
  await LawyerDocument.create({
    userId: lawyer.user.id,
    name: 'notes.txt',
    path: '/tmp/notes.txt',
    type: 'other',
  });

  const arbitrary = await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'must not accept arbitrary upload' });
  expect(arbitrary.status).toBe(409);

  const license = await LawyerDocument.create({
    userId: lawyer.user.id,
    name: 'license.pdf',
    path: '/tmp/license.pdf',
    type: 'license',
  });
  const unapproved = await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'must not accept pending license' });
  expect(unapproved.status).toBe(409);

  const approved = await request(app)
    .patch(`/api/admin/lawyers/${lawyer.user.id}/verification-documents/${license.id}/status`)
    .set(auth(admin)).send({ status: 'approved', reason: 'license checked' });
  expect(approved.status).toBe(200);

  const enabled = await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'qualified license approved' });
  expect(enabled.status).toBe(200);
});

test('pilot enable locks and rechecks license approval before enabling', async () => {
  const admin = await makeAdmin('promotion-api-document-lock-admin@test.uz');
  const lawyer = await makeLawyer('promotion-api-document-lock-lawyer@test.uz', {
    location: SCOPE.location,
    promotionPilotEnabled: false,
  });
  const license = await LawyerDocument.create({
    userId: lawyer.user.id,
    name: 'locked-license.pdf',
    path: '/tmp/locked-license.pdf',
    type: 'license',
    verificationStatus: 'approved',
    approvedByUserId: admin.id,
    approvedAt: new Date(),
  });
  const transaction = await models.sequelize.transaction();
  const locked = await LawyerDocument.findByPk(license.id, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  await locked.update({ verificationStatus: 'rejected' }, { transaction });

  const enablePromise = request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'recheck locked license' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await transaction.commit();
  const response = await enablePromise;

  expect(response.status).toBe(409);
  await lawyer.lp.reload();
  expect(lawyer.lp.promotionPilotEnabled).toBe(false);
});

test('checkout rejects a lawyer whose approved license was rejected after pilot enable', async () => {
  const admin = await makeAdmin('promotion-api-license-reject-admin@test.uz');
  const lawyer = await makeLawyer('promotion-api-license-reject-lawyer@test.uz', {
    location: SCOPE.location,
    promotionPilotEnabled: false,
  });
  const license = await LawyerDocument.create({
    userId: lawyer.user.id,
    name: 'license-reject.pdf',
    path: '/tmp/license-reject.pdf',
    type: 'license',
  });
  await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/verification-documents/${license.id}/status`)
    .set(auth(admin)).send({ status: 'approved', reason: 'initial license approval' });
  const enabled = await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/promotion-pilot`)
    .set(auth(admin)).send({ enabled: true, reason: 'qualified for pilot' });
  expect(enabled.status).toBe(200);
  await request(app).patch(`/api/admin/lawyers/${lawyer.user.id}/verification-documents/${license.id}/status`)
    .set(auth(admin)).send({ status: 'rejected', reason: 'license later invalidated' });
  const promotionPackage = await makePackage();

  const checkout = await request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(lawyer.user)).set('Idempotency-Key', 'rejected-license-checkout')
    .send({ packageId: promotionPackage.id, ...SCOPE });

  expect(checkout.status).toBe(403);
  expect(await LawyerPromotion.count({ where: { lawyerId: lawyer.user.id } })).toBe(0);
  expect(await Payment.count({ where: { userId: lawyer.user.id, purpose: 'lawyer_promotion' } })).toBe(0);
});

test('admin package list uses strict bounded pagination metadata', async () => {
  const admin = await makeAdmin('promotion-api-package-list-admin@test.uz');
  await Promise.all([
    makePackage({ displayOrder: 31 }),
    makePackage({ displayOrder: 32 }),
    makePackage({ displayOrder: 33 }),
  ]);

  const response = await request(app).get('/api/admin/promotion-packages?page=2&limit=2').set(auth(admin));
  const excessive = await request(app).get('/api/admin/promotion-packages?limit=101').set(auth(admin));
  const unknown = await request(app).get('/api/admin/promotion-packages?sort=unsafe').set(auth(admin));

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({ page: 2, limit: 2 }));
  expect(response.body.total).toBeGreaterThanOrEqual(3);
  expect(response.body.totalPages).toBe(Math.ceil(response.body.total / 2));
  expect(response.body.packages.length).toBeLessThanOrEqual(2);
  expect(excessive.status).toBe(400);
  expect(unknown.status).toBe(400);
});

test('payment persistence failure rolls back the promotion reservation', async () => {
  const promotionPackage = await makePackage();
  const lawyer = await eligibleLawyer('promotion-api-payment-failure@test.uz');
  jest.spyOn(Payment, 'create').mockRejectedValueOnce(new Error('injected payment persistence failure'));

  const response = await request(app).post('/api/lawyer/promotions/checkout')
    .set(auth(lawyer.user)).set('Idempotency-Key', 'rollback-payment-failure')
    .send({ packageId: promotionPackage.id, ...SCOPE });

  expect(response.status).toBe(500);
  expect(await LawyerPromotion.count({ where: { lawyerId: lawyer.user.id } })).toBe(0);
  expect(await Payment.count({ where: { userId: lawyer.user.id, purpose: 'lawyer_promotion' } })).toBe(0);
  expect(await PlatformSettingAudit.count({ where: { changedByUserId: lawyer.user.id } })).toBe(0);
});

test('checkout URL failure rolls back both promotion reservation and payment', async () => {
  const promotionPackage = await makePackage();
  const lawyer = await eligibleLawyer('promotion-api-url-failure@test.uz');

  await expect(createPromotionCheckout({
    lawyerId: lawyer.user.id,
    packageId: promotionPackage.id,
    idempotencyKey: 'rollback-url-failure',
    checkoutUrlFactory: () => { throw new Error('injected promotion URL failure'); },
    ...SCOPE,
  })).rejects.toThrow(/promotion URL failure/i);

  expect(await LawyerPromotion.count({ where: { lawyerId: lawyer.user.id } })).toBe(0);
  expect(await Payment.count({ where: { userId: lawyer.user.id, purpose: 'lawyer_promotion' } })).toBe(0);
  expect(await PlatformSettingAudit.count({ where: { changedByUserId: lawyer.user.id } })).toBe(0);
});

test('admin campaign list applies strict filters and never returns provider secrets', async () => {
  const admin = await makeAdmin('promotion-api-campaign-admin@test.uz');
  const promotionPackage = await makePackage();
  const lawyer = await eligibleLawyer('promotion-api-campaign-lawyer@test.uz');
  const reserved = await reservePromotion({
    lawyerId: lawyer.user.id,
    packageId: promotionPackage.id,
    idempotencyKey: 'admin-list-key',
    ...SCOPE,
  });
  await createCheckout({
    userId: lawyer.user.id,
    purpose: 'lawyer_promotion',
    subjectId: reserved.promotion.id,
    idempotencyKey: 'admin-list-key',
  });

  const response = await request(app)
    .get(`/api/admin/promotions?status=pending_payment&lawyerId=${lawyer.user.id}&page=1&limit=1`)
    .set(auth(admin));
  const invalid = await request(app).get('/api/admin/promotions?status=hacked&limit=500').set(auth(admin));

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({ page: 1, limit: 1, total: 1 }));
  expect(response.body.campaigns[0].payment.providerData).toBeUndefined();
  expect(response.body.campaigns[0].payment.providerResponse).toBeUndefined();
  expect(response.body.campaigns[0].payment.providerTransactionId).toBeUndefined();
  expect(invalid.status).toBe(400);
});

test('admin cancellation of a provider-bound checkout records a request without fabricating cancellation', async () => {
  const admin = await makeAdmin('promotion-api-cancel-admin@test.uz');
  const promotionPackage = await makePackage();
  const lawyer = await eligibleLawyer('promotion-api-cancel-lawyer@test.uz');
  const reserved = await reservePromotion({
    lawyerId: lawyer.user.id,
    packageId: promotionPackage.id,
    idempotencyKey: 'admin-cancel-key',
    ...SCOPE,
  });
  const checkout = await createCheckout({
    userId: lawyer.user.id,
    purpose: 'lawyer_promotion',
    subjectId: reserved.promotion.id,
    idempotencyKey: 'admin-cancel-key',
  });
  await checkout.payment.update({ status: 'processing', providerTransactionId: 'provider-bound-transaction' });

  const response = await request(app).post(`/api/admin/promotions/${reserved.promotion.id}/cancel`)
    .set(auth(admin)).send({ reason: 'duplicate operator request' });

  expect(response.status).toBe(202);
  await checkout.payment.reload();
  await reserved.promotion.reload();
  expect(checkout.payment.status).toBe('processing');
  expect(checkout.payment.cancelledAt).toBeNull();
  expect(checkout.payment.providerData.cancellationRequest).toEqual(expect.objectContaining({
    requestedBy: admin.id,
    reason: 'duplicate operator request',
    state: 'requested',
  }));
  expect(reserved.promotion.status).toBe('pending_payment');
  expect(response.body.payment.providerData).toBeUndefined();
});

test('admin refund only requests provider action and does not reverse a paid campaign locally', async () => {
  const admin = await makeAdmin('promotion-api-refund-admin@test.uz');
  const promotionPackage = await makePackage({ priceAmountTiyin: 8800000 });
  const lawyer = await eligibleLawyer('promotion-api-refund-lawyer@test.uz');
  const reserved = await reservePromotion({
    lawyerId: lawyer.user.id,
    packageId: promotionPackage.id,
    idempotencyKey: 'admin-refund-key',
    ...SCOPE,
  });
  const checkout = await createCheckout({
    userId: lawyer.user.id,
    purpose: 'lawyer_promotion',
    subjectId: reserved.promotion.id,
    idempotencyKey: 'admin-refund-key',
  });
  await markPaymentPaid({
    paymentId: checkout.payment.id,
    providerTransactionId: 'admin-refund-provider-paid',
    amountTiyin: 8800000,
  });
  const postingsBefore = await FinancialTransaction.count({ where: { paymentId: checkout.payment.id } });

  const response = await request(app).post(`/api/admin/promotions/${reserved.promotion.id}/refund`)
    .set(auth(admin)).send({ reason: 'approved goodwill stop' });

  expect(response.status).toBe(202);
  await checkout.payment.reload();
  await reserved.promotion.reload();
  expect(checkout.payment.status).toBe('refund_pending');
  expect(checkout.payment.refundedAt).toBeNull();
  expect(Number(checkout.payment.refundedAmountTiyin)).toBe(0);
  expect(reserved.promotion.status).toBe('refund_pending');
  expect(reserved.promotion.refundedAt).toBeNull();
  expect(await FinancialTransaction.count({ where: { paymentId: checkout.payment.id } })).toBe(postingsBefore);
  expect(response.body.payment.providerData).toBeUndefined();
  const audit = await PlatformSettingAudit.findOne({
    where: { key: `promotion_campaign:${reserved.promotion.id}:refund_request`, changedByUserId: admin.id },
  });
  expect(audit).not.toBeNull();
});

test('admin refund request freezes active service time for a later exact provider-confirmed partial refund', async () => {
  const admin = await makeAdmin('promotion-api-partial-admin@test.uz');
  const promotionPackage = await makePackage({ priceAmountTiyin: 7000000 });
  const partialScope = { specialization: SCOPE.specialization, location: 'Самарканд' };
  const lawyer = await eligibleLawyer('promotion-api-partial-lawyer@test.uz', { location: partialScope.location });
  const reserved = await reservePromotion({
    lawyerId: lawyer.user.id,
    packageId: promotionPackage.id,
    idempotencyKey: 'admin-partial-key',
    ...partialScope,
  });
  const checkout = await createCheckout({
    userId: lawyer.user.id,
    purpose: 'lawyer_promotion',
    subjectId: reserved.promotion.id,
    idempotencyKey: 'admin-partial-key',
  });
  await markPaymentPaid({
    paymentId: checkout.payment.id,
    providerTransactionId: 'admin-partial-provider',
    amountTiyin: 7000000,
  });
  const requestedAt = new Date();
  const activeSince = new Date(requestedAt.getTime() - (2 * 24 * 60 * 60 * 1000) - (60 * 60 * 1000));
  await reserved.promotion.update({
    startsAt: activeSince,
    activeSince,
    endsAt: new Date(activeSince.getTime() + (7 * 24 * 60 * 60 * 1000)),
    remainingSeconds: 7 * 24 * 60 * 60,
  });

  const response = await request(app).post(`/api/admin/promotions/${reserved.promotion.id}/refund`)
    .set(auth(admin)).send({ reason: 'partial service refund' });
  expect(response.status).toBe(202);
  await checkout.payment.reload();
  const refundAmount = checkout.payment.providerData.promotionRefundRequest.amountTiyin;

  await expect(markProviderRefunded({
    paymentId: checkout.payment.id,
    amountTiyin: refundAmount,
    providerTransactionId: 'admin-partial-provider',
  })).resolves.toEqual(expect.objectContaining({ payment: expect.anything() }));
  await checkout.payment.reload();
  expect(checkout.payment.status).toBe('partially_refunded');
  expect(Number(checkout.payment.refundedAmountTiyin)).toBe(5000000);
});
