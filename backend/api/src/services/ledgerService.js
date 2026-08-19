const { Op, QueryTypes } = require('sequelize');
const { randomUUID } = require('crypto');
const {
  sequelize,
  Consultation,
  FinancialEntry,
  FinancialTransaction,
  LawyerProfile,
  Payment,
  Subscription,
} = require('../models');
const { getCommissionRateBps } = require('./platformSettingsService');

const ACCOUNTS = Object.freeze({
  CASH: 'asset:cash',
  CONSULTATION_ESCROW: 'liability:consultation_escrow',
  LAWYER_PAYABLE: 'liability:lawyer_payable',
  CUSTOMER_REFUNDS_PAYABLE: 'liability:customer_refunds_payable',
  SUBSCRIPTION_DEFERRED_REVENUE: 'liability:subscription_deferred_revenue',
  PROMOTION_DEFERRED_REVENUE: 'liability:promotion_deferred_revenue',
  PLATFORM_COMMISSION_REVENUE: 'revenue:platform_commission',
  SUBSCRIPTION_REVENUE: 'revenue:subscription',
  PROMOTION_REVENUE: 'revenue:promotion',
});

function positiveTiyin(value, name = 'amountTiyin') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${name} must be a positive safe integer`);
  return amount;
}

function paymentAmountTiyin(payment) {
  return positiveTiyin(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
}

function validatePosting(input) {
  if (!input || typeof input.operationKey !== 'string' || !input.operationKey.trim()) throw new Error('operationKey is required');
  if (!input.reason || !input.currency) throw new Error('reason and currency are required');
  if (!Array.isArray(input.entries) || input.entries.length < 2) throw new Error('At least two entries are required');
  let debits = 0;
  let credits = 0;
  for (const entry of input.entries) {
    if (!entry.account || !['debit', 'credit'].includes(entry.direction)) throw new Error('Invalid financial entry');
    const amount = positiveTiyin(entry.amountTiyin);
    if (entry.direction === 'debit') debits += amount;
    else credits += amount;
  }
  if (!Number.isSafeInteger(debits) || debits !== credits) throw new Error('Financial transaction must be balanced');
}

function normalizeEntries(entries) {
  return entries.map((entry) => ({
    account: entry.account,
    direction: entry.direction,
    amountTiyin: Number(entry.amountTiyin),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function assertExistingPostingMatches(existing, input, tx) {
  const entries = await FinancialEntry.findAll({
    where: { financialTransactionId: existing.id },
    attributes: ['account', 'direction', 'amountTiyin'],
    transaction: tx,
  });
  const same = (existing.paymentId || null) === (input.paymentId || null)
    && existing.currency === input.currency
    && existing.reason === input.reason
    && JSON.stringify(normalizeEntries(entries)) === JSON.stringify(normalizeEntries(input.entries));
  if (!same) throw new Error(`Operation key collision for ${input.operationKey}`);
}

async function postInTransaction(input, tx) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:operationKey, 0))', {
    replacements: { operationKey: input.operationKey },
    transaction: tx,
  });
  const existing = await FinancialTransaction.findOne({ where: { operationKey: input.operationKey }, transaction: tx });
  if (existing) {
    await assertExistingPostingMatches(existing, input, tx);
    existing.wasCreated = false;
    return existing;
  }
  const postingToken = randomUUID();
  const posted = await FinancialTransaction.create({
    operationKey: input.operationKey,
    paymentId: input.paymentId || null,
    reason: input.reason,
    currency: input.currency,
    metadata: input.metadata || {},
    isPosted: false,
    postingToken,
  }, { transaction: tx });
  await FinancialEntry.bulkCreate(input.entries.map((entry) => ({
    financialTransactionId: posted.id,
    postingToken,
    account: entry.account,
    direction: entry.direction,
    amountTiyin: Number(entry.amountTiyin),
  })), { transaction: tx, validate: true });
  await posted.update({ isPosted: true, postingToken: null }, { transaction: tx, ledgerFinalize: true });
  posted.wasCreated = true;
  return posted;
}

async function postTransaction(input, options = {}) {
  validatePosting(input);
  if (options.transaction) return postInTransaction(input, options.transaction);
  return sequelize.transaction((tx) => postInTransaction(input, tx));
}

function splitGross(grossAmountTiyin, commissionRateBps) {
  const gross = positiveTiyin(grossAmountTiyin);
  const commission = Math.round((gross * commissionRateBps) / 10000);
  return { gross, commission, lawyerNet: gross - commission };
}

async function lockedPayment(payment, tx) {
  const id = typeof payment === 'string' ? payment : payment.id;
  const row = await Payment.findByPk(id, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!row) throw new Error('Payment not found');
  return row;
}

function assertPaidTypedPayment(payment, purpose) {
  if (payment.status !== 'paid') throw new Error(`${purpose} payment must be paid before posting`);
  if (payment.purpose !== purpose) throw new Error(`Expected exact ${purpose} payment purpose`);
  if (['consultation', 'consultation_extension'].includes(purpose)) {
    if (!payment.consultationId || payment.subscriptionId) throw new Error(`${purpose} payment has an invalid subject`);
  } else if (purpose === 'subscription') {
    if (!payment.subscriptionId || payment.consultationId || payment.lawyerPromotionId) throw new Error('subscription payment has an invalid subject');
  } else if (purpose === 'lawyer_promotion') {
    if (!payment.lawyerPromotionId || payment.consultationId || payment.subscriptionId) throw new Error('lawyer_promotion payment has an invalid subject');
  }
}

function snapshotValues(consultation) {
  const rate = Number(consultation.commissionRateBps);
  const gross = Number(consultation.grossAmountTiyin);
  const lawyerNet = Number(consultation.lawyerNetAmountTiyin);
  if (!Number.isInteger(rate) || rate < 0 || rate > 5000
    || !Number.isSafeInteger(gross) || gross <= 0
    || !Number.isSafeInteger(lawyerNet) || lawyerNet < 0 || lawyerNet > gross) {
    throw new Error('Financial snapshot requires operator repair');
  }
  return { rate, gross, lawyerNet };
}

async function validateConsultationObligation(consultation, tx, options = {}) {
  const snapshot = snapshotValues(consultation);
  const statuses = options.statuses || ['paid'];
  const where = {
    consultationId: consultation.id,
    status: { [Op.in]: statuses },
    escrowReleased: false,
  };
  if (options.excludePaymentId) where.id = { [Op.ne]: options.excludePaymentId };
  const payments = await Payment.findAll({ where, lock: tx.LOCK.UPDATE, transaction: tx });
  if (payments.some((payment) => !['consultation', 'consultation_extension'].includes(payment.purpose)
    || !payment.consultationId || payment.subscriptionId)) {
    throw new Error('Financial payment purpose or subject requires operator repair');
  }
  const gross = payments.reduce((sum, payment) => sum + paymentAmountTiyin(payment), 0);
  const lawyerNet = payments.reduce((sum, payment) => sum + splitGross(paymentAmountTiyin(payment), snapshot.rate).lawyerNet, 0);
  if (gross !== snapshot.gross || lawyerNet !== snapshot.lawyerNet) {
    throw new Error('Financial snapshot aggregate requires operator repair');
  }
  return { ...snapshot, payments };
}

async function snapshotConsultationFinancials(consultationOrId, grossAmountTiyin, tx) {
  if (!tx) throw new Error('snapshotConsultationFinancials requires a transaction');
  const id = typeof consultationOrId === 'string' ? consultationOrId : consultationOrId.id;
  const consultation = await Consultation.findByPk(id, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation not found');
  const gross = positiveTiyin(grossAmountTiyin);
  const hasAnySnapshot = consultation.commissionRateBps !== null || consultation.grossAmountTiyin !== null
    || consultation.lawyerNetAmountTiyin !== null;
  if (hasAnySnapshot) {
    const snapshot = snapshotValues(consultation);
    const expected = splitGross(gross, snapshot.rate);
    if (snapshot.gross !== gross || snapshot.lawyerNet !== expected.lawyerNet) {
      throw new Error('Consultation financial snapshot requires operator repair');
    }
    return consultation;
  }
  const rate = await getCommissionRateBps(tx);
  const { lawyerNet } = splitGross(gross, rate);
  await consultation.update({
    commissionRateBps: rate,
    grossAmountTiyin: gross,
    lawyerNetAmountTiyin: lawyerNet,
  }, { transaction: tx });
  return consultation;
}

async function recordConsultationEscrow(payment, tx, options = {}) {
  if (!tx) throw new Error('recordConsultationEscrow requires a transaction');
  const row = await lockedPayment(payment, tx);
  assertPaidTypedPayment(row, 'consultation');
  const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation not found');
  const gross = paymentAmountTiyin(row);
  const snapshot = snapshotValues(consultation);
  const split = splitGross(gross, snapshot.rate);
  if (snapshot.gross !== gross || snapshot.lawyerNet !== split.lawyerNet) {
    throw new Error('Consultation financial snapshot requires operator repair');
  }
  const posted = await postTransaction({
    operationKey: options.operationKey || `consultation:escrow:${row.id}`,
    paymentId: row.id,
    reason: 'consultation_escrow_received',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: gross },
    ],
  }, { transaction: tx });
  if (posted.wasCreated) {
    await LawyerProfile.increment('pendingBalance', {
      by: split.lawyerNet / 100,
      where: { userId: consultation.lawyerId },
      transaction: tx,
    });
  }
  return posted;
}

async function recordExtensionEscrow(payment, tx, options = {}) {
  if (!tx) throw new Error('recordExtensionEscrow requires a transaction');
  const row = await lockedPayment(payment, tx);
  assertPaidTypedPayment(row, 'consultation_extension');
  const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation not found');
  const gross = paymentAmountTiyin(row);
  const existing = await validateConsultationObligation(consultation, tx, { excludePaymentId: row.id });
  const split = splitGross(gross, existing.rate);
  const posted = await postTransaction({
    operationKey: options.operationKey || `consultation:extension:escrow:${row.id}`,
    paymentId: row.id,
    reason: 'consultation_extension_escrow_received',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'credit', amountTiyin: gross },
    ],
  }, { transaction: tx });
  if (posted.wasCreated) {
    await consultation.update({
      grossAmountTiyin: existing.gross + gross,
      lawyerNetAmountTiyin: existing.lawyerNet + split.lawyerNet,
    }, { transaction: tx });
    await LawyerProfile.increment('pendingBalance', {
      by: split.lawyerNet / 100,
      where: { userId: consultation.lawyerId },
      transaction: tx,
    });
  }
  return posted;
}

async function releaseConsultationEscrow(consultationOrId, tx) {
  if (!tx) throw new Error('releaseConsultationEscrow requires a transaction');
  const id = typeof consultationOrId === 'string' ? consultationOrId : consultationOrId.id;
  const consultation = await Consultation.findByPk(id, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation not found');
  const hasPaidEscrow = await Payment.count({
    where: { consultationId: id, status: 'paid', escrowReleased: false }, transaction: tx,
  });
  if (hasPaidEscrow === 0) return null;
  const { gross, lawyerNet } = await validateConsultationObligation(consultation, tx);
  const commission = gross - lawyerNet;
  const entries = [
    { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'debit', amountTiyin: gross },
    { account: ACCOUNTS.LAWYER_PAYABLE, direction: 'credit', amountTiyin: lawyerNet },
  ];
  if (commission > 0) entries.push({ account: ACCOUNTS.PLATFORM_COMMISSION_REVENUE, direction: 'credit', amountTiyin: commission });
  const posted = await postTransaction({
    operationKey: `consultation:release:${id}`,
    reason: 'consultation_completed',
    currency: 'UZS',
    entries,
  }, { transaction: tx });
  if (posted.wasCreated) {
    await Payment.update({ escrowReleased: true }, { where: { consultationId: id, status: 'paid', escrowReleased: false }, transaction: tx });
    await LawyerProfile.decrement('pendingBalance', { by: lawyerNet / 100, where: { userId: consultation.lawyerId }, transaction: tx });
    await LawyerProfile.increment('balance', { by: lawyerNet / 100, where: { userId: consultation.lawyerId }, transaction: tx });
  }
  return posted;
}

async function postConfirmedRefund(payment, tx, extension = false) {
  if (!tx) throw new Error('confirmConsultationRefund requires a transaction');
  const row = await lockedPayment(payment, tx);
  const expectedPurpose = extension ? 'consultation_extension' : 'consultation';
  if (row.status === 'refunded') {
    const operationKey = extension ? `consultation:extension:refund:${row.id}` : `consultation:refund:${row.id}`;
    const existing = await FinancialTransaction.findOne({ where: { operationKey }, transaction: tx });
    if (!existing) throw new Error('Refunded payment requires operator repair');
    existing.wasCreated = false;
    return existing;
  }
  if (!['paid', 'refund_pending'].includes(row.status) || row.purpose !== expectedPurpose
    || !row.consultationId || row.subscriptionId) {
    throw new Error(`Expected exact ${expectedPurpose} refund subject`);
  }
  const gross = paymentAmountTiyin(row);
  const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation not found');
  const obligation = await validateConsultationObligation(consultation, tx, { statuses: ['paid', 'refund_pending'] });
  const { lawyerNet } = splitGross(gross, obligation.rate);
  const posted = await postTransaction({
    operationKey: extension ? `consultation:extension:refund:${row.id}` : `consultation:refund:${row.id}`,
    paymentId: row.id,
    reason: extension ? 'consultation_extension_refunded' : 'consultation_refunded',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.CONSULTATION_ESCROW, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.CASH, direction: 'credit', amountTiyin: gross },
    ],
  }, { transaction: tx });
  if (posted.wasCreated) {
    await row.update({ status: 'refunded', refundedAmountTiyin: gross, refundedAt: new Date() }, { transaction: tx });
    await consultation.update({
      grossAmountTiyin: Math.max(0, Number(consultation.grossAmountTiyin || gross) - gross),
      lawyerNetAmountTiyin: Math.max(0, Number(consultation.lawyerNetAmountTiyin || lawyerNet) - lawyerNet),
    }, { transaction: tx });
    await LawyerProfile.decrement('pendingBalance', { by: lawyerNet / 100, where: { userId: consultation.lawyerId }, transaction: tx });
  }
  return posted;
}

async function confirmConsultationRefund(payment, tx) {
  return postConfirmedRefund(payment, tx, false);
}

async function refundExtensionEscrow(payment, tx) {
  return postConfirmedRefund(payment, tx, true);
}

async function requestConsultationRefund(payment, tx) {
  const row = await lockedPayment(payment, tx);
  if (row.status === 'refunded' || row.status === 'refund_pending') return row;
  if (row.status !== 'paid' || !['consultation', 'consultation_extension'].includes(row.purpose)
    || !row.consultationId || row.subscriptionId) {
    throw new Error('Expected paid consultation refund subject');
  }
  await row.update({
    status: 'refund_pending',
    providerData: { ...(row.providerData || {}), refundRequestedAt: new Date().toISOString() },
  }, { transaction: tx });
  return row;
}

async function activateSubscriptionPayment(payment, tx, options = {}) {
  if (!tx) throw new Error('activateSubscriptionPayment requires a transaction');
  const row = await lockedPayment(payment, tx);
  assertPaidTypedPayment(row, 'subscription');
  const subscription = await Subscription.findByPk(row.subscriptionId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!subscription) throw new Error('Subscription not found');
  const gross = paymentAmountTiyin(row);
  const plan = row.providerData?.subscriptionPlan;
  if (!['basic', 'pro'].includes(plan)) throw new Error('Paid subscription plan is missing');
  const now = new Date();
  const base = subscription.plan === plan && subscription.expiresAt && new Date(subscription.expiresAt) > now
    ? new Date(subscription.expiresAt) : now;
  const termEnd = new Date(base);
  termEnd.setUTCMonth(termEnd.getUTCMonth() + 1);
  const previousSubscription = {
    plan: subscription.plan,
    price: Number(subscription.price || 0),
    expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt).toISOString() : null,
  };
  const posted = await postTransaction({
    operationKey: options.operationKey || `subscription:activate:${row.id}`,
    paymentId: row.id,
    reason: 'subscription_payment_activated',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.SUBSCRIPTION_DEFERRED_REVENUE, direction: 'credit', amountTiyin: gross },
    ],
  }, { transaction: tx });
  if (posted.wasCreated) {
    await subscription.update({ plan, price: gross / 100, expiresAt: termEnd }, { transaction: tx });
    await row.update({
      paidAt: row.paidAt || now,
      providerData: {
        ...(row.providerData || {}),
        subscriptionPlan: plan,
        termStart: base.toISOString(),
        termEnd: termEnd.toISOString(),
        previousSubscription,
        consumedConsultationIds: row.providerData?.consumedConsultationIds || [],
      },
    }, { transaction: tx });
  }
  return posted;
}

async function recordSubscriptionBenefitConsumption(userId, consultationId, tx) {
  if (!tx) throw new Error('recordSubscriptionBenefitConsumption requires a transaction');
  const payments = await Payment.findAll({
    where: { userId, purpose: 'subscription', status: 'paid' },
    order: [['paidAt', 'DESC'], ['createdAt', 'DESC']],
    lock: tx.LOCK.UPDATE,
    transaction: tx,
  });
  const now = Date.now();
  const payment = payments.find((row) => {
    const start = new Date(row.providerData?.termStart).getTime();
    const end = new Date(row.providerData?.termEnd).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
  });
  if (!payment) return null;
  const consumed = payment.providerData?.consumedConsultationIds || [];
  if (!consumed.includes(consultationId)) {
    await payment.update({
      providerData: { ...payment.providerData, consumedConsultationIds: [...consumed, consultationId] },
    }, { transaction: tx });
  }
  return payment;
}

async function releaseSubscriptionBenefitConsumption(userId, consultationId, tx) {
  if (!tx) throw new Error('releaseSubscriptionBenefitConsumption requires a transaction');
  const payments = await Payment.findAll({
    where: { userId, purpose: 'subscription', status: 'paid' },
    lock: tx.LOCK.UPDATE,
    transaction: tx,
  });
  for (const payment of payments) {
    const consumed = payment.providerData?.consumedConsultationIds || [];
    if (consumed.includes(consultationId)) {
      await payment.update({
        providerData: { ...payment.providerData, consumedConsultationIds: consumed.filter((id) => id !== consultationId) },
      }, { transaction: tx });
      return payment;
    }
  }
  return null;
}

async function recognizedDeferredTiyin(paymentId, revenueAccount, tx) {
  const rows = await sequelize.query(`
    SELECT COALESCE(SUM(fe.amount_tiyin), 0) AS amount
    FROM financial_entries fe
    JOIN financial_transactions ft ON ft.id = fe.financial_transaction_id
    WHERE ft.payment_id = :paymentId
      AND fe.account = :account
      AND fe.direction = 'credit'
  `, { replacements: { paymentId, account: revenueAccount }, type: QueryTypes.SELECT, transaction: tx });
  return Number(rows[0].amount);
}

function exactDate(value, name) {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} is invalid`);
  return date;
}

