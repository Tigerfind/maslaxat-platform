const { Op } = require('sequelize');
const {
  sequelize,
  Consultation,
  LawyerProfile,
  LawyerPromotion,
  Payment,
  Subscription,
} = require('../models');
const notificationService = require('./notificationService');
const {
  snapshotConsultationFinancials,
  recordConsultationEscrow,
  recordExtensionEscrow,
  confirmConsultationRefund,
  refundExtensionEscrow,
  activateSubscriptionPayment,
  confirmSubscriptionRefund,
  requestConsultationRefund,
} = require('./ledgerService');
const { createCheckoutUrl } = require('./providers/payme');

const SUBSCRIPTION_PRICES = Object.freeze({ basic: 9900000, pro: 29900000 });
const EXTENSION_PROPOSAL_TTL_MS = 15 * 60 * 1000;

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function checkoutIdempotencyKey(purpose, rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.trim() || rawKey.trim().length > 255) {
    const error = new Error('idempotencyKey must be a non-empty string of at most 255 characters');
    error.status = 400;
    throw error;
  }
  const raw = rawKey.trim();
  return `${requiredString(purpose, 'purpose')}:${raw}`;
}

function checkoutIdempotencyCandidates(purpose, rawKey) {
  const raw = typeof rawKey === 'string' ? rawKey.trim() : rawKey;
  return [checkoutIdempotencyKey(purpose, raw), raw];
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

const CANCELLATION_REQUEST_KEYS = ['reason', 'requestedAt', 'requestedBy', 'state'];
const CANCELLATION_REQUEST_STATES = ['requested', 'cancelled_locally', 'provider_cancelled'];

function validateCancellationRequest(providerData) {
  if (providerData == null) return null;
  if (!isPlainObject(providerData)) throw new Error('Payment providerData must be a plain object');
  const request = providerData.cancellationRequest;
  if (request == null) return null;
  if (!isPlainObject(request)
    || Object.keys(request).sort().join(',') !== CANCELLATION_REQUEST_KEYS.join(',')
    || !CANCELLATION_REQUEST_STATES.includes(request.state)
    || typeof request.requestedAt !== 'string'
    || !Number.isFinite(Date.parse(request.requestedAt))
    || typeof request.requestedBy !== 'string' || !request.requestedBy.trim()
    || typeof request.reason !== 'string' || !request.reason.trim()) {
    throw new Error('Cancellation request metadata is invalid');
  }
  return request;
}

const PROTECTED_PROVIDER_DATA_KEYS = new Set([
  'cancellationRequest',
  'proposalId',
  'proposalCreatedAt',
  'expiresAt',
  'proposalState',
  'consentUserIds',
  'extensionMinutes',
  'baseDuration',
  'basePrice',
  'targetDuration',
  'targetPrice',
  'addedMinutes',
  'addedAmountTiyin',
  'extensionApplied',
]);

function mergeProviderEventData(existing, event) {
  if (!isPlainObject(event)) throw new Error('providerData must be a plain object');
  if (Object.keys(event).some((key) => PROTECTED_PROVIDER_DATA_KEYS.has(key))) {
    throw new Error('Provider event cannot overwrite protected payment metadata');
  }
  return { ...(existing || {}), ...event };
}

function validateExtensionAccounting(payment) {
  if (payment.purpose !== 'consultation_extension') return null;
  const data = payment.providerData;
  if (!isPlainObject(data)) throw new Error('Extension payment metadata must be a plain object');
  const addedMinutes = Number(data.addedMinutes);
  const addedAmountTiyin = Number(data.addedAmountTiyin);
  const baseDuration = Number(data.baseDuration);
  const targetDuration = Number(data.targetDuration);
  const basePrice = Number(data.basePrice);
  const targetPrice = Number(data.targetPrice);
  if (![15, 30].includes(addedMinutes)
    || !Number.isSafeInteger(addedAmountTiyin) || addedAmountTiyin <= 0
    || addedAmountTiyin !== Number(payment.amountTiyin)
    || typeof data.extensionApplied !== 'boolean'
    || ![baseDuration, targetDuration, basePrice, targetPrice].every(Number.isSafeInteger)
    || targetDuration - baseDuration !== addedMinutes
    || (targetPrice - basePrice) * 100 !== addedAmountTiyin) {
    throw new Error('Extension payment delta metadata is invalid');
  }
  return { addedMinutes, addedAmountTiyin, extensionApplied: data.extensionApplied };
}

function exactTiyin(value, name = 'amountTiyin') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${name} must be a positive safe integer`);
  return amount;
}

function assertExactAmount(payment, amountTiyin) {
  const expected = exactTiyin(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
  if (exactTiyin(amountTiyin) !== expected) throw new Error('Provider amount does not match payment amount');
  return expected;
}

function assertProviderTransaction(payment, providerTransactionId) {
  const providerId = requiredString(providerTransactionId, 'providerTransactionId');
  if (payment.provider !== 'payme') throw new Error('Payment provider does not match Payme');
  if (payment.providerTransactionId && payment.providerTransactionId !== providerId) {
    throw new Error('Provider transaction does not match payment');
  }
  if (payment.transactionId && payment.transactionId !== providerId) {
    throw new Error('Legacy provider transaction does not match payment');
  }
  return providerId;
}

async function checkoutTerms({ userId, purpose, subjectId, plan, extensionMinutes, providerData, tx }) {
  if (purpose === 'subscription') {
    const subscription = await Subscription.findByPk(subjectId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!subscription || subscription.userId !== userId) throw new Error('Subscription subject not found');
    if (!Object.hasOwn(SUBSCRIPTION_PRICES, plan)) throw new Error('Unsupported subscription plan');
    return {
      amountTiyin: SUBSCRIPTION_PRICES[plan],
      fields: { subscriptionId: subscription.id, consultationId: null },
      providerData: { subscriptionPlan: plan },
    };
  }

  if (purpose === 'lawyer_promotion') {
    const promotion = await LawyerPromotion.findByPk(subjectId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!promotion || promotion.lawyerId !== userId) throw new Error('Promotion subject not found');
    if (promotion.status !== 'pending_payment') throw new Error('Promotion is not awaiting payment');
    return {
      amountTiyin: exactTiyin(promotion.priceAmountTiyin),
      fields: { lawyerPromotionId: promotion.id, consultationId: null, subscriptionId: null },
      providerData: { promotionPackageId: promotion.packageId },
    };
  }

  if (purpose === 'consultation') {
    const consultation = await Consultation.findByPk(subjectId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!consultation || consultation.clientId !== userId) throw new Error('Consultation subject not found');
    if (consultation.status !== 'payment_pending') throw new Error('Consultation is not awaiting payment');
    const amountTiyin = exactTiyin(Math.round(Number(consultation.price) * 100));
    await snapshotConsultationFinancials(consultation, amountTiyin, tx);
    return {
      amountTiyin,
      fields: { consultationId: consultation.id, subscriptionId: null },
      providerData: providerData || null,
    };
  }

  if (purpose === 'consultation_extension') {
    const consultation = await Consultation.findByPk(subjectId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!consultation || consultation.clientId !== userId) throw new Error('Consultation extension subject not found');
    if (consultation.status !== 'in_progress') throw new Error('Consultation is not in progress');
    const minutes = Number(extensionMinutes);
    if (![15, 30].includes(minutes)) throw new Error('Unsupported extension duration');
    const profile = await LawyerProfile.findOne({
      where: { userId: consultation.lawyerId }, lock: tx.LOCK.UPDATE, transaction: tx,
    });
    if (!profile) throw new Error('Lawyer profile not found');
    const addAmount = Math.round((Number(profile.price) * minutes) / 60);
    const amountTiyin = exactTiyin(addAmount * 100);
    const baseDuration = Number(consultation.duration || 60);
    const basePrice = Number(consultation.price || 0);
    return {
      amountTiyin,
      fields: { consultationId: consultation.id, subscriptionId: null },
      providerData: {
        extensionMinutes: minutes,
        addedMinutes: minutes,
        addedAmountTiyin: amountTiyin,
        extensionApplied: false,
        baseDuration,
        basePrice,
        targetDuration: baseDuration + minutes,
        targetPrice: basePrice + addAmount,
        consentUserIds: [],
      },
    };
  }

  throw new Error(`Checkout purpose ${purpose} is not available`);
}

function sameCheckout(payment, { purpose, subjectId, amountTiyin, providerData }) {
  const subjectMatches = purpose === 'subscription'
    ? payment.subscriptionId === subjectId && !payment.consultationId && !payment.lawyerPromotionId
    : purpose === 'lawyer_promotion'
      ? payment.lawyerPromotionId === subjectId && !payment.consultationId && !payment.subscriptionId
      : payment.consultationId === subjectId && !payment.subscriptionId && !payment.lawyerPromotionId;
  const metadataMatches = purpose === 'subscription'
    ? payment.providerData?.subscriptionPlan === providerData.subscriptionPlan
    : purpose === 'lawyer_promotion'
      ? payment.providerData?.promotionPackageId === providerData.promotionPackageId
    : purpose === 'consultation_extension'
      ? payment.providerData?.extensionMinutes === providerData.extensionMinutes
      : purpose !== 'consultation' || !providerData?.bookingFingerprint
        || payment.providerData?.bookingFingerprint === providerData.bookingFingerprint;
  return payment.purpose === purpose && subjectMatches
    && Number(payment.amountTiyin) === amountTiyin && metadataMatches;
}

function sameCheckoutRequest(payment, { purpose, subjectId, plan, extensionMinutes, providerData }) {
  const subjectMatches = purpose === 'subscription'
    ? payment.subscriptionId === subjectId && !payment.consultationId && !payment.lawyerPromotionId
    : purpose === 'lawyer_promotion'
      ? payment.lawyerPromotionId === subjectId && !payment.consultationId && !payment.subscriptionId
      : payment.consultationId === subjectId && !payment.subscriptionId && !payment.lawyerPromotionId;
  const metadataMatches = purpose === 'subscription'
    ? payment.providerData?.subscriptionPlan === plan
    : purpose === 'lawyer_promotion'
      ? !providerData?.promotionPackageId || payment.providerData?.promotionPackageId === providerData.promotionPackageId
    : purpose === 'consultation_extension'
      ? payment.providerData?.extensionMinutes === Number(extensionMinutes)
      : purpose !== 'consultation' || !providerData?.bookingFingerprint
        || payment.providerData?.bookingFingerprint === providerData.bookingFingerprint;
  return payment.purpose === purpose && subjectMatches && metadataMatches;
}

async function createCheckout({
  userId,
  purpose,
  subjectId,
  idempotencyKey,
  plan,
  extensionMinutes,
  providerData,
  transaction,
  checkoutUrlFactory = createCheckoutUrl,
}) {
  requiredString(userId, 'userId');
  requiredString(subjectId, 'subjectId');
  const rawKey = requiredString(idempotencyKey, 'idempotencyKey');
  const key = checkoutIdempotencyKey(purpose, rawKey);

  const createInTransaction = async (tx) => {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))', {
      replacements: { lockKey: `payment-checkout:${userId}:${key}` },
      transaction: tx,
    });
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))', {
      replacements: { lockKey: `payment-checkout-subject:${purpose}:${subjectId}` },
      transaction: tx,
    });
    const existing = await Payment.findOne({
      where: {
        userId,
        purpose,
        idempotencyKey: { [Op.in]: checkoutIdempotencyCandidates(purpose, rawKey) },
      },
      lock: tx.LOCK.UPDATE,
      transaction: tx,
    });
    if (existing && ['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(existing.status)) {
      if (!sameCheckoutRequest(existing, { purpose, subjectId, plan, extensionMinutes, providerData })) {
        throw new Error('Idempotency key was already used for a different checkout');
      }
      return { payment: existing, checkoutUrl: checkoutUrlFactory(existing) };
    }
    const terms = await checkoutTerms({ userId, purpose, subjectId, plan, extensionMinutes, providerData, tx });
    if (existing) {
      if (!sameCheckout(existing, { purpose, subjectId, ...terms })) {
        throw new Error('Idempotency key was already used for a different checkout');
      }
      if (existing.status === 'failed') {
        if (purpose === 'consultation_extension') {
          const error = new Error('Extension proposal is terminal; create a new proposal');
          error.status = 409;
          throw error;
        }
        await existing.update({
          status: 'pending',
          transactionId: null,
          providerTransactionId: null,
          providerResponse: {},
          providerData: terms.providerData,
          paidAt: null,
          cancelledAt: null,
          refundedAt: null,
          refundedAmountTiyin: 0,
        }, { transaction: tx });
      }
      return { payment: existing, checkoutUrl: checkoutUrlFactory(existing) };
    }
    const subjectWhere = purpose === 'subscription'
      ? { subscriptionId: subjectId }
      : purpose === 'lawyer_promotion'
        ? { lawyerPromotionId: subjectId }
        : { consultationId: subjectId };
    const activeStatuses = purpose === 'subscription'
      ? ['pending', 'processing']
      : purpose === 'consultation_extension'
        ? ['pending', 'processing', 'refund_pending', 'partially_refunded']
        : ['pending', 'processing', 'paid', 'refund_pending', 'partially_refunded'];
    const active = await Payment.findOne({
      where: {
        ...subjectWhere,
        purpose,
        status: { [Op.in]: activeStatuses },
      },
      lock: tx.LOCK.UPDATE,
      transaction: tx,
    });
    if (active) {
      const error = new Error('An active checkout already exists for this subject');
      error.status = 409;
      throw error;
    }
    const payment = await Payment.create({
      userId,
      purpose,
      ...terms.fields,
      amount: terms.amountTiyin / 100,
      amountTiyin: terms.amountTiyin,
      currency: 'UZS',
      provider: 'payme',
      status: 'pending',
      idempotencyKey: key,
      providerData: terms.providerData,
    }, { transaction: tx });
    return { payment, checkoutUrl: checkoutUrlFactory(payment) };
  };
  const result = transaction
    ? await createInTransaction(transaction)
    : await sequelize.transaction(createInTransaction);
  const { payment, checkoutUrl } = result;

  return {
    payment,
    paymentId: payment.id,
    checkoutUrl,
    amount: Number(payment.amount),
    amountTiyin: Number(payment.amountTiyin),
  };
}

async function activateTypedSubject(payment, tx, operationKey) {
  switch (payment.purpose) {
    case 'consultation': {
      const consultation = await Consultation.findByPk(payment.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
      if (!consultation) throw new Error('Consultation subject not found');
      if (consultation.status !== 'payment_pending') {
        throw new Error('Consultation is no longer awaiting payment');
      }
      await snapshotConsultationFinancials(consultation, Number(payment.amountTiyin), tx);
      const posting = await recordConsultationEscrow(payment, tx, { operationKey });
      await consultation.update({ status: 'pending' }, { transaction: tx });
      return { posting, notification: { userId: consultation.lawyerId, consultationId: consultation.id } };
    }
    case 'consultation_extension': {
      const consultation = await Consultation.findByPk(payment.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
      if (!consultation || consultation.status !== 'in_progress') {
        throw new Error('Consultation extension is no longer payable');
      }
      const data = payment.providerData || {};
      const accounting = validateExtensionAccounting(payment);
      const consents = new Set(Array.isArray(data.consentUserIds) ? data.consentUserIds : []);
      if (!consents.has(consultation.clientId) || !consents.has(consultation.lawyerId)) {
        throw new Error('Both consultation participants must consent to the extension');
      }
      if (accounting.extensionApplied) throw new Error('Consultation extension is already applied');
      const nextDuration = Number(consultation.duration || 60) + accounting.addedMinutes;
      const nextPrice = Number(consultation.price || 0) + (accounting.addedAmountTiyin / 100);
      if (!Number.isSafeInteger(nextDuration) || !Number.isSafeInteger(nextPrice)) {
        throw new Error('Consultation extension cumulative values are invalid');
      }
      const posting = await recordExtensionEscrow(payment, tx, { operationKey });
      await consultation.update({
        duration: nextDuration,
        price: nextPrice,
      }, { transaction: tx });
      await payment.update({
        providerData: { ...data, extensionApplied: true, extensionAppliedAt: new Date().toISOString() },
      }, { transaction: tx });
      return { posting };
    }
    case 'subscription':
      return { posting: await activateSubscriptionPayment(payment, tx, { operationKey }) };
    case 'lawyer_promotion':
      return { promotion: await require('./promotionService').activatePaidPromotion(payment.lawyerPromotionId, tx, new Date(), payment.id) };
    default:
      throw new Error('Payment purpose is not typed');
  }
}

async function rollbackExtensionActivation(payment, tx) {
  const row = await Payment.findByPk(payment.id, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!row) throw new Error('Extension payment not found');
  const accounting = validateExtensionAccounting(row);
  const consultation = await Consultation.findByPk(payment.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
  if (!consultation) throw new Error('Consultation extension subject not found');
  const data = row.providerData || {};
  if (!accounting.extensionApplied) return;
  const currentDuration = Number(consultation.duration || 60);
  const currentPrice = Number(consultation.price || 0);
  const addedPrice = accounting.addedAmountTiyin / 100;
  const nextDuration = currentDuration - accounting.addedMinutes;
  const nextPrice = currentPrice - addedPrice;
  if (consultation.status !== 'in_progress'
    || !Number.isSafeInteger(nextDuration) || nextDuration < 0
    || !Number.isSafeInteger(nextPrice) || nextPrice < 0) {
    throw new Error('Consultation extension delta refund requires operator repair');
  }
  await consultation.update({ duration: nextDuration, price: nextPrice }, { transaction: tx });
  await row.update({
    providerData: {
      ...data,
      extensionApplied: false,
      extensionRefundAppliedAt: new Date().toISOString(),
    },
  }, { transaction: tx });
}

async function lockExtensionRefundSubject(paymentId, tx) {
  const subject = await Payment.findByPk(paymentId, {
    attributes: ['id', 'purpose', 'consultationId'],
    transaction: tx,
  });
  if (subject?.purpose === 'consultation_extension' && subject.consultationId) {
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))', {
      replacements: { lockKey: `extension-refund:${subject.consultationId}` },
      transaction: tx,
    });
  }
}

async function markProviderCancelled({ paymentId, providerTransactionId, cancelTime = Date.now(), reason }) {
  requiredString(paymentId, 'paymentId');
  if (!Number.isSafeInteger(cancelTime) || cancelTime <= 0) throw new Error('cancelTime must be a positive safe integer');
  const payment = await sequelize.transaction(async (tx) => {
    await lockExtensionRefundSubject(paymentId, tx);
    const row = await Payment.findByPk(paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!row) throw new Error('Payment not found');
    const cancellationRequest = validateCancellationRequest(row.providerData);
    validateExtensionAccounting(row);
    const providerId = assertProviderTransaction(row, providerTransactionId);

    if (['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(row.status)) {
      if (row.purpose === 'consultation') await confirmConsultationRefund(row, tx);
      else if (row.purpose === 'consultation_extension') {
        await refundExtensionEscrow(row, tx);
        await rollbackExtensionActivation(row, tx);
      }
      else if (row.purpose === 'subscription') {
        await confirmSubscriptionRefund(row, Number(row.amountTiyin), tx);
      }
      else if (row.purpose === 'lawyer_promotion') {
        await require('./promotionService').confirmPromotionRefund(row.lawyerPromotionId, Number(row.amountTiyin), tx);
      }
      else throw new Error(`Confirmed refunds for ${row.purpose} are not implemented`);
      if (row.consultationId && row.purpose === 'consultation') {
        const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
        if (consultation) await consultation.update({ status: 'cancelled' }, { transaction: tx });
      }
      await row.reload({ transaction: tx, lock: tx.LOCK.UPDATE });
      await row.update({
        providerData: {
          ...(row.providerData || {}),
          cancelTime,
          reason,
          refundProviderTransactionId: providerId,
          ...(cancellationRequest ? {
            cancellationRequest: { ...cancellationRequest, state: 'provider_cancelled' },
          } : {}),
        },
      }, { transaction: tx });
      return { payment: row, providerState: -2, cancelTime };
    }

    if (row.status === 'failed') return { payment: row, providerState: -1, cancelTime: row.providerData?.cancelTime || cancelTime };
    if (!['pending', 'processing'].includes(row.status)) {
      throw new Error(`Payment state ${row.status} cannot be cancelled`);
    }

    if (row.consultationId && row.purpose === 'consultation') {
      const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
      if (!consultation) throw new Error('Consultation subject not found');
      if (!['payment_pending', 'cancelled'].includes(consultation.status)) {
        throw new Error(`Consultation state ${consultation.status} cannot be cancelled before payment`);
      }
      if (consultation.status !== 'cancelled') {
        await consultation.update({ status: 'cancelled' }, { transaction: tx });
      }
    }
    await row.update({
      status: 'failed',
      cancelledAt: new Date(cancelTime),
      providerData: {
        ...(row.providerData || {}),
        cancelTime,
        reason,
        ...(cancellationRequest ? {
          cancellationRequest: { ...cancellationRequest, state: 'provider_cancelled' },
        } : {}),
      },
    }, { transaction: tx });
    return { payment: row, providerState: -1, cancelTime };
  });
  return payment;
}

async function requestPaymentCancellation({
  paymentId,
  requestedBy,
  reason,
  transaction,
  now = new Date(),
}) {
  requiredString(paymentId, 'paymentId');
  const actorId = requiredString(requestedBy, 'requestedBy');
  const cancellationReason = requiredString(reason, 'reason');
  const requestedAt = exactNow(now);
  const run = async (tx) => {
    const row = await Payment.findByPk(paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!row) throw new Error('Payment not found');
    validateCancellationRequest(row.providerData);
    let consultation = null;
    if (row.consultationId) {
      consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
      if (!consultation) throw new Error('Consultation subject not found');
      if (![consultation.clientId, consultation.lawyerId].includes(actorId)) throw new Error('Access denied');
      if (row.purpose === 'consultation' && ['payment_pending', 'pending', 'accepted'].includes(consultation.status)) {
        await consultation.update({ status: 'cancelled' }, { transaction: tx });
      }
    }
    const baseRequest = {
      requestedAt: requestedAt.toISOString(),
      requestedBy: actorId,
      reason: cancellationReason,
    };
    if (row.status === 'pending' && !row.providerTransactionId && !row.transactionId) {
      await row.update({
        status: 'failed',
        cancelledAt: requestedAt,
        providerData: {
          ...(row.providerData || {}),
          ...(row.purpose === 'consultation_extension' ? {
            proposalState: 'cancelled',
            proposalCancelledAt: requestedAt.toISOString(),
            proposalCancelledBy: actorId,
          } : {}),
          cancellationRequest: { ...baseRequest, state: 'cancelled_locally' },
        },
      }, { transaction: tx });
      return { payment: row, consultation, outcome: 'cancelled' };
    }
    if (['pending', 'processing'].includes(row.status)) {
      await row.update({
        providerData: {
          ...(row.providerData || {}),
          ...(row.purpose === 'consultation_extension' ? { proposalState: 'cancellation_requested' } : {}),
          cancellationRequest: { ...baseRequest, state: 'requested' },
        },
      }, { transaction: tx });
      return { payment: row, consultation, outcome: 'cancellation_requested' };
    }
    if (row.status === 'paid') {
      await row.update({
        providerData: {
          ...(row.providerData || {}),
          cancellationRequest: { ...baseRequest, state: 'requested' },
        },
      }, { transaction: tx });
      await requestConsultationRefund(row, tx);
      return { payment: row, consultation, outcome: 'cancellation_requested' };
    }
    if (['refund_pending', 'refunded', 'failed'].includes(row.status)) {
      return { payment: row, consultation, outcome: row.status === 'failed' ? 'cancelled' : 'cancellation_requested' };
    }
    throw new Error(`Payment state ${row.status} cannot request cancellation`);
  };
  return transaction ? run(transaction) : sequelize.transaction(run);
}

function exactNow(value = new Date()) {
  const now = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(now.getTime())) throw new Error('Valid proposal time is required');
  return now;
}

function proposalConsentComplete(payment, consultation) {
  const consents = new Set(Array.isArray(payment.providerData?.consentUserIds)
    ? payment.providerData.consentUserIds : []);
  return consents.has(consultation.clientId) && consents.has(consultation.lawyerId);
}

function serializeExtensionProposal(payment, consultation, actorId) {
  if (!payment) return null;
  const consentComplete = proposalConsentComplete(payment, consultation);
  const clientCanCheckout = actorId === consultation.clientId
    && payment.status === 'pending' && consentComplete;
  return {
    proposalId: payment.providerData?.proposalId || payment.idempotencyKey,
    paymentId: payment.id,
    status: payment.status,
    minutes: Number(payment.providerData?.extensionMinutes),
    amount: Number(payment.amount),
    amountTiyin: Number(payment.amountTiyin),
    proposalCreatedAt: payment.providerData?.proposalCreatedAt || null,
    expiresAt: payment.providerData?.expiresAt || null,
    consentUserIds: Array.isArray(payment.providerData?.consentUserIds)
      ? payment.providerData.consentUserIds : [],
    consentPending: !consentComplete,
    requiresPayment: clientCanCheckout,
    checkoutUrl: clientCanCheckout ? createCheckoutUrl(payment) : null,
    duration: consultation.duration,
    price: consultation.price,
  };
}

async function activeExtensionPayment(consultationId, tx) {
  return Payment.findOne({
    where: {
      consultationId,
      purpose: 'consultation_extension',
      status: { [Op.in]: ['pending', 'processing'] },
    },
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    lock: tx.LOCK.UPDATE,
    transaction: tx,
  });
}

async function expirePendingExtension(payment, now, tx) {
  if (!payment || payment.status !== 'pending') return false;
  const expiresAt = new Date(payment.providerData?.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || now.getTime() < expiresAt.getTime()) return false;
  await payment.update({
    status: 'failed',
    cancelledAt: now,
    providerData: {
      ...(payment.providerData || {}),
      proposalState: 'expired',
      expiredAt: now.toISOString(),
    },
  }, { transaction: tx });
  return true;
}

async function getExtensionProposalState({ actorId, consultationId, now = new Date() }) {
  requiredString(actorId, 'actorId');
  requiredString(consultationId, 'consultationId');
  const checkedAt = exactNow(now);
  return sequelize.transaction(async (tx) => {
    const consultation = await Consultation.findByPk(consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!consultation) {
      const error = new Error('Consultation not found'); error.status = 404; throw error;
    }
    if (![consultation.clientId, consultation.lawyerId].includes(actorId)) {
      const error = new Error('Access denied'); error.status = 403; throw error;
    }
    const payment = await activeExtensionPayment(consultation.id, tx);
    if (!payment || await expirePendingExtension(payment, checkedAt, tx)) return { proposal: null };
    return { proposal: serializeExtensionProposal(payment, consultation, actorId) };
  });
}

async function consentToExtensionCheckout({ actorId, consultationId, minutes, idempotencyKey, now = new Date() }) {
  requiredString(actorId, 'actorId');
  requiredString(consultationId, 'consultationId');
  const key = requiredString(idempotencyKey, 'idempotencyKey');
  const extensionMinutes = Number(minutes);
  if (![15, 30].includes(extensionMinutes)) throw new Error('Unsupported extension duration');
  const checkedAt = exactNow(now);

  return sequelize.transaction(async (tx) => {
    const consultation = await Consultation.findByPk(consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!consultation) throw new Error('Consultation not found');
    if (![consultation.clientId, consultation.lawyerId].includes(actorId)) throw new Error('Access denied');
    if (consultation.status !== 'in_progress') throw new Error('Consultation is not in progress');

    const current = await activeExtensionPayment(consultation.id, tx);
    if (current) {
      const expired = await expirePendingExtension(current, checkedAt, tx);
      if (!expired) {
        if ((current.providerData?.proposalId || current.idempotencyKey) !== key
          || Number(current.providerData?.extensionMinutes) !== extensionMinutes) {
          const error = new Error('A different active extension proposal already exists');
          error.status = 409;
          throw error;
        }
      }
    }

    const checkout = await createCheckout({
      userId: consultation.clientId,
      purpose: 'consultation_extension',
      subjectId: consultation.id,
      idempotencyKey: key,
      extensionMinutes,
      transaction: tx,
    });
    const payment = await Payment.findByPk(checkout.payment.id, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!['pending', 'processing'].includes(payment.status)) {
      throw new Error(`Payment state ${payment.status} cannot collect extension consent`);
    }
    if (payment.providerData?.proposalId
      && (payment.providerData.proposalId !== key
        || Number(payment.providerData.extensionMinutes) !== extensionMinutes)) {
      const error = new Error('Idempotency key was already used for different extension terms');
      error.status = 409;
      throw error;
    }
    const consents = [...new Set([...(payment.providerData?.consentUserIds || []), actorId])];
    const proposalCreatedAt = payment.providerData?.proposalCreatedAt || checkedAt.toISOString();
    await payment.update({
      providerData: {
        ...(payment.providerData || {}),
        proposalId: key,
        proposalCreatedAt,
        expiresAt: payment.providerData?.expiresAt
          || new Date(new Date(proposalCreatedAt).getTime() + EXTENSION_PROPOSAL_TTL_MS).toISOString(),
        proposalState: payment.status,
        consentUserIds: consents,
      },
    }, { transaction: tx });
    const consentComplete = consents.includes(consultation.clientId) && consents.includes(consultation.lawyerId);
    return {
      checkout,
      payment,
      consultation,
      consentComplete,
      proposal: serializeExtensionProposal(payment, consultation, actorId),
    };
  });
}

async function cancelExtensionProposal({ actorId, consultationId, proposalId, now = new Date() }) {
  requiredString(actorId, 'actorId');
  requiredString(consultationId, 'consultationId');
  const id = requiredString(proposalId, 'proposalId');
  const cancelledAt = exactNow(now);
  const prepared = await sequelize.transaction(async (tx) => {
    const consultation = await Consultation.findByPk(consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!consultation) {
      const error = new Error('Consultation not found'); error.status = 404; throw error;
    }
    if (![consultation.clientId, consultation.lawyerId].includes(actorId)) {
      const error = new Error('Access denied'); error.status = 403; throw error;
    }
    const candidates = await Payment.findAll({
      where: { consultationId, purpose: 'consultation_extension' },
      order: [['createdAt', 'DESC']],
      lock: tx.LOCK.UPDATE,
      transaction: tx,
    });
    const payment = candidates.find((row) => (row.providerData?.proposalId || row.idempotencyKey) === id);
    if (!payment) {
      const error = new Error('Extension proposal not found'); error.status = 404; throw error;
    }
    if (payment.status === 'failed') return { payment, alreadyTerminal: true };
    if (['pending', 'processing'].includes(payment.status)) return { payment };
    const error = new Error(`Extension proposal state ${payment.status} cannot be cancelled`);
    error.status = 409;
    throw error;
  });

  if (prepared.alreadyTerminal) return { payment: prepared.payment, cancelled: false, outcome: 'cancelled' };
  const result = await requestPaymentCancellation({
    paymentId: prepared.payment.id,
    requestedBy: actorId,
    reason: 'extension_participant_cancelled',
    now: cancelledAt,
  });
  return { payment: result.payment, cancelled: result.outcome === 'cancelled', outcome: result.outcome };
}

async function markPaymentProcessing({ paymentId, providerTransactionId, amountTiyin, providerData = {} }) {
  requiredString(paymentId, 'paymentId');
  if (!providerData || typeof providerData !== 'object' || Array.isArray(providerData)) {
    throw new Error('providerData must be an object');
  }
  const payment = await sequelize.transaction(async (tx) => {
    const row = await Payment.findByPk(paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!row) throw new Error('Payment not found');
    validateCancellationRequest(row.providerData);
    validateExtensionAccounting(row);
    assertExactAmount(row, amountTiyin);
    const providerId = assertProviderTransaction(row, providerTransactionId);
    if (!['pending', 'processing'].includes(row.status)) {
      throw new Error(`Payment state ${row.status} cannot become processing`);
    }
    const collision = await Payment.findOne({
      where: {
        provider: row.provider,
        providerTransactionId: providerId,
        id: { [Op.ne]: row.id },
      },
      transaction: tx,
    });
    if (collision) throw new Error('Provider transaction is already bound to another payment');
    if (row.status === 'processing') return row;
    await row.update({
      status: 'processing',
      transactionId: providerId,
      providerTransactionId: providerId,
      providerData: mergeProviderEventData(row.providerData, providerData),
    }, { transaction: tx });
    return row;
  });
  return { payment };
}

async function markPaymentPaid({ paymentId, providerTransactionId, amountTiyin, providerData = {} }) {
  requiredString(paymentId, 'paymentId');
  if (!providerData || typeof providerData !== 'object' || Array.isArray(providerData)) {
    throw new Error('providerData must be an object');
  }
  let transitioned = false;
  let notification = null;
  const payment = await sequelize.transaction(async (tx) => {
    const row = await Payment.findByPk(paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!row) throw new Error('Payment not found');
    const cancellationRequest = validateCancellationRequest(row.providerData);
    validateExtensionAccounting(row);
    const exactAmount = assertExactAmount(row, amountTiyin);
    const providerId = assertProviderTransaction(row, providerTransactionId);
    const collision = await Payment.findOne({
      where: {
        provider: row.provider,
        providerTransactionId: providerId,
        id: { [Op.ne]: row.id },
      },
      transaction: tx,
    });
    if (collision) throw new Error('Provider transaction is already bound to another payment');
    if (row.status === 'paid') {
      if (row.purpose === 'consultation') {
        const consultation = await Consultation.findByPk(row.consultationId, { transaction: tx });
        if (consultation) notification = { userId: consultation.lawyerId, consultationId: consultation.id };
      }
      return row;
    }
    if (!['pending', 'processing'].includes(row.status)) throw new Error(`Payment state ${row.status} cannot become paid`);

    await row.update({
      status: 'paid',
      amountTiyin: exactAmount,
      transactionId: row.transactionId || providerId,
      providerTransactionId: providerId,
      paidAt: row.paidAt || new Date(),
      providerData: mergeProviderEventData(row.providerData, providerData),
    }, { transaction: tx });
    if (cancellationRequest?.state === 'requested'
      && ['consultation', 'consultation_extension'].includes(row.purpose)) {
      let posting;
      if (row.purpose === 'consultation') {
        const consultation = await Consultation.findByPk(row.consultationId, { lock: tx.LOCK.UPDATE, transaction: tx });
        if (!consultation) throw new Error('Consultation subject not found');
        await snapshotConsultationFinancials(consultation, Number(row.amountTiyin), tx);
        posting = await recordConsultationEscrow(row, tx, { operationKey: `payme:paid:${providerId}` });
      } else {
        posting = await recordExtensionEscrow(row, tx, { operationKey: `payme:paid:${providerId}` });
      }
      await requestConsultationRefund(row, tx);
      transitioned = true;
      return row;
    }
    const activated = await activateTypedSubject(row, tx, `payme:paid:${providerId}`);
    notification = activated.notification || null;
    transitioned = true;
    return row;
  });

  if (notification) {
    await notificationService.createNotification(
      notification.userId,
      'new_booking',
      'Новая консультация',
      'Клиент оплатил консультацию. Подтвердите или отклоните.',
      { consultationId: notification.consultationId },
      { dedupeKey: `payment:paid:${payment.id}:lawyer`, throwOnError: true }
    );
  }
  return { payment, transitioned };
}

async function markProviderRefunded({ paymentId, amountTiyin, providerTransactionId }) {
  requiredString(paymentId, 'paymentId');
  const payment = await sequelize.transaction(async (tx) => {
    await lockExtensionRefundSubject(paymentId, tx);
    const row = await Payment.findByPk(paymentId, { lock: tx.LOCK.UPDATE, transaction: tx });
    if (!row) throw new Error('Payment not found');
    validateCancellationRequest(row.providerData);
    validateExtensionAccounting(row);
    const refundAmount = ['subscription', 'lawyer_promotion'].includes(row.purpose)
      ? exactTiyin(amountTiyin, 'refund amountTiyin')
      : assertExactAmount(row, amountTiyin);
    const providerId = assertProviderTransaction(row, providerTransactionId);
    if (!['paid', 'refund_pending', 'partially_refunded', 'refunded'].includes(row.status)) {
      throw new Error(`Payment state ${row.status} cannot be provider-refunded`);
    }
    if (row.purpose === 'consultation') await confirmConsultationRefund(row, tx);
    else if (row.purpose === 'consultation_extension') {
      await refundExtensionEscrow(row, tx);
      await rollbackExtensionActivation(row, tx);
    }
    else if (row.purpose === 'subscription') await confirmSubscriptionRefund(row, refundAmount, tx);
    else if (row.purpose === 'lawyer_promotion') {
      await require('./promotionService').confirmPromotionRefund(row.lawyerPromotionId, refundAmount, tx);
    }
    else throw new Error(`Confirmed refunds for ${row.purpose} are not implemented`);
    await row.update({
      providerData: {
        ...(row.providerData || {}),
        refundProviderTransactionId: providerId,
        refundConfirmedAt: row.providerData?.refundConfirmedAt || new Date().toISOString(),
      },
    }, { transaction: tx });
    return row;
  });
  return { payment };
}

module.exports = {
  SUBSCRIPTION_PRICES,
  EXTENSION_PROPOSAL_TTL_MS,
  cancelExtensionProposal,
  checkoutIdempotencyCandidates,
  checkoutIdempotencyKey,
  consentToExtensionCheckout,
  createCheckout,
  getExtensionProposalState,
  markProviderCancelled,
  markPaymentProcessing,
  markPaymentPaid,
  markProviderRefunded,
  requestPaymentCancellation,
};
