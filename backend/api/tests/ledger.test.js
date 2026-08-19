const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeAdmin, makeClient, makeLawyer, tokenFor } = require('./helpers');
const {
  ACCOUNTS,
  postTransaction,
  recordConsultationEscrow,
  recordExtensionEscrow,
  refundExtensionEscrow,
  recordPromotionDeferredRevenue,
  releaseConsultationEscrow,
  confirmConsultationRefund,
  activateSubscriptionPayment,
  snapshotConsultationFinancials,
  recognizeDeferredRevenue,
} = require('../src/services/ledgerService');
const { getCommissionRateBps, setCommissionRateBps } = require('../src/services/platformSettingsService');
const { bootstrapLegacyLedger } = require('../src/scripts/bootstrapLegacyLedger');
const { completeConsultation } = require('../src/services/escrow');
const { markPaymentPaid } = require('../src/services/paymentService');
const { recognizePromotionRevenue } = require('../src/services/promotionJobs');

const {
  sequelize,
  Consultation,
  FinancialEntry,
  FinancialTransaction,
  LawyerProfile,
  Payment,
  PlatformSetting,
  PlatformSettingAudit,
  PromotionPackage,
  LawyerPromotion,
  Subscription,
} = models;

beforeEach(async () => {
  await resetDb();
}, 60000);

function balanced(operationKey, paymentId = null) {
  return postTransaction({
    operationKey,
    paymentId,
    reason: 'test',
    currency: 'UZS',
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 100 },
      { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 100 },
    ],
  });
}

async function promotionSubject(lawyerId, overrides = {}) {
  const promotionPackage = await PromotionPackage.create({
    code: `LEDGER_PROMOTION_${Math.random()}`,
    name: { ru: 'TOP', uz: 'TOP', en: 'TOP' },
    placement: 'catalog_top', durationDays: 7, priceAmountTiyin: 10000,
    currency: 'UZS', maxActiveSlots: 1, sponsoredPositions: [0], isActive: true,
  });
  return LawyerPromotion.create({
    lawyerId, packageId: promotionPackage.id, idempotencyKey: `ledger-${Math.random()}`,
    placement: 'catalog_top', specialization: 'Гражданское право', location: null,
    durationDays: 7, priceAmountTiyin: 10000, currency: 'UZS', maxActiveSlots: 1,
    sponsoredPositions: [0], status: 'pending_payment', ...overrides,
  });
}

describe('double-entry posting invariants', () => {
  test('rejects an unbalanced transaction before posting rows', async () => {
    await expect(postTransaction({
      operationKey: 'ledger:unbalanced',
      reason: 'test',
      currency: 'UZS',
      entries: [
        { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 100 },
        { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 90 },
      ],
    })).rejects.toThrow(/balanced/i);

    expect(await FinancialTransaction.count()).toBe(0);
  });

  test('returns the original transaction for sequential and parallel retries', async () => {
    const first = await balanced('ledger:idempotent');
    const second = await balanced('ledger:idempotent');
    const parallel = await Promise.all(Array.from({ length: 5 }, () => balanced('ledger:parallel')));

    expect(second.id).toBe(first.id);
    expect(new Set(parallel.map((transaction) => transaction.id)).size).toBe(1);
    expect(await FinancialTransaction.count()).toBe(2);
    expect(await FinancialEntry.count()).toBe(4);
  });

  test('rejects an operation-key collision when any normalized payload field differs', async () => {
    const input = {
      operationKey: 'ledger:collision',
      paymentId: null,
      reason: 'original',
      currency: 'UZS',
      entries: [
        { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 100 },
        { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 100 },
      ],
    };
    const first = await postTransaction(input);
    const reordered = await postTransaction({ ...input, entries: [...input.entries].reverse() });
    expect(reordered.id).toBe(first.id);

    await expect(postTransaction({ ...input, reason: 'different' })).rejects.toThrow(/collision/i);
    await expect(postTransaction({ ...input, currency: 'USD' })).rejects.toThrow(/collision/i);
    await expect(postTransaction({ ...input, paymentId: '11111111-1111-4111-8111-111111111111' })).rejects.toThrow(/collision/i);
    await expect(postTransaction({
      ...input,
      entries: [
        { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: 101 },
        { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: 101 },
      ],
    })).rejects.toThrow(/collision/i);
  });

  test('posted transactions and entries cannot be updated or deleted', async () => {
    const transaction = await balanced('ledger:immutable');
    const entry = await FinancialEntry.findOne({ where: { financialTransactionId: transaction.id } });

    await expect(transaction.update({ reason: 'changed' })).rejects.toThrow(/immutable/i);
    await expect(entry.update({ amountTiyin: 1 })).rejects.toThrow(/immutable/i);
    await expect(transaction.destroy()).rejects.toThrow(/immutable/i);
    await expect(entry.destroy()).rejects.toThrow(/immutable/i);
  });
});

