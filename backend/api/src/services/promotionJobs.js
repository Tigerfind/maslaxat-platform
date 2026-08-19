const { Op } = require('sequelize');
const { sequelize, LawyerPromotion, Payment, FinancialTransaction } = require('../models');
const { ACCOUNTS, postTransaction } = require('./ledgerService');
const {
  DAY_SECONDS,
  normalizedScope,
  lockScope,
  lawyerEligibility,
  releasePromotionSlot,
  pauseIneligiblePromotion,
} = require('./promotionService');

function exactDate(value, name = 'date') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} is invalid`);
  return date;
}

async function expireAndAdvancePromotions(now = new Date(), { signal } = {}) {
  abortIfRequested(signal);
  const checkedAt = exactDate(now);
  const candidates = await LawyerPromotion.findAll({
    where: {
      [Op.or]: [
        { status: 'active', endsAt: { [Op.lte]: checkedAt } },
        { status: 'pending_payment', reservationExpiresAt: { [Op.lte]: checkedAt } },
      ],
    },
    attributes: ['id'],
    order: [['id', 'ASC']],
  });
  let expired = 0;
  let reservationsReleased = 0;
  let activated = 0;
  for (const candidate of candidates) {
    abortIfRequested(signal);
    await sequelize.transaction(async (transaction) => {
      const initial = await LawyerPromotion.findByPk(candidate.id, { transaction });
      if (!initial) return;
      const scope = normalizedScope(initial);
      await lockScope(scope, transaction);
      const campaign = await LawyerPromotion.findByPk(candidate.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (campaign.status === 'pending_payment' && campaign.reservationExpiresAt
        && campaign.reservationExpiresAt.getTime() <= checkedAt.getTime()) {
        await campaign.update({ reservationExpiresAt: null }, { transaction });
        reservationsReleased += 1;
        if (await releasePromotionSlot(scope, transaction, checkedAt)) activated += 1;
      } else if (campaign.status === 'active' && campaign.endsAt
        && campaign.endsAt.getTime() <= checkedAt.getTime()) {
        await campaign.update({ status: 'expired', remainingSeconds: 0, activeSince: null, endsAt: campaign.endsAt }, { transaction });
        expired += 1;
        if (await releasePromotionSlot(scope, transaction, checkedAt)) activated += 1;
      }
    });
    abortIfRequested(signal);
  }
  return { expired, reservationsReleased, activated };
}

async function resumeEligiblePromotions(now = new Date(), { signal } = {}) {
  abortIfRequested(signal);
  const checkedAt = exactDate(now);
  const activeIds = await LawyerPromotion.findAll({ where: { status: 'active' }, attributes: ['id'], order: [['id', 'ASC']] });
  let paused = 0;
  for (const row of activeIds) {
    abortIfRequested(signal);
    await sequelize.transaction(async (transaction) => {
      const initial = await LawyerPromotion.findByPk(row.id, { transaction });
      if (!initial) return;
      const scope = normalizedScope(initial);
      await lockScope(scope, transaction);
      const eligibility = await lawyerEligibility(initial.lawyerId, scope, transaction, { lock: true });
      const campaign = await LawyerPromotion.findByPk(row.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!campaign || campaign.status !== 'active') return;
      await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction });
      if (!eligibility.eligible) {
        await pauseIneligiblePromotion(campaign.id, checkedAt, 'lawyer_ineligible', transaction);
        paused += 1;
      }
    });
    abortIfRequested(signal);
  }

  const queuedIds = await LawyerPromotion.findAll({ where: { status: 'queued' }, attributes: ['id'], order: [['paidAt', 'ASC'], ['id', 'ASC']] });
  let queuedRefundPending = 0;
  for (const row of queuedIds) {
    abortIfRequested(signal);
    await sequelize.transaction(async (transaction) => {
      const initial = await LawyerPromotion.findByPk(row.id, { transaction });
      if (!initial) return;
      const scope = normalizedScope(initial);
      await lockScope(scope, transaction);
      const eligibility = await lawyerEligibility(initial.lawyerId, scope, transaction, { lock: true });
      const campaign = await LawyerPromotion.findByPk(row.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (campaign.status !== 'queued') return;
      const payment = await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction });
      if (eligibility.eligible) return;
      await campaign.update({ status: 'refund_pending', refundRequestedAt: checkedAt, cancellationReason: 'queued_lawyer_ineligible' }, { transaction });
      if (payment.status === 'paid') await payment.update({ status: 'refund_pending' }, { transaction });
      queuedRefundPending += 1;
    });
    abortIfRequested(signal);
  }

  const pausedIds = await LawyerPromotion.findAll({ where: { status: 'paused' }, attributes: ['id'], order: [['id', 'ASC']] });
  let resumed = 0;
  let refundPending = 0;
  let activated = 0;
  for (const row of pausedIds) {
    abortIfRequested(signal);
    await sequelize.transaction(async (transaction) => {
      const initial = await LawyerPromotion.findByPk(row.id, { transaction });
      if (!initial) return;
      const scope = normalizedScope(initial);
      await lockScope(scope, transaction);
      const eligibility = await lawyerEligibility(initial.lawyerId, scope, transaction, { lock: true });
      const campaign = await LawyerPromotion.findByPk(row.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (campaign.status !== 'paused') return;
      const payment = await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction });
      if (eligibility.eligible && checkedAt.getTime() <= campaign.resumeDeadline.getTime()) {
        const endsAt = new Date(checkedAt.getTime() + Number(campaign.remainingSeconds) * 1000);
        await campaign.update({
          status: 'active', activeSince: checkedAt, endsAt, pausedAt: null, resumeDeadline: null,
        }, { transaction });
        await payment.update({ providerData: { ...(payment.providerData || {}), termEnd: endsAt.toISOString() } }, { transaction });
        resumed += 1;
      } else if (checkedAt.getTime() > campaign.resumeDeadline.getTime()) {
        await campaign.update({ status: 'refund_pending', refundRequestedAt: checkedAt, cancellationReason: 'resume_deadline_expired' }, { transaction });
        if (payment.status === 'paid') await payment.update({ status: 'refund_pending' }, { transaction });
        refundPending += 1;
      }
    });
    abortIfRequested(signal);
  }
  return { paused, resumed, refundPending, queuedRefundPending, activated };
}

function servedSeconds(campaign, through) {
  const total = Number(campaign.durationDays) * DAY_SECONDS;
  if (campaign.status === 'expired') return total;
  const remaining = Number(campaign.remainingSeconds ?? total);
  let served = total - remaining;
  if (campaign.status === 'active' && campaign.activeSince) {
    const end = campaign.endsAt ? Math.min(through.getTime(), campaign.endsAt.getTime()) : through.getTime();
    served += Math.max(0, Math.floor((end - campaign.activeSince.getTime()) / 1000));
  }
  return Math.max(0, Math.min(total, served));
}

async function recognizePromotionRevenue(through = new Date(), { signal } = {}) {
  abortIfRequested(signal);
  const recognizedThrough = exactDate(through, 'through');
  const candidates = await LawyerPromotion.findAll({
    where: { status: { [Op.in]: ['active', 'paused', 'expired', 'refund_pending', 'refunded'] }, paymentId: { [Op.ne]: null } },
    attributes: ['id'],
    order: [['id', 'ASC']],
  });
  let posted = 0;
  let recognizedTiyin = 0;
  for (const candidate of candidates) {
    abortIfRequested(signal);
    await sequelize.transaction(async (transaction) => {
      const campaign = await LawyerPromotion.findByPk(candidate.id, { lock: transaction.LOCK.UPDATE, transaction });
      if (!campaign?.startsAt) return;
      const payment = await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction });
      if (!payment || !['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(payment.status)) return;
      const completedDays = Math.min(Number(campaign.durationDays), Math.floor(servedSeconds(campaign, recognizedThrough) / DAY_SECONDS));
      const baseAmount = Math.floor(Number(campaign.priceAmountTiyin) / Number(campaign.durationDays));
      for (let day = 1; day <= completedDays; day += 1) {
        abortIfRequested(signal);
        const operationKey = `promotion:recognize:${campaign.id}:day:${day}`;
        const existing = await FinancialTransaction.findOne({ where: { operationKey }, transaction });
        if (existing) continue;
        const amount = day === Number(campaign.durationDays)
          ? Number(campaign.priceAmountTiyin) - baseAmount * (Number(campaign.durationDays) - 1)
          : baseAmount;
        const result = await postTransaction({
          operationKey,
          paymentId: payment.id,
          reason: 'promotion_revenue_recognized',
          currency: campaign.currency,
          metadata: { promotionId: campaign.id, serviceDay: day },
          entries: [
            { account: ACCOUNTS.PROMOTION_DEFERRED_REVENUE, direction: 'debit', amountTiyin: amount },
            { account: ACCOUNTS.PROMOTION_REVENUE, direction: 'credit', amountTiyin: amount },
          ],
        }, { transaction });
        if (result.wasCreated) {
          posted += 1;
          recognizedTiyin += amount;
        }
      }
    });
    abortIfRequested(signal);
  }
  return { posted, recognizedTiyin };
}

function abortIfRequested(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Promotion job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
}

async function runPromotionLifecycleOnce(now = new Date(), {
  signal,
  expire = expireAndAdvancePromotions,
  resume = resumeEligiblePromotions,
} = {}) {
  abortIfRequested(signal);
  const expired = await expire(now, { signal });
  abortIfRequested(signal);
  const eligibility = await resume(now, { signal });
  abortIfRequested(signal);
  return { expired, eligibility };
}

module.exports = {
  expireAndAdvancePromotions,
  resumeEligiblePromotions,
  recognizePromotionRevenue,
  runPromotionLifecycleOnce,
};
