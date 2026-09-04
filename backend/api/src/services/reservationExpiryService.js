const { Op } = require('sequelize');
const { sequelize, Consultation, Payment, Promo } = require('../models');
const { PAYMENT_RESERVATION_MINUTES, isPaymentReservationExpired, lockBookingParticipants } = require('./availabilityService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

const expiryReason = 'Время резервирования оплаты истекло';

async function expireLockedReservation(consultation, transaction, now = new Date()) {
  if (!consultation || !isPaymentReservationExpired(consultation, now)) return null;
  const payments = await Payment.findAll({ where: { consultationId: consultation.id, status: 'pending' }, transaction, lock: transaction.LOCK.UPDATE });
  for (const payment of payments) {
    await payment.update({
      status: 'failed',
      providerResponse: { ...(payment.providerResponse || {}), cancelTime: now.getTime(), reason: 'reservation_expired' },
    }, { transaction });
  }
  await consultation.update({
    status: 'payment_expired', lifecycleStatus: 'cancelled', cancelledAt: now,
    cancelledBy: 'system', cancellationType: 'payment_expired', cancellationReason: expiryReason,
  }, { transaction });
  if (consultation.promoCode && consultation.promoReservedAt) {
    await Promo.increment('usedCount', { by: -1, where: { code: consultation.promoCode, usedCount: { [Op.gt]: 0 } }, transaction });
    consultation.promoReservedAt = null;
    await consultation.save({ fields: ['promoReservedAt'], transaction });
  }
  const result = { id: consultation.id, clientId: consultation.clientId, lawyerId: consultation.lawyerId };
  transaction.afterCommit(() => notifyExpired(result).catch((error) => logger.error('Reservation expiry notification failed', { consultationId: consultation.id, error: error.message })));
  return result;
}

async function notifyExpired(expired) {
  await Promise.all([
    notificationService.createNotification(expired.clientId, 'payment_expired', 'Время оплаты истекло', 'Бронь отменена. Выберите свободное время и запишитесь снова.', { consultationId: expired.id }),
    notificationService.createNotification(expired.lawyerId, 'payment_expired', 'Неоплаченная бронь отменена', 'Слот снова доступен для записи.', { consultationId: expired.id }),
  ]);
}

async function expireReservationById(consultationId, now = new Date()) {
  const initial = await Consultation.findByPk(consultationId, { attributes: ['id', 'clientId', 'lawyerId'] });
  if (!initial) return null;
  const expired = await sequelize.transaction(async (transaction) => {
    await lockBookingParticipants(initial.lawyerId, initial.clientId, transaction);
    const consultation = await Consultation.findByPk(consultationId, { transaction, lock: transaction.LOCK.UPDATE });
    return expireLockedReservation(consultation, transaction, now);
  });
  return expired;
}

async function expireDueReservations(now = new Date(), scope = {}, limit = 100) {
  const cutoff = new Date(now.getTime() - PAYMENT_RESERVATION_MINUTES * 60000);
  let count = 0;
  const scopedWhere = {};
  if (scope.clientId) scopedWhere.clientId = scope.clientId;
  if (scope.lawyerId) scopedWhere.lawyerId = scope.lawyerId;
  const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = await Consultation.findAll({
    where: {
      ...scopedWhere,
      status: 'payment_pending',
      [Op.or]: [
        { paymentExpiresAt: { [Op.lte]: now } },
        { paymentExpiresAt: null, createdAt: { [Op.lte]: cutoff } },
      ],
    },
    attributes: ['id'], order: [['createdAt', 'ASC']], limit: boundedLimit,
  });
  for (const row of rows) {
    try { if (await expireReservationById(row.id, now)) count += 1; }
    catch (error) { logger.error('Reservation expiry failed', { consultationId: row.id, error: error.message }); }
  }
  return count;
}

function unexpiredReservationWhere(now = new Date()) {
  const cutoff = new Date(now.getTime() - PAYMENT_RESERVATION_MINUTES * 60000);
  return {
    [Op.or]: [
      { status: { [Op.ne]: 'payment_pending' } },
      { status: 'payment_pending', paymentExpiresAt: { [Op.gt]: now } },
      { status: 'payment_pending', paymentExpiresAt: null, createdAt: { [Op.gt]: cutoff } },
    ],
  };
}

function startReservationExpiryJob() {
  const timer = setInterval(() => expireDueReservations().catch((error) => logger.error('Reservation expiry job failed', { error: error.message })), 60 * 1000);
  timer.unref?.();
  setTimeout(() => expireDueReservations().catch(() => {}), 10 * 1000).unref?.();
  logger.info('[ReservationExpiry] Job started (every 1 min)');
}

module.exports = { expireLockedReservation, expireReservationById, expireDueReservations, unexpiredReservationWhere, startReservationExpiryJob };