describe('commission settings and consultation accounting', () => {
  test('defaults to 1500 bps and audits an authenticated admin change', async () => {
    expect(await getCommissionRateBps()).toBe(1500);
    const admin = await makeAdmin('ledger-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });

    const response = await request(app)
      .patch('/api/admin/settings/commission-rate')
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .send({ commissionRateBps: 1750 });

    expect(response.status).toBe(200);
    expect(response.body.commissionRateBps).toBe(1750);
    const audit = await PlatformSettingAudit.findOne({ order: [['createdAt', 'DESC']] });
    expect(audit.oldValue).toBe('1500');
    expect(audit.newValue).toBe('1750');
    expect(audit.changedByUserId).toBe(admin.id);
  });

  test('snapshots checkout commission and releases only the lawyer net amount', async () => {
    const admin = await makeAdmin('ledger-rate-admin@test.uz');
    await setCommissionRateBps(1750, admin.id);
    const client = await makeClient('ledger-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Ledger test',
      status: 'in_progress',
      price: 1000,
    });
    const payment = await Payment.create({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      amount: 1000,
      amountTiyin: 100000,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
    });

    await sequelize.transaction(async (tx) => {
      await snapshotConsultationFinancials(consultation, 100000, tx);
      await recordConsultationEscrow(payment, tx);
    });
    await consultation.reload();
    await lp.reload();
    expect(consultation.commissionRateBps).toBe(1750);
    expect(Number(consultation.grossAmountTiyin)).toBe(100000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(82500);
    expect(Number(lp.pendingBalance)).toBe(825);

    await sequelize.transaction(async (tx) => releaseConsultationEscrow(consultation, tx));
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(Number(lp.balance)).toBe(825);

    const release = await FinancialTransaction.findOne({
      where: { operationKey: `consultation:release:${consultation.id}` },
      include: [{ model: FinancialEntry, as: 'entries' }],
    });
    expect(release.entries.map((entry) => [entry.account, entry.direction, Number(entry.amountTiyin)]))
      .toEqual(expect.arrayContaining([
        [ACCOUNTS.CONSULTATION_ESCROW, 'debit', 100000],
        [ACCOUNTS.PLATFORM_COMMISSION_REVENUE, 'credit', 17500],
        [ACCOUNTS.LAWYER_PAYABLE, 'credit', 82500],
      ]));
  });

  test('checkout holds a row lock on the commission setting until its transaction commits', async () => {
    const admin = await makeAdmin('ledger-lock-admin@test.uz');
    const client = await makeClient('ledger-lock-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-lock-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Lock', status: 'payment_pending', price: 1000,
    });
    await getCommissionRateBps();
    const checkoutTx = await sequelize.transaction();
    await snapshotConsultationFinancials(consultation, 100000, checkoutTx);

    let settingChangeSettled = false;
    const settingChange = setCommissionRateBps(1750, admin.id).then(() => { settingChangeSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 75));
    const settledWhileCheckoutOpen = settingChangeSettled;
    await checkoutTx.commit();
    await settingChange;

    expect(settledWhileCheckoutOpen).toBe(false);
    await consultation.reload();
    expect(consultation.commissionRateBps).toBe(1500);
    expect(Number((await PlatformSetting.findByPk('commission_rate_bps')).value)).toBe(1750);
  });

  test('completion refuses missing or inconsistent snapshots and posts nothing', async () => {
    const client = await makeClient('ledger-strict-complete-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-strict-complete-lawyer@test.uz', { pendingBalance: 100 });
    const missing = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Missing', status: 'in_progress', price: 100,
    });
    await Payment.create({
      userId: client.id, consultationId: missing.id, purpose: 'consultation', amount: 100,
      amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await expect(completeConsultation(missing.id)).rejects.toThrow(/operator repair|snapshot/i);
    await missing.reload();
    await lp.reload();
    expect(missing.status).toBe('in_progress');
    expect(Number(lp.balance)).toBe(0);
    expect(Number(lp.pendingBalance)).toBe(100);
    expect(await FinancialTransaction.count()).toBe(0);

    const inconsistent = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Inconsistent', status: 'in_progress', price: 100,
      commissionRateBps: 1500, grossAmountTiyin: 10000, lawyerNetAmountTiyin: 9000,
    });
    await Payment.create({
      userId: client.id, consultationId: inconsistent.id, purpose: 'consultation', amount: 100,
      amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await expect(completeConsultation(inconsistent.id)).rejects.toThrow(/operator repair|snapshot/i);
    expect(await FinancialTransaction.count()).toBe(0);
  });

  test('completion refuses an untyped payment hidden outside the snapshotted aggregate', async () => {
    const client = await makeClient('ledger-untyped-complete-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-untyped-complete-lawyer@test.uz', { pendingBalance: 85 });
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Untyped', status: 'in_progress', price: 100,
      commissionRateBps: 1500, grossAmountTiyin: 10000, lawyerNetAmountTiyin: 8500,
    });
    await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 100,
      amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: null, amount: 50,
      amountTiyin: 5000, currency: 'UZS', provider: 'payme', status: 'paid',
    });

    await expect(completeConsultation(consultation.id)).rejects.toThrow(/operator repair|purpose|subject/i);

    await consultation.reload();
    await lp.reload();
    expect(consultation.status).toBe('in_progress');
    expect(Number(lp.balance)).toBe(0);
    expect(await FinancialTransaction.count()).toBe(0);
  });

  test('confirmed refund refuses missing snapshots and leaves money untouched', async () => {
    const client = await makeClient('ledger-strict-refund-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-strict-refund-lawyer@test.uz', { pendingBalance: 100 });
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Refund', status: 'cancelled', price: 100,
    });
    const payment = await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 100,
      amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid',
    });

    await expect(sequelize.transaction((tx) => confirmConsultationRefund(payment, tx)))
      .rejects.toThrow(/operator repair|snapshot/i);

    await payment.reload();
    await lp.reload();
    expect(payment.status).toBe('paid');
    expect(Number(lp.pendingBalance)).toBe(100);
    expect(await FinancialTransaction.count()).toBe(0);
  });
});