async function confirmSubscriptionRefund(payment, amountTiyin, tx) {
  if (!tx) throw new Error('confirmSubscriptionRefund requires a transaction');
  const row = await lockedPayment(payment, tx);
  const amount = positiveTiyin(amountTiyin, 'refund amountTiyin');
  const operationKey = `subscription:refund:${row.id}`;
  if (['partially_refunded', 'refunded'].includes(row.status)) {
    const existing = await FinancialTransaction.findOne({ where: { operationKey }, transaction: tx });
    if (!existing || Number(row.refundedAmountTiyin) !== amount) {
      throw new Error('Refunded subscription payment requires operator repair');
    }
    existing.wasCreated = false;
    return existing;
  }
  if (!['paid', 'refund_pending'].includes(row.status) || row.purpose !== 'subscription'
    || !row.subscriptionId || row.consultationId) {
    throw new Error('Expected exact paid subscription refund subject');
  }
  if ((row.providerData?.consumedConsultationIds || []).length > 0) {
    throw new Error('Consumed subscription entitlement cannot be refunded');
  }
  const gross = paymentAmountTiyin(row);
  const recognized = await recognizedDeferredTiyin(row.id, ACCOUNTS.SUBSCRIPTION_REVENUE, tx);
  const unearned = gross - recognized;
  if (!Number.isSafeInteger(unearned) || unearned <= 0 || amount !== unearned) {
    throw new Error('Provider refund must equal exact unearned subscription amount');
  }
  const previous = row.providerData?.previousSubscription;
  if (!previous || !['free', 'basic', 'pro'].includes(previous.plan)
    || !Number.isSafeInteger(Number(previous.price)) || Number(previous.price) < 0) {
    throw new Error('Subscription refund snapshot requires operator repair');
  }
  const previousExpiresAt = exactDate(previous.expiresAt, 'previous subscription expiry');
  const activatedExpiresAt = exactDate(row.providerData?.termEnd, 'activated subscription expiry');
  const subscription = await Subscription.findByPk(row.subscriptionId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!subscription || subscription.plan !== row.providerData?.subscriptionPlan
    || Number(subscription.price) !== gross / 100
    || !subscription.expiresAt
    || new Date(subscription.expiresAt).getTime() !== activatedExpiresAt.getTime()) {
    throw new Error('Current subscription entitlement requires operator repair');
  }
  const posted = await postTransaction({
    operationKey,
    paymentId: row.id,
    reason: 'subscription_unearned_refunded',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.SUBSCRIPTION_DEFERRED_REVENUE, direction: 'debit', amountTiyin: amount },
      { account: ACCOUNTS.CASH, direction: 'credit', amountTiyin: amount },
    ],
  }, { transaction: tx });
  if (posted.wasCreated) {
    await subscription.update({
      plan: previous.plan,
      price: Number(previous.price),
      expiresAt: previousExpiresAt,
    }, { transaction: tx });
    await row.update({
      status: amount === gross ? 'refunded' : 'partially_refunded',
      refundedAmountTiyin: amount,
      refundedAt: new Date(),
    }, { transaction: tx });
  }
  return posted;
}

