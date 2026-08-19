const Sequelize = require('sequelize');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeAdmin, makeLawyer } = require('./helpers');
const migration = require('../migrations/20260820000003-create-promotions');
const {
  reservePromotion,
  activatePaidPromotion,
  releasePromotionSlot,
  pauseIneligiblePromotion,
  cancelQueuedPromotion,
  confirmPromotionRefund,
} = require('../src/services/promotionService');
const {
  expireAndAdvancePromotions,
  resumeEligiblePromotions,
  recognizePromotionRevenue,
} = require('../src/services/promotionJobs');
const { ACCOUNTS } = require('../src/services/ledgerService');
const { createCheckout, markPaymentPaid, markProviderRefunded } = require('../src/services/paymentService');
const { runProdSeed } = require('../src/seeds/prod-seed');

const {
  sequelize,
  FinancialEntry,
  FinancialTransaction,
  LawyerDocument,
  LawyerPromotion,
  Payment,
  PromotionPackage,
} = models;

const DAY = 24 * 60 * 60 * 1000;
const SCOPE = { specialization: 'Гражданское право', location: 'Ташкент' };

beforeEach(async () => {
  await resetDb();
});

async function eligibleLawyer(email, overrides = {}) {
  const result = await makeLawyer(email, {
    location: SCOPE.location,
    promotionPilotEnabled: true,
    ...overrides,
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

async function packageFor(overrides = {}) {
  return PromotionPackage.create({
    code: `TOP_${overrides.durationDays || 7}_${Math.random()}`,
    name: { ru: 'TOP', uz: 'TOP', en: 'TOP' },
    placement: 'catalog_top',
    durationDays: 7,
    priceAmountTiyin: 7000000,
    currency: 'UZS',
    maxActiveSlots: 1,
    sponsoredPositions: [0, 3],
    isActive: true,
    ...overrides,
  });
}

async function paidCampaign({ lawyer, promotionPackage, key, reserved = true, paidAt = new Date(), scope = SCOPE }) {
  const reservedResult = await reservePromotion({
    lawyerId: lawyer.id,
    packageId: promotionPackage.id,
    ...scope,
    idempotencyKey: key,
  });
  const campaign = reservedResult.promotion;
  if (!reserved && campaign.reservationExpiresAt) {
    await campaign.update({ reservationExpiresAt: new Date(paidAt.getTime() - 1) });
  }
  const payment = await Payment.create({
    userId: lawyer.id,
    lawyerPromotionId: campaign.id,
    purpose: 'lawyer_promotion',
    amount: Number(promotionPackage.priceAmountTiyin) / 100,
    amountTiyin: promotionPackage.priceAmountTiyin,
    currency: 'UZS',
    provider: 'payme',
    status: 'paid',
    paidAt,
  });
  await campaign.update({ paymentId: payment.id });
  await sequelize.transaction((tx) => activatePaidPromotion(campaign.id, tx, paidAt));
  return { campaign: await LawyerPromotion.findByPk(campaign.id), payment };
}

test('only active approved complete pilot lawyers can reserve their own scope', async () => {
  const promotionPackage = await packageFor();
  const eligible = await eligibleLawyer('promotion-eligible@test.uz');
  const pending = await eligibleLawyer('promotion-pending@test.uz', { verificationStatus: 'pending' });
  const now = new Date('2026-08-20T00:00:00.000Z');

  const result = await reservePromotion({ lawyerId: eligible.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'eligible', now });
  expect(result.outcome).toBe('reserved');
  expect(result.promotion.reservationExpiresAt.getTime() - now.getTime()).toBe(30 * 60 * 1000);
  await expect(reservePromotion({ lawyerId: pending.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'pending' }))
    .rejects.toThrow(/eligible|approved|pilot/i);
});

test('promotion checkout concurrent with field verify/reject completes without lock-order deadlock', async () => {
  const promotionPackage = await packageFor();
  const { user: lawyer } = await eligibleLawyer('promotion-verification-lock-order@test.uz');
  const document = await LawyerDocument.findOne({ where: { userId: lawyer.id, type: 'license' } });
  const admin = await makeAdmin('promotion-verification-lock-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const profileService = require('../src/services/profileImportService').createProfileImportService({
    models,
    storage: {},
    parser: { isAvailable: () => true, parse: async () => ({}) },
    quota: { consume: async () => 1 },
  });
  const auth = { Authorization: `Bearer ${tokenFor(admin, 'mfa')}`, 'X-Maslaxat-Mode': 'admin' };

  const outcomes = await Promise.race([
    Promise.allSettled([
      reservePromotion({
        lawyerId: lawyer.id,
        packageId: promotionPackage.id,
        ...SCOPE,
        idempotencyKey: 'promotion-verification-lock-order',
      }),
      profileService.verifyProfileField({
        userId: lawyer.id,
        field: 'experience',
        documentId: document.id,
        reviewerUserId: admin.id,
      }),
      request(app)
        .patch(`/api/admin/lawyers/${lawyer.id}/verification-documents/${document.id}/status`)
        .set(auth)
        .send({ status: 'rejected', reason: 'Concurrent eligibility review' }),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cross-flow deadlock timeout')), 10000)),
  ]);

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      expect(outcome.reason?.original?.code || outcome.reason?.parent?.code).not.toBe('40P01');
    } else if (outcome.value?.status) {
      expect(outcome.value.status).toBeLessThan(500);
    }
  }
}, 60000);

test('concurrent reservations serialize capacity without ordering the unpaid queue', async () => {
  const promotionPackage = await packageFor({ maxActiveSlots: 1 });
  const [{ user: first }, { user: second }] = await Promise.all([
    eligibleLawyer('promotion-race-a@test.uz'),
    eligibleLawyer('promotion-race-b@test.uz'),
  ]);

  const results = await Promise.all([
    reservePromotion({ lawyerId: first.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'race-a' }),
    reservePromotion({ lawyerId: second.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'race-b' }),
  ]);

  expect(results.map((result) => result.outcome).sort()).toEqual(['queued_after_payment', 'reserved']);
  expect(await LawyerPromotion.count({ where: { status: 'pending_payment' } })).toBe(2);
  expect(await LawyerPromotion.count({ where: { reservationExpiresAt: { [Sequelize.Op.ne]: null } } })).toBe(1);
});

test('capacity is scope-wide and cannot be enlarged by choosing a different package', async () => {
  const strictPackage = await packageFor({ maxActiveSlots: 1 });
  const largerPackage = await packageFor({ maxActiveSlots: 2 });
  const first = await eligibleLawyer('promotion-scope-cap-a@test.uz');
  const second = await eligibleLawyer('promotion-scope-cap-b@test.uz');
  await reservePromotion({ lawyerId: first.user.id, packageId: strictPackage.id, ...SCOPE, idempotencyKey: 'scope-cap-a' });

  const result = await reservePromotion({ lawyerId: second.user.id, packageId: largerPackage.id, ...SCOPE, idempotencyKey: 'scope-cap-b' });

  expect(result.outcome).toBe('queued_after_payment');
});

test('reservation expiry equality is expired for both capacity and paid activation', async () => {
  const promotionPackage = await packageFor({ maxActiveSlots: 1 });
  const first = await eligibleLawyer('promotion-boundary-a@test.uz');
  const second = await eligibleLawyer('promotion-boundary-b@test.uz');
  const boundary = new Date('2026-08-20T10:30:00.000Z');
  const firstReservation = await reservePromotion({
    lawyerId: first.user.id, packageId: promotionPackage.id, ...SCOPE,
    idempotencyKey: 'boundary-a', now: new Date(boundary.getTime() - 30 * 60 * 1000),
  });
  const secondReservation = await reservePromotion({
    lawyerId: second.user.id, packageId: promotionPackage.id, ...SCOPE,
    idempotencyKey: 'boundary-b', now: boundary,
  });
  expect(secondReservation.outcome).toBe('reserved');

  const payment = await Payment.create({
    userId: first.user.id, lawyerPromotionId: firstReservation.promotion.id,
    purpose: 'lawyer_promotion', amount: 70000, amountTiyin: 7000000,
    currency: 'UZS', provider: 'payme', status: 'paid', paidAt: boundary,
  });
  await firstReservation.promotion.update({ paymentId: payment.id });
  await sequelize.transaction((tx) => activatePaidPromotion(firstReservation.promotion.id, tx, boundary));

  expect((await LawyerPromotion.findByPk(firstReservation.promotion.id)).status).toBe('queued');
  expect((await LawyerPromotion.findByPk(secondReservation.promotion.id)).reservationExpiresAt).not.toBeNull();
});

test.each([7, 30])('starts an exact %i-day clock only when paid capacity activates', async (durationDays) => {
  const promotionPackage = await packageFor({ durationDays, priceAmountTiyin: durationDays * 1000000 });
  const { user } = await eligibleLawyer(`promotion-${durationDays}@test.uz`);
  const paidAt = new Date('2026-08-20T10:00:00.000Z');

  const { campaign } = await paidCampaign({ lawyer: user, promotionPackage, key: `duration-${durationDays}`, paidAt });

  expect(campaign.status).toBe('active');
  expect(campaign.startsAt.toISOString()).toBe(paidAt.toISOString());
  expect(campaign.endsAt.getTime() - campaign.startsAt.getTime()).toBe(durationDays * DAY);
  expect(campaign.remainingSeconds).toBe(durationDays * 24 * 60 * 60);
});

test('server-priced checkout activates the promotion subject through the locked payment service', async () => {
  const promotionPackage = await packageFor({ priceAmountTiyin: 1234567 });
  const { user } = await eligibleLawyer('promotion-payment-service@test.uz');
  const { promotion } = await reservePromotion({ lawyerId: user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'payment-reservation' });
  const checkout = await createCheckout({
    userId: user.id,
    purpose: 'lawyer_promotion',
    subjectId: promotion.id,
    idempotencyKey: 'payment-checkout',
  });

  expect(checkout.amountTiyin).toBe(1234567);
  await markPaymentPaid({
    paymentId: checkout.payment.id,
    providerTransactionId: 'promotion-payment-provider',
    amountTiyin: 1234567,
    providerData: { performTime: 1700000000000 },
  });

  const activated = await LawyerPromotion.findByPk(promotion.id);
  expect(activated.status).toBe('active');
  expect(activated.paymentId).toBe(checkout.payment.id);
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:deferred:${checkout.payment.id}` } })).toBe(1);
});

test('payment service rejects a second promotion payment even when the campaign is already active', async () => {
  const promotionPackage = await packageFor();
  const { user } = await eligibleLawyer('promotion-second-payment@test.uz');
  const active = await paidCampaign({ lawyer: user, promotionPackage, key: 'first-payment' });
  await sequelize.query('DROP INDEX IF EXISTS payments_lawyer_promotion_unique');
  const second = await Payment.create({
    userId: user.id, lawyerPromotionId: active.campaign.id, purpose: 'lawyer_promotion',
    amount: 70000, amountTiyin: 7000000, currency: 'UZS', provider: 'payme', status: 'pending',
  });

  await expect(markPaymentPaid({
    paymentId: second.id,
    providerTransactionId: 'promotion-second-provider',
    amountTiyin: 7000000,
  })).rejects.toThrow(/payment|promotion|subject|already/i);
  expect((await Payment.findByPk(second.id)).status).toBe('pending');
  expect(await FinancialTransaction.count({ where: { paymentId: second.id } })).toBe(0);
});

test('paid campaigns queue FIFO and a released slot activates exactly the oldest payment', async () => {
  const promotionPackage = await packageFor();
  const owner = await eligibleLawyer('promotion-owner@test.uz');
  const first = await eligibleLawyer('promotion-fifo-a@test.uz');
  const second = await eligibleLawyer('promotion-fifo-b@test.uz');
  const active = await paidCampaign({ lawyer: owner.user, promotionPackage, key: 'active' });
  const later = await paidCampaign({ lawyer: second.user, promotionPackage, key: 'later', reserved: false, paidAt: new Date('2026-08-20T12:00:00Z') });
  const earlier = await paidCampaign({ lawyer: first.user, promotionPackage, key: 'earlier', reserved: false, paidAt: new Date('2026-08-20T11:00:00Z') });
  expect(later.campaign.status).toBe('queued');
  expect(earlier.campaign.status).toBe('queued');

  await expireAndAdvancePromotions(new Date(active.campaign.endsAt.getTime() + 1));

  expect((await LawyerPromotion.findByPk(active.campaign.id)).status).toBe('expired');
  expect((await LawyerPromotion.findByPk(earlier.campaign.id)).status).toBe('active');
  expect((await LawyerPromotion.findByPk(later.campaign.id)).status).toBe('queued');
});

test('pause preserves unused duration, resumes before seven days, and is idempotent', async () => {
  const promotionPackage = await packageFor();
  const { user, lp } = await eligibleLawyer('promotion-pause@test.uz');
  const activated = new Date('2026-08-20T00:00:00Z');
  const { campaign } = await paidCampaign({ lawyer: user, promotionPackage, key: 'pause', paidAt: activated });
  const pausedAt = new Date(activated.getTime() + DAY);
  await pauseIneligiblePromotion(campaign.id, pausedAt, 'lawyer_ineligible');
  await lp.update({ isAvailable: false });
  const paused = await LawyerPromotion.findByPk(campaign.id);
  expect(paused.status).toBe('paused');
  expect(paused.remainingSeconds).toBe(6 * 24 * 60 * 60);
  expect(paused.resumeDeadline.getTime()).toBe(pausedAt.getTime() + 7 * DAY);

  await lp.update({ isAvailable: true });
  const resumedAt = new Date(pausedAt.getTime() + 2 * DAY);
  await resumeEligiblePromotions(resumedAt);
  await resumeEligiblePromotions(resumedAt);
  const resumed = await LawyerPromotion.findByPk(campaign.id);
  expect(resumed.status).toBe('active');
  expect(resumed.endsAt.getTime()).toBe(resumedAt.getTime() + 6 * DAY);
});

test('owner cancellation waits for provider confirmation before refunding and then advances atomically', async () => {
  const promotionPackage = await packageFor();
  const activeOwner = await eligibleLawyer('promotion-refund-active@test.uz');
  const queuedOwner = await eligibleLawyer('promotion-refund-queued@test.uz');
  await paidCampaign({ lawyer: activeOwner.user, promotionPackage, key: 'refund-active' });
  const queued = await paidCampaign({ lawyer: queuedOwner.user, promotionPackage, key: 'refund-queued', reserved: false });

  await cancelQueuedPromotion({ promotionId: queued.campaign.id, lawyerId: queuedOwner.user.id, reason: 'owner_cancelled' });
  let campaign = await LawyerPromotion.findByPk(queued.campaign.id);
  let payment = await Payment.findByPk(queued.payment.id);
  expect(campaign.status).toBe('refund_pending');
  expect(payment.status).toBe('refund_pending');
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${payment.id}` } })).toBe(0);

  await confirmPromotionRefund(campaign.id, Number(payment.amountTiyin));
  await confirmPromotionRefund(campaign.id, Number(payment.amountTiyin));
  campaign = await LawyerPromotion.findByPk(campaign.id);
  payment = await Payment.findByPk(payment.id);
  expect(campaign.status).toBe('refunded');
  expect(payment.status).toBe('refunded');
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${payment.id}` } })).toBe(1);
});

test('concurrent paid activation and provider refund retries each post exactly once', async () => {
  const promotionPackage = await packageFor();
  const { user } = await eligibleLawyer('promotion-concurrent-lifecycle@test.uz');
  const reserved = await reservePromotion({ lawyerId: user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'concurrent-lifecycle' });
  const payment = await Payment.create({
    userId: user.id, lawyerPromotionId: reserved.promotion.id, purpose: 'lawyer_promotion',
    amount: 70000, amountTiyin: 7000000, currency: 'UZS', provider: 'payme', status: 'paid', paidAt: new Date(),
  });
  await reserved.promotion.update({ paymentId: payment.id });

  await Promise.all(Array.from({ length: 4 }, () => sequelize.transaction((tx) => activatePaidPromotion(reserved.promotion.id, tx))));
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:deferred:${payment.id}` } })).toBe(1);
  await pauseIneligiblePromotion(reserved.promotion.id, new Date(), 'stop');
  await Payment.update({ status: 'refund_pending' }, { where: { id: payment.id } });
  await LawyerPromotion.update({ status: 'refund_pending', refundRequestedAt: new Date() }, { where: { id: reserved.promotion.id } });

  await Promise.all(Array.from({ length: 4 }, () => confirmPromotionRefund(reserved.promotion.id, 7000000)));
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${payment.id}` } })).toBe(1);
});

test('seven-day pause deadline holds the slot until provider-confirmed partial refund', async () => {
  const promotionPackage = await packageFor({ priceAmountTiyin: 7000000 });
  const first = await eligibleLawyer('promotion-deadline-a@test.uz');
  const second = await eligibleLawyer('promotion-deadline-b@test.uz');
  const third = await eligibleLawyer('promotion-deadline-c@test.uz');
  const start = new Date('2026-08-01T00:00:00Z');
  const active = await paidCampaign({ lawyer: first.user, promotionPackage, key: 'deadline-active', paidAt: start });
  await active.payment.update({ providerTransactionId: 'promotion-partial-refund', transactionId: 'promotion-partial-refund' });
  const queued = await paidCampaign({ lawyer: second.user, promotionPackage, key: 'deadline-queued', reserved: false, paidAt: new Date(start.getTime() + 1000) });
  const pausedAt = new Date(start.getTime() + DAY);
  await pauseIneligiblePromotion(active.campaign.id, pausedAt, 'ineligible');

  const result = await resumeEligiblePromotions(new Date(pausedAt.getTime() + 7 * DAY + 1));

  const refundPending = await LawyerPromotion.findByPk(active.campaign.id);
  expect(result.refundPending).toBe(1);
  expect(refundPending.status).toBe('refund_pending');
  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('queued');
  const blockedReservation = await reservePromotion({
    lawyerId: third.user.id, packageId: promotionPackage.id, ...SCOPE,
    idempotencyKey: 'deadline-third', now: new Date(pausedAt.getTime() + 7 * DAY + 2),
  });
  expect(blockedReservation.outcome).toBe('queued_after_payment');
  expect(blockedReservation.promotion.reservationExpiresAt).toBeNull();
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${active.payment.id}` } })).toBe(0);
  await markProviderRefunded({
    paymentId: active.payment.id,
    amountTiyin: 6000000,
    providerTransactionId: 'promotion-partial-refund',
  });
  await markProviderRefunded({
    paymentId: active.payment.id,
    amountTiyin: 6000000,
    providerTransactionId: 'promotion-partial-refund',
  });
  const refundedPayment = await Payment.findByPk(active.payment.id);
  expect(Number(refundedPayment.refundedAmountTiyin)).toBe(6000000);
  expect(refundedPayment.status).toBe('partially_refunded');
  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('active');
  expect((await LawyerPromotion.findByPk(blockedReservation.promotion.id)).status).toBe('pending_payment');
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${active.payment.id}` } })).toBe(1);
});

test('never-activated refund_pending does not occupy capacity', async () => {
  const promotionPackage = await packageFor();
  const activeOwner = await eligibleLawyer('promotion-never-active-owner@test.uz');
  const cancelledOwner = await eligibleLawyer('promotion-never-active-cancelled@test.uz');
  const nextOwner = await eligibleLawyer('promotion-never-active-next@test.uz');
  const active = await paidCampaign({ lawyer: activeOwner.user, promotionPackage, key: 'never-active-owner' });
  const queued = await paidCampaign({ lawyer: cancelledOwner.user, promotionPackage, key: 'never-active-queued', reserved: false });
  await cancelQueuedPromotion({ promotionId: queued.campaign.id, lawyerId: cancelledOwner.user.id, reason: 'owner_cancelled' });
  await expireAndAdvancePromotions(new Date(active.campaign.endsAt.getTime() + 1));

  const reservation = await reservePromotion({
    lawyerId: nextOwner.user.id, packageId: promotionPackage.id, ...SCOPE,
    idempotencyKey: 'never-active-next', now: new Date(active.campaign.endsAt.getTime() + 2),
  });

  expect((await LawyerPromotion.findByPk(queued.campaign.id)).startsAt).toBeNull();
  expect(reservation.outcome).toBe('reserved');
});

test('eligibility scheduler requests a full provider refund for an ineligible paid queue item', async () => {
  const promotionPackage = await packageFor();
  const activeOwner = await eligibleLawyer('promotion-queue-elig-active@test.uz');
  const queuedOwner = await eligibleLawyer('promotion-queue-elig-queued@test.uz');
  await paidCampaign({ lawyer: activeOwner.user, promotionPackage, key: 'queue-elig-active' });
  const queued = await paidCampaign({ lawyer: queuedOwner.user, promotionPackage, key: 'queue-elig-queued', reserved: false });
  await queuedOwner.lp.update({ isAvailable: false });

  await resumeEligiblePromotions(new Date());

  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('refund_pending');
  expect((await Payment.findByPk(queued.payment.id)).status).toBe('refund_pending');
  expect(await FinancialTransaction.count({ where: { operationKey: `promotion:refund:${queued.payment.id}` } })).toBe(0);
});

test('license rejection blocks paid activation and makes active and queued schedulers fail closed', async () => {
  const promotionPackage = await packageFor({ maxActiveSlots: 1 });
  const activationLawyer = await eligibleLawyer('promotion-license-activation@test.uz');
  const activationReservation = await reservePromotion({
    lawyerId: activationLawyer.user.id,
    packageId: promotionPackage.id,
    ...SCOPE,
    idempotencyKey: 'license-activation',
  });
  const activationCheckout = await createCheckout({
    userId: activationLawyer.user.id,
    purpose: 'lawyer_promotion',
    subjectId: activationReservation.promotion.id,
    idempotencyKey: 'license-activation-payment',
  });
  await LawyerDocument.update(
    { verificationStatus: 'rejected' },
    { where: { userId: activationLawyer.user.id, type: 'license' } }
  );
  await expect(markPaymentPaid({
    paymentId: activationCheckout.payment.id,
    providerTransactionId: 'license-activation-provider',
    amountTiyin: Number(promotionPackage.priceAmountTiyin),
  })).rejects.toThrow(/eligible/i);
  expect((await Payment.findByPk(activationCheckout.payment.id)).status).toBe('pending');
  expect((await LawyerPromotion.findByPk(activationReservation.promotion.id)).status).toBe('pending_payment');
  await activationReservation.promotion.update({ status: 'cancelled', reservationExpiresAt: null });
  await activationCheckout.payment.update({ status: 'failed' });

  const activeLawyer = await eligibleLawyer('promotion-license-active@test.uz');
  const queuedLawyer = await eligibleLawyer('promotion-license-queued@test.uz');
  const active = await paidCampaign({ lawyer: activeLawyer.user, promotionPackage, key: 'license-active' });
  const queued = await paidCampaign({ lawyer: queuedLawyer.user, promotionPackage, key: 'license-queued' });
  expect(queued.campaign.status).toBe('queued');
  await LawyerDocument.update(
    { verificationStatus: 'rejected' },
    { where: { userId: { [Sequelize.Op.in]: [activeLawyer.user.id, queuedLawyer.user.id] }, type: 'license' } }
  );

  const result = await resumeEligiblePromotions(new Date());

  expect(result.paused).toBe(1);
  expect(result.queuedRefundPending).toBe(1);
  expect((await LawyerPromotion.findByPk(active.campaign.id)).status).toBe('paused');
  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('refund_pending');
  expect((await Payment.findByPk(queued.payment.id)).status).toBe('refund_pending');
});

test('daily promotion revenue posts one exact idempotent operation per served day and not while paused', async () => {
  const promotionPackage = await packageFor({ priceAmountTiyin: 7000003 });
  const { user } = await eligibleLawyer('promotion-revenue@test.uz');
  const start = new Date('2026-08-01T00:00:00Z');
  const { campaign } = await paidCampaign({ lawyer: user, promotionPackage, key: 'revenue', paidAt: start });

  const first = await recognizePromotionRevenue(new Date(start.getTime() + 2 * DAY));
  const retry = await recognizePromotionRevenue(new Date(start.getTime() + 2 * DAY));
  await pauseIneligiblePromotion(campaign.id, new Date(start.getTime() + 2 * DAY), 'test_pause');
  const paused = await recognizePromotionRevenue(new Date(start.getTime() + 5 * DAY));

  expect(first.posted).toBe(2);
  expect(retry.posted).toBe(0);
  expect(paused.posted).toBe(0);
  expect(await FinancialTransaction.count({ where: { reason: 'promotion_revenue_recognized' } })).toBe(2);
  expect(Number(await FinancialEntry.sum('amountTiyin', { where: { account: ACCOUNTS.PROMOTION_REVENUE } }))).toBe(2000000);
});

test('prod seed never opts lawyers into the pilot and keeps promotion packages idempotent', async () => {
  const lawyer = await eligibleLawyer('promotion-seed-explicit@test.uz');
  await lawyer.lp.update({ promotionPilotEnabled: false });

  await runProdSeed();
  await runProdSeed();

  expect((await lawyer.lp.reload()).promotionPilotEnabled).toBe(false);
  expect(await PromotionPackage.count({ where: { code: ['CATALOG_TOP_7', 'CATALOG_TOP_30'] } })).toBe(2);
});

test('reservation waits for concurrent eligibility suspension and re-evaluates the committed state', async () => {
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-lock-reserve@test.uz');
  const suspension = await sequelize.transaction();
  await lawyer.user.update({ isActive: false }, { transaction: suspension });
  let settled = false;
  const reservation = reservePromotion({
    lawyerId: lawyer.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'locked-reserve',
  }).then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await suspension.commit();

  await expect(reservation).rejects.toThrow(/eligible/i);
  expect(settledBeforeCommit).toBe(false);
  expect(await LawyerPromotion.count({ where: { lawyerId: lawyer.user.id } })).toBe(0);
});

test('reservation waits for a concurrent profile eligibility change', async () => {
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-lock-profile@test.uz');
  const profileChange = await sequelize.transaction();
  await lawyer.lp.update({ isAvailable: false }, { transaction: profileChange });
  let settled = false;
  const reservation = reservePromotion({
    lawyerId: lawyer.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'locked-profile',
  }).then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await profileChange.commit();

  await expect(reservation).rejects.toThrow(/eligible/i);
  expect(settledBeforeCommit).toBe(false);
});

test('activation waits for concurrent document removal and re-evaluates eligibility', async () => {
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-lock-activate@test.uz');
  const reservation = await reservePromotion({
    lawyerId: lawyer.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'locked-activate',
  });
  const payment = await Payment.create({
    userId: lawyer.user.id, lawyerPromotionId: reservation.promotion.id, purpose: 'lawyer_promotion',
    amount: 70000, amountTiyin: 7000000, currency: 'UZS', provider: 'payme', status: 'paid', paidAt: new Date(),
  });
  await reservation.promotion.update({ paymentId: payment.id });
  const removal = await sequelize.transaction();
  await LawyerDocument.destroy({ where: { userId: lawyer.user.id }, transaction: removal });
  let settled = false;
  const activation = sequelize.transaction((tx) => activatePaidPromotion(reservation.promotion.id, tx))
    .then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await removal.commit();

  await expect(activation).rejects.toThrow(/eligible/i);
  expect(settledBeforeCommit).toBe(false);
  expect((await LawyerPromotion.findByPk(reservation.promotion.id)).status).toBe('pending_payment');
});

test('FIFO handoff locks eligibility before activating a queued campaign', async () => {
  const promotionPackage = await packageFor();
  const activeOwner = await eligibleLawyer('promotion-lock-handoff-active@test.uz');
  const queuedOwner = await eligibleLawyer('promotion-lock-handoff-queued@test.uz');
  const active = await paidCampaign({ lawyer: activeOwner.user, promotionPackage, key: 'lock-handoff-active' });
  const queued = await paidCampaign({ lawyer: queuedOwner.user, promotionPackage, key: 'lock-handoff-queued', reserved: false });
  const suspension = await sequelize.transaction();
  await queuedOwner.lp.update({ isAvailable: false }, { transaction: suspension });
  let settled = false;
  const handoff = expireAndAdvancePromotions(new Date(active.campaign.endsAt.getTime() + 1))
    .then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await suspension.commit();
  await handoff;

  expect(settledBeforeCommit).toBe(false);
  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('refund_pending');
});

test('paused resume locks eligibility and cannot race a concurrent suspension', async () => {
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-lock-resume@test.uz');
  const start = new Date('2026-08-01T00:00:00Z');
  const active = await paidCampaign({ lawyer: lawyer.user, promotionPackage, key: 'lock-resume', paidAt: start });
  const pausedAt = new Date(start.getTime() + DAY);
  await pauseIneligiblePromotion(active.campaign.id, pausedAt, 'test_pause');
  const suspension = await sequelize.transaction();
  await lawyer.lp.update({ isAvailable: false }, { transaction: suspension });
  let settled = false;
  const resume = resumeEligiblePromotions(new Date(pausedAt.getTime() + DAY))
    .then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await suspension.commit();
  await resume;

  expect(settledBeforeCommit).toBe(false);
  expect((await LawyerPromotion.findByPk(active.campaign.id)).status).toBe('paused');
});

test('active scheduler locks and re-evaluates eligibility before pausing', async () => {
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-scheduler-active-lock@test.uz');
  const active = await paidCampaign({ lawyer: lawyer.user, promotionPackage, key: 'scheduler-active-lock' });
  const suspension = await sequelize.transaction();
  await lawyer.user.update({ isActive: false }, { transaction: suspension });
  let settled = false;
  const scheduler = resumeEligiblePromotions(new Date())
    .then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await suspension.commit();
  await scheduler;

  expect(settledBeforeCommit).toBe(false);
  expect((await LawyerPromotion.findByPk(active.campaign.id)).status).toBe('paused');
});

test('queued scheduler locks and re-evaluates eligibility before refund_pending', async () => {
  const promotionPackage = await packageFor();
  const activeOwner = await eligibleLawyer('promotion-scheduler-queued-active@test.uz');
  const queuedOwner = await eligibleLawyer('promotion-scheduler-queued-lock@test.uz');
  await paidCampaign({ lawyer: activeOwner.user, promotionPackage, key: 'scheduler-queued-active' });
  const queued = await paidCampaign({ lawyer: queuedOwner.user, promotionPackage, key: 'scheduler-queued-lock', reserved: false });
  const suspension = await sequelize.transaction();
  await queuedOwner.lp.update({ isAvailable: false }, { transaction: suspension });
  let settled = false;
  const scheduler = resumeEligiblePromotions(new Date())
    .then((value) => { settled = true; return value; }, (error) => { settled = true; throw error; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeCommit = settled;
  await suspension.commit();
  await scheduler;

  expect(settledBeforeCommit).toBe(false);
  expect((await LawyerPromotion.findByPk(queued.campaign.id)).status).toBe('refund_pending');
  expect((await Payment.findByPk(queued.payment.id)).status).toBe('refund_pending');
});

test('opposite FIFO scopes complete without cross-scope eligibility deadlock', async () => {
  const promotionPackage = await packageFor();
  const civil = { specialization: 'Гражданское право', location: null };
  const family = { specialization: 'Семейное право', location: null };
  const both = { specialization: civil.specialization, specializations: [civil.specialization, family.specialization] };
  const activeCivilOwner = await eligibleLawyer('promotion-deadlock-active-civil@test.uz', both);
  const activeFamilyOwner = await eligibleLawyer('promotion-deadlock-active-family@test.uz', both);
  const lawyerA = await eligibleLawyer('promotion-deadlock-a@test.uz', both);
  const lawyerB = await eligibleLawyer('promotion-deadlock-b@test.uz', both);
  const activeCivil = await paidCampaign({ lawyer: activeCivilOwner.user, promotionPackage, key: 'deadlock-active-civil', scope: civil });
  const activeFamily = await paidCampaign({ lawyer: activeFamilyOwner.user, promotionPackage, key: 'deadlock-active-family', scope: family });
  const aCivil = await paidCampaign({ lawyer: lawyerA.user, promotionPackage, key: 'deadlock-a-civil', reserved: false, paidAt: new Date('2026-08-01T00:00:00Z'), scope: civil });
  const bCivil = await paidCampaign({ lawyer: lawyerB.user, promotionPackage, key: 'deadlock-b-civil', reserved: false, paidAt: new Date('2026-08-01T00:00:01Z'), scope: civil });
  const bFamily = await paidCampaign({ lawyer: lawyerB.user, promotionPackage, key: 'deadlock-b-family', reserved: false, paidAt: new Date('2026-08-01T00:00:00Z'), scope: family });
  const aFamily = await paidCampaign({ lawyer: lawyerA.user, promotionPackage, key: 'deadlock-a-family', reserved: false, paidAt: new Date('2026-08-01T00:00:01Z'), scope: family });
  await lawyerA.lp.update({ specialization: family.specialization, specializations: [family.specialization] });
  await lawyerB.lp.update({ specialization: civil.specialization, specializations: [civil.specialization] });
  await activeCivil.campaign.update({ status: 'expired', remainingSeconds: 0 });
  await activeFamily.campaign.update({ status: 'expired', remainingSeconds: 0 });

  const blocker = await sequelize.transaction();
  await LawyerPromotion.findAll({
    where: { id: { [Sequelize.Op.in]: [aCivil.campaign.id, bFamily.campaign.id] } },
    lock: blocker.LOCK.UPDATE,
    transaction: blocker,
  });
  const releases = Promise.all([
    sequelize.transaction((tx) => releasePromotionSlot({ placement: 'catalog_top', ...civil }, tx)),
    sequelize.transaction((tx) => releasePromotionSlot({ placement: 'catalog_top', ...family }, tx)),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await blocker.commit();
  const outcome = await Promise.race([
    releases.then(() => 'completed'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
  ]);

  expect(outcome).toBe('completed');
  expect((await LawyerPromotion.findByPk(aCivil.campaign.id)).status).toBe('refund_pending');
  expect((await LawyerPromotion.findByPk(bFamily.campaign.id)).status).toBe('refund_pending');
  expect((await LawyerPromotion.findByPk(bCivil.campaign.id)).status).toBe('active');
  expect((await LawyerPromotion.findByPk(aFamily.campaign.id)).status).toBe('active');
});

test('migration reruns and enforces the final exact promotion payment subject', async () => {
  const queryInterface = sequelize.getQueryInterface();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query('ALTER TABLE payments DROP CONSTRAINT payments_exact_subject');
  await sequelize.query(`
    ALTER TABLE payments ADD CONSTRAINT payments_exact_subject CHECK (
      purpose = 'consultation' OR purpose = 'consultation_extension' OR purpose = 'subscription'
    )
  `);
  await migration.up(queryInterface, Sequelize);
  const [constraints] = await sequelize.query(`
    SELECT conname FROM pg_constraint
    WHERE conname IN (
      'lawyer_promotions_lawyer_fk', 'lawyer_promotions_package_fk',
      'lawyer_promotions_payment_fk', 'payments_lawyer_promotion_fk', 'payments_exact_subject'
    )
  `);
  expect(new Set(constraints.map((row) => row.conname))).toEqual(new Set([
    'lawyer_promotions_lawyer_fk', 'lawyer_promotions_package_fk',
    'lawyer_promotions_payment_fk', 'payments_lawyer_promotion_fk', 'payments_exact_subject',
  ]));
  const [exactDefinition] = await sequelize.query(`
    SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname = 'payments_exact_subject'
  `);
  expect(exactDefinition[0].definition).toMatch(/lawyer_promotion.*lawyer_promotion_id/is);
  const promotionPackage = await packageFor();
  const { user } = await eligibleLawyer('promotion-migration@test.uz');
  const { promotion } = await reservePromotion({ lawyerId: user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'migration' });

  await expect(Payment.create({
    userId: user.id,
    purpose: 'lawyer_promotion',
    amount: 1,
    amountTiyin: 100,
    currency: 'UZS',
    provider: 'payme',
    status: 'pending',
  })).rejects.toThrow(/promotion|subject|lawyerPromotionId/i);
  const payment = await Payment.create({
    userId: user.id,
    lawyerPromotionId: promotion.id,
    purpose: 'lawyer_promotion',
    amount: 1,
    amountTiyin: 100,
    currency: 'UZS',
    provider: 'payme',
    status: 'pending',
  });
  expect(payment.lawyerPromotionId).toBe(promotion.id);
});

test('migration enforces one payment per promotion under concurrent inserts', async () => {
  await migration.up(sequelize.getQueryInterface(), Sequelize);
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-payment-unique@test.uz');
  const { promotion } = await reservePromotion({
    lawyerId: lawyer.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'payment-unique',
  });
  const input = (key) => Payment.create({
    userId: lawyer.user.id, lawyerPromotionId: promotion.id, purpose: 'lawyer_promotion',
    amount: 70000, amountTiyin: 7000000, currency: 'UZS', provider: 'payme', status: 'pending',
    idempotencyKey: key,
  });

  const results = await Promise.allSettled([input('promotion-unique-a'), input('promotion-unique-b')]);

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(await Payment.count({ where: { lawyerPromotionId: promotion.id } })).toBe(1);
});

test('migration rejects duplicate sponsored positions through direct database writes', async () => {
  await migration.up(sequelize.getQueryInterface(), Sequelize);
  const promotionPackage = await packageFor();
  const lawyer = await eligibleLawyer('promotion-position-constraint@test.uz');
  const { promotion } = await reservePromotion({
    lawyerId: lawyer.user.id, packageId: promotionPackage.id, ...SCOPE, idempotencyKey: 'position-constraint',
  });

  await expect(sequelize.query(
    'UPDATE promotion_packages SET sponsored_positions = ARRAY[0,0]::integer[] WHERE id = :id',
    { replacements: { id: promotionPackage.id } }
  )).rejects.toThrow();
  await expect(sequelize.query(
    'UPDATE lawyer_promotions SET sponsored_positions = ARRAY[3,3]::integer[] WHERE id = :id',
    { replacements: { id: promotion.id } }
  )).rejects.toThrow();
});