describe('typed posting helper guards', () => {
  test('consultation escrow requires paid status and exact consultation purpose/subject', async () => {
    const client = await makeClient('ledger-guard-cons-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-guard-cons-lawyer@test.uz');
    const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Guard', price: 100 });
    const pending = await Payment.create({ userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'pending' });
    const untyped = await Payment.create({ userId: client.id, consultationId: consultation.id, purpose: null, amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid' });

    await expect(sequelize.transaction((tx) => recordConsultationEscrow(pending, tx))).rejects.toThrow(/paid/i);
    await expect(sequelize.transaction((tx) => recordConsultationEscrow(untyped, tx))).rejects.toThrow(/purpose|subject/i);
  });

  test('extension escrow requires paid status and exact extension purpose/subject', async () => {
    const client = await makeClient('ledger-guard-ext-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-guard-ext-lawyer@test.uz');
    const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Guard', price: 100, commissionRateBps: 1500, grossAmountTiyin: 10000, lawyerNetAmountTiyin: 8500 });
    const pending = await Payment.create({ userId: client.id, consultationId: consultation.id, purpose: 'consultation_extension', amount: 10, amountTiyin: 1000, currency: 'UZS', provider: 'payme', status: 'pending' });
    const wrong = await Payment.create({ userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 10, amountTiyin: 1000, currency: 'UZS', provider: 'payme', status: 'paid' });

    await expect(sequelize.transaction((tx) => recordExtensionEscrow(pending, tx))).rejects.toThrow(/paid/i);
    await expect(sequelize.transaction((tx) => recordExtensionEscrow(wrong, tx))).rejects.toThrow(/purpose|extension/i);
  });

  test('subscription activation requires paid status and exact subscription purpose/subject', async () => {
    const client = await makeClient('ledger-guard-sub@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const pending = await Payment.create({ userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'pending', providerData: { subscriptionPlan: 'basic' } });
    const untyped = await Payment.create({ userId: client.id, subscriptionId: subscription.id, purpose: null, amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid', providerData: { subscriptionPlan: 'basic' } });

    await expect(sequelize.transaction((tx) => activateSubscriptionPayment(pending, tx))).rejects.toThrow(/paid/i);
    await expect(sequelize.transaction((tx) => activateSubscriptionPayment(untyped, tx))).rejects.toThrow(/purpose|subject/i);
  });

  test('promotion deferral requires paid status and the exact promotion subject', async () => {
    const client = await makeClient('ledger-guard-promo-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-guard-promo-lawyer@test.uz');
    const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Guard', price: 100 });
    const promotion = await promotionSubject(lawyer.id);
    const pending = await Payment.create({ userId: lawyer.id, lawyerPromotionId: promotion.id, purpose: 'lawyer_promotion', amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'pending' });

    await expect(sequelize.transaction((tx) => recordPromotionDeferredRevenue(pending, tx))).rejects.toThrow(/paid/i);
    await expect(Payment.create({ userId: lawyer.id, lawyerPromotionId: promotion.id, consultationId: consultation.id, purpose: 'lawyer_promotion', amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid' })).rejects.toThrow(/subject|lawyerPromotionId/i);
  });
});

describe('subscription deferral', () => {
  test('activates a paid term once and recognizes cumulative revenue idempotently', async () => {
    const client = await makeClient('ledger-sub@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const payment = await Payment.create({
      userId: client.id,
      subscriptionId: subscription.id,
      purpose: 'subscription',
      amount: 300,
      amountTiyin: 30000,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
      providerData: { subscriptionPlan: 'basic' },
    });

    await sequelize.transaction(async (tx) => activateSubscriptionPayment(payment, tx));
    await payment.reload();
    const through = new Date(new Date(payment.providerData.termStart).getTime() + (15 * 24 * 60 * 60 * 1000));
    const first = await recognizeDeferredRevenue({ through });
    const second = await recognizeDeferredRevenue({ through });

    await subscription.reload();
    expect(subscription.plan).toBe('basic');
    expect(first.recognizedTiyin).toBeGreaterThan(0);
    expect(second.recognizedTiyin).toBe(0);
    expect(await FinancialTransaction.count({ where: { paymentId: payment.id } })).toBe(2);
  });

  test('serializes overlapping recognition through dates without double recognizing', async () => {
    const client = await makeClient('ledger-race-sub@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const payment = await Payment.create({
      userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', amount: 300,
      amountTiyin: 30000, currency: 'UZS', provider: 'payme', status: 'paid',
      providerData: { subscriptionPlan: 'basic' },
    });
    await sequelize.transaction((tx) => activateSubscriptionPayment(payment, tx));
    await payment.reload();
    const start = new Date(payment.providerData.termStart).getTime();
    const end = new Date(payment.providerData.termEnd).getTime();
    const throughEarly = new Date(start + Math.floor((end - start) / 3));
    const throughLate = new Date(start + Math.floor((2 * (end - start)) / 3));

    const results = await Promise.all([
      recognizeDeferredRevenue({ through: throughLate }),
      recognizeDeferredRevenue({ through: throughEarly }),
      recognizeDeferredRevenue({ through: throughLate }),
    ]);

    const recognized = await FinancialEntry.sum('amountTiyin', { where: { account: ACCOUNTS.SUBSCRIPTION_REVENUE } });
    expect(Number(recognized)).toBe(20000);
    expect(results.reduce((sum, result) => sum + result.recognizedTiyin, 0)).toBe(20000);
  });

  test('recognizes promotion deferred revenue through the campaign service-day entry point', async () => {
    const { user: lawyer } = await makeLawyer('ledger-promotion@test.uz');
    const start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const promotion = await promotionSubject(lawyer.id, {
      status: 'active', startsAt: start, activeSince: start, endsAt: end,
      remainingSeconds: 7 * 24 * 60 * 60,
      priceAmountTiyin: 21000,
    });
    const payment = await Payment.create({
      userId: lawyer.id,
      lawyerPromotionId: promotion.id,
      purpose: 'lawyer_promotion',
      amount: 210,
      amountTiyin: 21000,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
      paidAt: start,
    });
    await promotion.update({ paymentId: payment.id });
    await sequelize.transaction((tx) => recordPromotionDeferredRevenue(payment, tx));

    const result = await recognizePromotionRevenue(new Date());

    expect(result.recognizedTiyin).toBe(6000);
    const revenue = await FinancialEntry.sum('amountTiyin', { where: { account: ACCOUNTS.PROMOTION_REVENUE } });
    expect(Number(revenue)).toBe(6000);
    const recognition = await FinancialTransaction.findOne({ where: { paymentId: payment.id, reason: 'promotion_revenue_recognized' } });
    expect(recognition).toBeTruthy();
  });
});

describe('business path integration', () => {
  test('checkout snapshots commission before payment and simulated capture posts escrow', async () => {
    const client = await makeClient('ledger-checkout-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-checkout-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Checkout', status: 'payment_pending', price: 1000,
    });
    const authorization = `Bearer ${tokenFor(client)}`;

    const checkout = await request(app)
      .post('/api/payments/create')
      .set('Authorization', authorization)
      .set('Idempotency-Key', 'ledger-checkout-snapshot')
      .send({ consultationId: consultation.id });
    expect(checkout.status).toBe(200);
    await consultation.reload();
    expect(consultation.commissionRateBps).toBe(1500);
    expect(Number(consultation.grossAmountTiyin)).toBe(100000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(85000);

    const captured = await request(app)
      .post('/api/payments/simulate')
      .set('Authorization', authorization)
      .send({ consultationId: consultation.id });
    expect(captured.status).toBe(200);
    const payment = await Payment.findByPk(checkout.body.paymentId);
    expect(payment.purpose).toBe('consultation');
    expect(Number(payment.amountTiyin)).toBe(100000);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:escrow:${payment.id}` } })).toBe(1);
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(850);
  });

  test('completion uses the snapshotted ledger split instead of paying gross', async () => {
    const client = await makeClient('ledger-complete-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-complete-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Complete', status: 'in_progress', price: 1000,
    });
    const payment = await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 1000,
      amountTiyin: 100000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await sequelize.transaction(async (tx) => {
      await snapshotConsultationFinancials(consultation, 100000, tx);
      await recordConsultationEscrow(payment, tx);
    });

    await completeConsultation(consultation.id);

    await lp.reload();
    expect(Number(lp.balance)).toBe(850);
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:release:${consultation.id}` } })).toBe(1);
  });

  test('cancellation requests a provider refund and keeps posted escrow immutable until confirmation', async () => {
    const client = await makeClient('ledger-cancel-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-cancel-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Cancel', status: 'accepted', price: 1000,
    });
    const payment = await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 1000,
      amountTiyin: 100000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await sequelize.transaction(async (tx) => {
      await snapshotConsultationFinancials(consultation, 100000, tx);
      await recordConsultationEscrow(payment, tx);
    });

    const response = await request(app)
      .post(`/api/consultations/${consultation.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ reason: 'changed plans' });

    expect(response.status).toBe(202);
    await payment.reload();
    await lp.reload();
    expect(payment.status).toBe('refund_pending');
    expect(Number(lp.pendingBalance)).toBe(850);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:refund:${payment.id}` } })).toBe(0);
  });

  test('lawyer rejection without provider transaction remains refund_pending with no reversal', async () => {
    const client = await makeClient('ledger-reject-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-reject-lawyer@test.uz');
    await lawyer.update({ twoFactorEnabled: true });
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Reject', status: 'pending', price: 1000,
      commissionRateBps: 1500, grossAmountTiyin: 100000, lawyerNetAmountTiyin: 85000,
    });
    const payment = await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 1000,
      amountTiyin: 100000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await lp.update({ pendingBalance: 850 });

    const response = await request(app)
      .post(`/api/lawyer/consultation-requests/${consultation.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer')
      .send({ reason: 'busy' });

    expect(response.status).toBe(200);
    await payment.reload();
    await lp.reload();
    expect(payment.status).toBe('refund_pending');
    expect(Number(lp.pendingBalance)).toBe(850);
    expect(await FinancialTransaction.count()).toBe(0);
  });

  test('subscription upgrade creates a typed payment and deferred-revenue posting', async () => {
    const client = await makeClient('ledger-upgrade-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-upgrade-lawyer@test.uz');

    const response = await request(app)
      .post('/api/subscriptions/upgrade')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ plan: 'basic' });

    expect(response.status).toBe(200);
    const payment = await Payment.findOne({ where: { userId: client.id, purpose: 'subscription' } });
    expect(payment).toBeTruthy();
    expect(payment.subscriptionId).toBeTruthy();
    expect(Number(payment.amountTiyin)).toBe(9900000);
    expect(await FinancialTransaction.count({ where: { operationKey: `payme:paid:test:${payment.id}` } })).toBe(1);

    const booking = await request(app)
      .post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'Included consultation', consultationType: 'video', useSubscriptionFree: true });
    expect(booking.status).toBe(201);
    await payment.reload();
    expect(payment.providerData.consumedConsultationIds).toContain(booking.body.consultation.id);

    await request(app)
      .post(`/api/consultations/${booking.body.consultation.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({});
    await payment.reload();
    expect(payment.providerData.consumedConsultationIds).not.toContain(booking.body.consultation.id);
  });

  test('video extension creates typed escrow and uses the consultation commission snapshot', async () => {
    const client = await makeClient('ledger-extension-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-extension-lawyer@test.uz', { price: 100000 });
    await lawyer.update({ twoFactorEnabled: true });
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Extend',
      status: 'in_progress',
      price: 100000,
      commissionRateBps: 1500,
      grossAmountTiyin: 10000000,
      lawyerNetAmountTiyin: 8500000,
    });
    await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 100000,
      amountTiyin: 10000000, currency: 'UZS', provider: 'payme', status: 'paid',
    });

    const key = 'ledger-extension-checkout';
    const proposal = await request(app)
      .post(`/api/video/consultation/${consultation.id}/extend`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .set('X-Maslaxat-Mode', 'client')
      .set('Idempotency-Key', key)
      .send({ minutes: 15 });
    expect(proposal.status).toBe(202);
    const response = await request(app)
      .post(`/api/video/consultation/${consultation.id}/extend`)
      .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer')
      .set('Idempotency-Key', key)
      .send({ minutes: 15 });

    expect(response.status).toBe(200);
    const payment = await Payment.findOne({ where: { consultationId: consultation.id, purpose: 'consultation_extension' } });
    expect(payment).toBeTruthy();
    expect(payment.status).toBe('pending');
    expect(Number(payment.amountTiyin)).toBe(2500000);
    expect(await FinancialTransaction.count({ where: { paymentId: payment.id } })).toBe(0);
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'ledger-extension-provider',
      amountTiyin: 2500000,
      providerData: { performTime: 1700000000000 },
    });
    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:ledger-extension-provider' } })).toBe(1);
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(21250);
  });

  test('confirmed extension refund reverses its own escrow posting idempotently', async () => {
    const client = await makeClient('ledger-extension-refund-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('ledger-extension-refund-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Refund extension', status: 'in_progress', price: 1000,
      commissionRateBps: 1500, grossAmountTiyin: 100000, lawyerNetAmountTiyin: 85000,
    });
    const payment = await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation_extension', amount: 100,
      amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await Payment.create({
      userId: client.id, consultationId: consultation.id, purpose: 'consultation', amount: 1000,
      amountTiyin: 100000, currency: 'UZS', provider: 'payme', status: 'paid',
    });
    await sequelize.transaction((tx) => recordExtensionEscrow(payment, tx));

    await sequelize.transaction((tx) => refundExtensionEscrow(payment, tx));
    await sequelize.transaction((tx) => refundExtensionEscrow(payment, tx));

    await lp.reload();
    await consultation.reload();
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(Number(consultation.grossAmountTiyin)).toBe(100000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(85000);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:extension:refund:${payment.id}` } })).toBe(1);
  });
});

describe('legacy ledger bootstrap', () => {
  test('is empty-safe, posts pending/completed/subscription openings, and is restart-safe', async () => {
    expect((await bootstrapLegacyLedger()).posted).toBe(0);

    const client = await makeClient('ledger-bootstrap-client@test.uz');
    const { user: lawyer } = await makeLawyer('ledger-bootstrap-lawyer@test.uz');
    const pending = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'Pending', status: 'accepted', price: 100,
    });
    const completed = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Completed',
      status: 'completed',
      price: 200,
      commissionRateBps: 1500,
      grossAmountTiyin: 25000,
      lawyerNetAmountTiyin: 21250,
    });
    const subscription = await Subscription.create({
      userId: client.id,
      plan: 'basic',
      price: 300,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    const payments = await Promise.all([
      Payment.create({ userId: client.id, consultationId: pending.id, purpose: 'consultation', amount: 100, amountTiyin: 10000, currency: 'UZS', provider: 'payme', status: 'paid' }),
      Payment.create({ userId: client.id, consultationId: completed.id, purpose: 'consultation', amount: 200, amountTiyin: 20000, currency: 'UZS', provider: 'payme', status: 'paid', escrowReleased: true }),
      Payment.create({ userId: client.id, consultationId: completed.id, purpose: 'consultation_extension', amount: 50, amountTiyin: 5000, currency: 'UZS', provider: 'payme', status: 'paid', escrowReleased: true }),
      Payment.create({ userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', amount: 300, amountTiyin: 30000, currency: 'UZS', provider: 'payme', status: 'paid', paidAt: new Date(), providerData: { termStart: new Date().toISOString(), termEnd: subscription.expiresAt.toISOString() } }),
    ]);

    expect((await bootstrapLegacyLedger()).posted).toBe(4);
    expect((await bootstrapLegacyLedger()).posted).toBe(0);
    for (const payment of payments) {
      expect(await FinancialTransaction.count({ where: { operationKey: `legacy:opening:${payment.id}` } })).toBe(1);
    }
  });

  test('aborts all postings and reports ambiguous paid rows', async () => {
    const client = await makeClient('ledger-bootstrap-ambiguous@test.uz');
    const payment = await Payment.create({
      userId: client.id,
      purpose: null,
      amount: 100,
      amountTiyin: 10000,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
    });

    await expect(bootstrapLegacyLedger()).rejects.toMatchObject({
      report: expect.arrayContaining([expect.objectContaining({ paymentId: payment.id })]),
    });
    expect(await FinancialTransaction.count()).toBe(0);
  });

  test('aborts all subscription openings when any paid period metadata is missing', async () => {
    const client = await makeClient('ledger-bootstrap-period@test.uz');
    const subscription = await Subscription.create({
      userId: client.id, plan: 'basic', price: 300, expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    });
    const start = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await Payment.create({
      userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', amount: 300,
      amountTiyin: 30000, currency: 'UZS', provider: 'payme', status: 'paid',
      providerData: { termStart: start.toISOString(), termEnd: end.toISOString() },
    });
    const ambiguous = await Payment.create({
      userId: client.id, subscriptionId: subscription.id, purpose: 'subscription', amount: 300,
      amountTiyin: 30000, currency: 'UZS', provider: 'payme', status: 'paid', paidAt: new Date(), providerData: {},
    });

    await expect(bootstrapLegacyLedger()).rejects.toMatchObject({
      report: expect.arrayContaining([expect.objectContaining({ paymentId: ambiguous.id })]),
    });
    expect(await FinancialTransaction.count()).toBe(0);
  });
});