async function recognizeDeferredRevenue({ through = new Date(), tx, signal } = {}) {
  const abort = () => {
    if (signal?.aborted) throw Object.assign(new Error('Revenue job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
  };
  abort();
  const run = async (transaction) => {
    const candidates = await Payment.findAll({
      where: { purpose: 'subscription', status: 'paid' },
      attributes: ['id'],
      order: [['id', 'ASC']],
      transaction,
    });
    let recognizedTiyin = 0;
    let posted = 0;
    for (const candidate of candidates) {
      abort();
      const payment = await Payment.findByPk(candidate.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!payment || payment.status !== 'paid' || payment.purpose !== 'subscription') continue;
      const start = new Date(payment.providerData?.termStart);
      const end = new Date(payment.providerData?.termEnd);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) continue;
      const gross = paymentAmountTiyin(payment);
      const bounded = Math.max(start.getTime(), Math.min(new Date(through).getTime(), end.getTime()));
      const target = Math.floor((gross * (bounded - start.getTime())) / (end.getTime() - start.getTime()));
      const deferredAccount = ACCOUNTS.SUBSCRIPTION_DEFERRED_REVENUE;
      const revenueAccount = ACCOUNTS.SUBSCRIPTION_REVENUE;
      const already = await recognizedDeferredTiyin(payment.id, revenueAccount, transaction);
      const amount = target - already;
      if (amount <= 0) continue;
      const ledgerTransaction = await postTransaction({
        operationKey: `subscription:recognize:${payment.id}:${already + 1}-${target}`,
        paymentId: payment.id,
        reason: 'subscription_revenue_recognized',
        currency: payment.currency,
        entries: [
          { account: deferredAccount, direction: 'debit', amountTiyin: amount },
          { account: revenueAccount, direction: 'credit', amountTiyin: amount },
        ],
      }, { transaction });
      if (ledgerTransaction.wasCreated) {
        recognizedTiyin += amount;
        posted += 1;
      }
      abort();
    }
    return { recognizedTiyin, posted };
  };
  return tx ? run(tx) : sequelize.transaction(run);
}

async function recordPromotionDeferredRevenue(payment, tx, options = {}) {
  if (!tx) throw new Error('recordPromotionDeferredRevenue requires a transaction');
  const row = await lockedPayment(payment, tx);
  assertPaidTypedPayment(row, 'lawyer_promotion');
  const gross = paymentAmountTiyin(row);
  return postTransaction({
    operationKey: options.operationKey || `promotion:deferred:${row.id}`,
    paymentId: row.id,
    reason: 'promotion_payment_deferred',
    currency: row.currency,
    entries: [
      { account: ACCOUNTS.CASH, direction: 'debit', amountTiyin: gross },
      { account: ACCOUNTS.PROMOTION_DEFERRED_REVENUE, direction: 'credit', amountTiyin: gross },
    ],
  }, { transaction: tx });
}

async function runDeferredRevenueOnce(now = new Date(), {
  signal,
  recognizeSubscriptions = ({ through, signal: jobSignal }) => recognizeDeferredRevenue({
    through, signal: jobSignal,
  }),
  recognizePromotions = (through, options) => require('./promotionJobs').recognizePromotionRevenue(through, options),
} = {}) {
  const abort = () => {
    if (signal?.aborted) throw Object.assign(new Error('Revenue job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
  };
  abort();
  const subscriptions = await recognizeSubscriptions({ through: now, signal });
  abort();
  const promotions = await recognizePromotions(now, { signal });
  abort();
  return { subscriptions, promotions };
}

module.exports = {
  ACCOUNTS,
  postTransaction,
  snapshotConsultationFinancials,
  recordConsultationEscrow,
  releaseConsultationEscrow,
  recordExtensionEscrow,
  confirmConsultationRefund,
  refundExtensionEscrow,
  requestConsultationRefund,
  activateSubscriptionPayment,
  confirmSubscriptionRefund,
  recordSubscriptionBenefitConsumption,
  releaseSubscriptionBenefitConsumption,
  recognizeDeferredRevenue,
  runDeferredRevenueOnce,
  recordPromotionDeferredRevenue,
  splitGross,
};
