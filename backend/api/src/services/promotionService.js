const { Op, QueryTypes } = require('sequelize');
const {
  sequelize,
  User,
  LawyerProfile,
  LawyerDocument,
  LawyerPromotion,
  PromotionPackage,
  Payment,
  FinancialTransaction,
  PlatformSettingAudit,
} = require('../models');
const { ACCOUNTS, postTransaction, recordPromotionDeferredRevenue } = require('./ledgerService');
const { evaluateAuthorizationDecision } = require('../middleware/auth');
const { getAuthorizationMode, recordAuthorizationDecision } = require('./authorizationRuntime');

const DAY_SECONDS = 24 * 60 * 60;
const RESERVATION_MS = 30 * 60 * 1000;
const RESUME_MS = 7 * 24 * 60 * 60 * 1000;
const OCCUPYING_STATUSES = ['active', 'paused', 'scheduled'];

function exactDate(value = new Date(), name = 'date') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${name} is invalid`);
  return date;
}

function normalizedScope({ placement = 'catalog_top', specialization, location = null }) {
  if (placement !== 'catalog_top') throw new Error('Unsupported promotion placement');
  if (typeof specialization !== 'string' || !specialization.trim()) throw new Error('specialization is required');
  return {
    placement,
    specialization: specialization.trim(),
    location: typeof location === 'string' && location.trim() ? location.trim() : null,
  };
}

function scopeKey(scope) {
  return `${scope.placement}:${scope.specialization}:${scope.location || '*'}`;
}

async function lockScope(scope, transaction) {
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:scopeKey, 0))', {
    replacements: { scopeKey: scopeKey(scope) }, transaction,
  });
}

function scopeWhere(scope) {
  return { placement: scope.placement, specialization: scope.specialization, location: scope.location };
}

async function lawyerEligibility(lawyerId, scope, transaction, { lock = false } = {}) {
  const lockOptions = lock ? { lock: transaction.LOCK.UPDATE } : {};
  // Keep this order identical for reservation and activation to avoid cross-flow deadlocks.
  const user = await User.findByPk(lawyerId, { transaction, ...lockOptions });
  const profile = await LawyerProfile.findOne({ where: { userId: lawyerId }, transaction, ...lockOptions });
  const documents = await LawyerDocument.findAll({
    where: { userId: lawyerId },
    attributes: ['id', 'userId', 'type', 'verificationStatus', 'approvedByUserId', 'approvedAt'],
    order: [['id', 'ASC']],
    transaction,
    ...lockOptions,
  });
  const hasApprovedLicense = documents.some((document) => document.userId === lawyerId
    && document.type === 'license'
    && document.verificationStatus === 'approved'
    && document.approvedByUserId
    && document.approvedAt);
  const specializations = Array.isArray(profile?.specializations) && profile.specializations.length
    ? profile.specializations : profile?.specialization ? [profile.specialization] : [];
  const hasSchedule = profile?.schedule && typeof profile.schedule === 'object'
    && Object.values(profile.schedule).some((day) => day?.enabled);
  const complete = Boolean(profile && String(profile.description || '').trim().length >= 50
    && Number(profile.price) >= 50000 && specializations.length && hasSchedule && hasApprovedLicense);
  const legacyAllowed = Boolean(user?.isActive && user.role === 'lawyer'
    && profile?.verificationStatus === 'approved');
  const capabilityAllowed = Boolean(user?.isActive && user.accountType === 'member'
    && user.twoFactorEnabled && profile?.verificationStatus === 'approved'
    && profile?.operatingStatus === 'enabled');
  const authorization = await evaluateAuthorizationDecision({
    authorizationMode: getAuthorizationMode(), channel: 'catalog',
    surface: 'CATALOG PROMOTION eligibility', mode: 'lawyer', legacyAllowed, capabilityAllowed,
    recordDecision: recordAuthorizationDecision, compatibilityAuthority: 'legacy',
  });
  const eligible = Boolean(authorization.allowed && profile?.isAvailable
    && profile.promotionPilotEnabled && complete
    && specializations.includes(scope.specialization)
    && (!scope.location || profile.location === scope.location));
  return { eligible, user, profile, complete, hasApprovedLicense };
}

function assertEligibilityResult(result) {
  if (!result.eligible) {
    const error = new Error('Lawyer is not eligible for the promotion pilot');
    error.status = 403;
    throw error;
  }
  return result;
}

async function assertEligible(lawyerId, scope, transaction, options) {
  return assertEligibilityResult(await lawyerEligibility(lawyerId, scope, transaction, options));
}

async function lockLawyerEligibilitySet(lawyerIds, scope, transaction) {
  const results = new Map();
  const orderedIds = [...new Set(lawyerIds)].sort((left, right) => left.localeCompare(right));
  for (const lawyerId of orderedIds) {
    results.set(lawyerId, await lawyerEligibility(lawyerId, scope, transaction, { lock: true }));
  }
  return results;
}

function capacityOccupancyWhere(now) {
  return {
    [Op.or]: [
      { status: { [Op.in]: OCCUPYING_STATUSES } },
      { status: 'refund_pending', startsAt: { [Op.ne]: null } },
      { status: 'pending_payment', reservationExpiresAt: { [Op.gt]: now } },
    ],
  };
}

async function occupyingCampaigns(scope, now, transaction, excludeId = null) {
  const where = {
    ...scopeWhere(scope),
    ...capacityOccupancyWhere(now),
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  return LawyerPromotion.findAll({ where, attributes: ['id', 'maxActiveSlots'], transaction });
}

async function hasCapacity(scope, now, candidateLimit, transaction, excludeId = null) {
  const occupants = await occupyingCampaigns(scope, now, transaction, excludeId);
  const limit = Math.min(Number(candidateLimit), ...occupants.map((campaign) => Number(campaign.maxActiveSlots)));
  return occupants.length < limit;
}

async function reservePromotion({
  lawyerId,
  packageId,
  specialization,
  location,
  idempotencyKey,
  now = new Date(),
  transaction = null,
}) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  const reservedAt = exactDate(now);
  const run = async (tx) => {
    const promotionPackage = await PromotionPackage.findByPk(packageId, { transaction: tx });
    if (!promotionPackage?.isActive) throw new Error('Promotion package is not active');
    const scope = normalizedScope({ placement: promotionPackage.placement, specialization, location });
    await lockScope(scope, tx);
    const existing = await LawyerPromotion.findOne({
      where: { lawyerId, idempotencyKey: idempotencyKey.trim() }, lock: tx.LOCK.UPDATE, transaction: tx,
    });
    if (existing) {
      const same = existing.packageId === packageId && existing.specialization === scope.specialization
        && existing.location === scope.location;
      if (!same) throw new Error('Idempotency key was used for different promotion terms');
      return {
        promotion: existing,
        outcome: existing.reservationExpiresAt && existing.reservationExpiresAt > reservedAt ? 'reserved' : 'queued_after_payment',
        created: false,
      };
    }
    await assertEligible(lawyerId, scope, tx, { lock: true });
    const available = await hasCapacity(scope, reservedAt, promotionPackage.maxActiveSlots, tx);
    const promotion = await LawyerPromotion.create({
      lawyerId,
      packageId,
      idempotencyKey: idempotencyKey.trim(),
      ...scope,
      durationDays: promotionPackage.durationDays,
      priceAmountTiyin: promotionPackage.priceAmountTiyin,
      currency: promotionPackage.currency,
      maxActiveSlots: promotionPackage.maxActiveSlots,
      sponsoredPositions: promotionPackage.sponsoredPositions,
      status: 'pending_payment',
      reservationExpiresAt: available ? new Date(reservedAt.getTime() + RESERVATION_MS) : null,
    }, { transaction: tx });
    return { promotion, outcome: available ? 'reserved' : 'queued_after_payment', created: true };
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

async function createPromotionCheckout({
  lawyerId,
  packageId,
  specialization,
  location,
  idempotencyKey,
  checkoutUrlFactory,
  now = new Date(),
}) {
  return sequelize.transaction(async (transaction) => {
    const reservation = await reservePromotion({
      lawyerId,
      packageId,
      specialization,
      location,
      idempotencyKey,
      now,
      transaction,
    });
    if (reservation.created) {
      const promotion = reservation.promotion;
      await PlatformSettingAudit.create({
        key: `promotion_checkout:${promotion.id}:reserved`,
        oldValue: 'null',
        newValue: JSON.stringify({
          promotionId: promotion.id,
          packageId: promotion.packageId,
          placement: promotion.placement,
          specialization: promotion.specialization,
          location: promotion.location,
          durationDays: Number(promotion.durationDays),
          priceAmountTiyin: Number(promotion.priceAmountTiyin),
          currency: promotion.currency,
          status: promotion.status,
        }),
        changedByUserId: lawyerId,
      }, { transaction });
    }
    const checkout = await require('./paymentService').createCheckout({
      userId: lawyerId,
      purpose: 'lawyer_promotion',
      subjectId: reservation.promotion.id,
      idempotencyKey,
      transaction,
      checkoutUrlFactory,
    });
    return { reservation, checkout };
  });
}

async function startCampaign(campaign, payment, now, transaction) {
  const durationSeconds = Number(campaign.durationDays) * DAY_SECONDS;
  const endsAt = new Date(now.getTime() + durationSeconds * 1000);
  await campaign.update({
    status: 'active',
    startsAt: campaign.startsAt || now,
    activeSince: now,
    endsAt,
    pausedAt: null,
    resumeDeadline: null,
    remainingSeconds: durationSeconds,
    reservationExpiresAt: null,
  }, { transaction });
  await payment.update({
    providerData: {
      ...(payment.providerData || {}),
      termStart: (campaign.startsAt || now).toISOString(),
      termEnd: endsAt.toISOString(),
    },
  }, { transaction });
  return campaign;
}

async function activatePaidPromotion(promotionId, transaction, now = new Date(), expectedPaymentId = null) {
  if (!transaction) throw new Error('activatePaidPromotion requires a transaction');
  const activatedAt = exactDate(now);
  const candidate = await LawyerPromotion.findByPk(promotionId, { transaction });
  if (!candidate) throw new Error('Promotion not found');
  const scope = normalizedScope(candidate);
  await lockScope(scope, transaction);
  const eligibility = await lawyerEligibility(candidate.lawyerId, scope, transaction, { lock: true });
  const campaign = await LawyerPromotion.findByPk(promotionId, { lock: transaction.LOCK.UPDATE, transaction });
  if (expectedPaymentId && campaign.paymentId && campaign.paymentId !== expectedPaymentId) {
    throw new Error('Promotion is already bound to a different payment');
  }
  const payment = expectedPaymentId
    ? await Payment.findByPk(expectedPaymentId, { lock: transaction.LOCK.UPDATE, transaction })
    : campaign.paymentId
      ? await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction })
    : await Payment.findOne({ where: { lawyerPromotionId: campaign.id }, lock: transaction.LOCK.UPDATE, transaction });
  if (!payment || payment.status !== 'paid' || payment.purpose !== 'lawyer_promotion'
    || payment.lawyerPromotionId !== campaign.id || payment.consultationId || payment.subscriptionId
    || (campaign.paymentId && campaign.paymentId !== payment.id)
    || Number(payment.amountTiyin) !== Number(campaign.priceAmountTiyin) || payment.currency !== campaign.currency) {
    throw new Error('Paid promotion subject or package snapshot is invalid');
  }
  if (['active', 'queued', 'paused', 'expired'].includes(campaign.status)) return campaign;
  if (campaign.status !== 'pending_payment') throw new Error(`Promotion state ${campaign.status} cannot activate`);
  assertEligibilityResult(eligibility);
  if (!campaign.paymentId) await campaign.update({ paymentId: payment.id }, { transaction });
  await recordPromotionDeferredRevenue(payment, transaction);
  const hasReservation = campaign.reservationExpiresAt && activatedAt.getTime() < campaign.reservationExpiresAt.getTime();
  const available = await hasCapacity(scope, activatedAt, campaign.maxActiveSlots, transaction, campaign.id);
  const paidAt = payment.paidAt || activatedAt;
  await campaign.update({ paidAt, reservationExpiresAt: null }, { transaction });
  if (hasReservation || available) return startCampaign(campaign, payment, activatedAt, transaction);
  await campaign.update({ status: 'queued', startsAt: null, endsAt: null, activeSince: null, remainingSeconds: null }, { transaction });
  return campaign;
}

async function markRefundPending(campaign, payment, now, reason, transaction) {
  if (!['refund_pending', 'refunded'].includes(campaign.status)) {
    await campaign.update({
      status: 'refund_pending', refundRequestedAt: now, cancellationReason: reason,
    }, { transaction });
  }
  if (!['refund_pending', 'refunded'].includes(payment.status)) {
    await payment.update({ status: 'refund_pending' }, { transaction });
  }
}

async function releasePromotionSlot(scopeInput, transaction, now = new Date()) {
  if (!transaction) throw new Error('releasePromotionSlot requires a transaction');
  const checkedAt = exactDate(now);
  const scope = normalizedScope(scopeInput);
  await lockScope(scope, transaction);
  const queue = await LawyerPromotion.findAll({
    where: { ...scopeWhere(scope), status: 'queued' },
    attributes: ['id', 'lawyerId'],
    order: [['paidAt', 'ASC'], ['id', 'ASC']],
    transaction,
  });
  const eligibilityByLawyer = await lockLawyerEligibilitySet(queue.map((candidate) => candidate.lawyerId), scope, transaction);
  for (const candidate of queue) {
    const eligibility = eligibilityByLawyer.get(candidate.lawyerId);
    const campaign = await LawyerPromotion.findByPk(candidate.id, { lock: transaction.LOCK.UPDATE, transaction });
    if (!campaign || campaign.status !== 'queued') continue;
    if (!(await hasCapacity(scope, checkedAt, campaign.maxActiveSlots, transaction, campaign.id))) return null;
    const payment = await Payment.findByPk(campaign.paymentId, { lock: transaction.LOCK.UPDATE, transaction });
    if (!payment || payment.status !== 'paid') continue;
    if (!eligibility.eligible) {
      await markRefundPending(campaign, payment, checkedAt, 'queued_lawyer_ineligible', transaction);
      continue;
    }
    await startCampaign(campaign, payment, checkedAt, transaction);
    return campaign;
  }
  return null;
}

async function pauseIneligiblePromotion(promotionId, now = new Date(), reason = 'lawyer_ineligible', transaction = null) {
  const pausedAt = exactDate(now);
  const run = async (tx) => {
    const candidate = await LawyerPromotion.findByPk(promotionId, { transaction: tx });
    if (!candidate) throw new Error('Promotion not found');
    const scope = normalizedScope(candidate);
    await lockScope(scope, tx);
    const campaign = await LawyerPromotion.findByPk(promotionId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (campaign.status === 'paused') return campaign;
    if (campaign.status !== 'active') throw new Error('Only an active promotion can pause');
    const remaining = Math.max(0, Math.ceil((campaign.endsAt.getTime() - pausedAt.getTime()) / 1000));
    await campaign.update({
      status: 'paused', pausedAt, activeSince: null, endsAt: null,
      resumeDeadline: new Date(pausedAt.getTime() + RESUME_MS), remainingSeconds: remaining,
      cancellationReason: reason,
    }, { transaction: tx });
    return campaign;
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

async function cancelQueuedPromotion({ promotionId, lawyerId, reason, now = new Date(), transaction = null }) {
  const requestedAt = exactDate(now);
  const run = async (tx) => {
    const candidate = await LawyerPromotion.findByPk(promotionId, { transaction: tx });
    if (!candidate) throw new Error('Promotion not found');
    const scope = normalizedScope(candidate);
    await lockScope(scope, tx);
    const campaign = await LawyerPromotion.findByPk(promotionId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (campaign.lawyerId !== lawyerId) throw new Error('Access denied');
    if (['refund_pending', 'refunded'].includes(campaign.status)) return campaign;
    if (campaign.status !== 'queued') throw new Error('Only a queued promotion can be cancelled by its owner');
    const payment = await Payment.findByPk(campaign.paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    await campaign.update({ cancellationRequestedAt: requestedAt }, { transaction: tx });
    await markRefundPending(campaign, payment, requestedAt, reason, tx);
    return campaign;
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

async function recognizedPromotionTiyin(paymentId, transaction) {
  const rows = await sequelize.query(`
    SELECT COALESCE(SUM(fe.amount_tiyin), 0) AS amount
    FROM financial_entries fe
    JOIN financial_transactions ft ON ft.id = fe.financial_transaction_id
    WHERE ft.payment_id = :paymentId
      AND fe.account = :account AND fe.direction = 'credit'
  `, {
    replacements: { paymentId, account: ACCOUNTS.PROMOTION_REVENUE },
    type: QueryTypes.SELECT,
    transaction,
  });
  return Number(rows[0].amount);
}

function earnedPromotionTiyin(campaign, through) {
  if (!campaign.startsAt) return 0;
  const days = Number(campaign.durationDays);
  const totalSeconds = days * DAY_SECONDS;
  let served = totalSeconds - Number(campaign.remainingSeconds ?? totalSeconds);
  if (campaign.status === 'active' && campaign.activeSince) {
    const end = campaign.endsAt ? Math.min(through.getTime(), campaign.endsAt.getTime()) : through.getTime();
    served += Math.max(0, Math.floor((end - campaign.activeSince.getTime()) / 1000));
  }
  const completedDays = Math.min(days, Math.floor(Math.max(0, served) / DAY_SECONDS));
  const gross = Number(campaign.priceAmountTiyin);
  const base = Math.floor(gross / days);
  return completedDays === days ? gross : completedDays * base;
}

async function confirmPromotionRefund(promotionId, amountTiyin, transaction = null, now = new Date()) {
  const confirmedAt = exactDate(now);
  const run = async (tx) => {
    const candidate = await LawyerPromotion.findByPk(promotionId, { transaction: tx });
    if (!candidate) throw new Error('Promotion not found');
    const scope = normalizedScope(candidate);
    await lockScope(scope, tx);
    const campaign = await LawyerPromotion.findByPk(promotionId, { lock: tx.LOCK.UPDATE, transaction: tx });
    const payment = await Payment.findByPk(campaign.paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    const operationKey = `promotion:refund:${payment.id}`;
    if (campaign.status === 'refunded' && ['partially_refunded', 'refunded'].includes(payment.status)) {
      return FinancialTransaction.findOne({ where: { operationKey }, transaction: tx });
    }
    if (campaign.status !== 'refund_pending' || payment.status !== 'refund_pending') {
      throw new Error('Promotion refund requires provider confirmation after refund request');
    }
    const recognized = await recognizedPromotionTiyin(payment.id, tx);
    const earned = earnedPromotionTiyin(campaign, confirmedAt);
    if (recognized > earned) throw new Error('Promotion revenue exceeds served entitlement and requires operator repair');
    const unearned = Number(payment.amountTiyin) - earned;
    if (!Number.isSafeInteger(Number(amountTiyin)) || Number(amountTiyin) !== unearned || unearned <= 0) {
      throw new Error('Provider refund must equal exact unearned promotion amount');
    }
    const posting = await postTransaction({
      operationKey,
      paymentId: payment.id,
      reason: 'promotion_unearned_refunded',
      currency: payment.currency,
      entries: [
        { account: ACCOUNTS.PROMOTION_DEFERRED_REVENUE, direction: 'debit', amountTiyin: unearned },
        { account: ACCOUNTS.CASH, direction: 'credit', amountTiyin: unearned },
      ],
    }, { transaction: tx });
    await payment.update({
      status: unearned === Number(payment.amountTiyin) ? 'refunded' : 'partially_refunded',
      refundedAmountTiyin: unearned,
      refundedAt: confirmedAt,
    }, { transaction: tx });
    await campaign.update({ status: 'refunded', refundedAt: confirmedAt, cancelledAt: confirmedAt }, { transaction: tx });
    await releasePromotionSlot(scope, tx, confirmedAt);
    return posting;
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

module.exports = {
  DAY_SECONDS,
  RESERVATION_MS,
  RESUME_MS,
  normalizedScope,
  lockScope,
  lawyerEligibility,
  lockLawyerEligibilitySet,
  capacityOccupancyWhere,
  createPromotionCheckout,
  reservePromotion,
  activatePaidPromotion,
  releasePromotionSlot,
  pauseIneligiblePromotion,
  cancelQueuedPromotion,
  confirmPromotionRefund,
  recognizedPromotionTiyin,
  earnedPromotionTiyin,
};
