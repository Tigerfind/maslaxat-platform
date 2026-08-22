const { Op } = require('sequelize');
const { sequelize, Consultation, Payment, Promo } = require('../models');
const { PAYMENT_RESERVATION_MINUTES, isPaymentReservationExpired, lockBookingParticipants } = require('./availabilityService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

async function expireReservationById(consultationId, now = new Date()) {
  const initial = await Consultation.findByPk(consultationId, { attributes: ['id', 'clientId', 'lawyerId'] });
  if (!initial) return null;
  const expired = await sequelize.transaction(async (transaction) => {
    await lockBookingParticipants(initial.lawyerId, initial.clientId, transaction);
    const consultation = await Consultation.findByPk(consultationId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!consultation || !isPaymentReservationExpired(consultation, now)) return null;
    const payments = await Payment.findAll({ where: { consultationId, status: 'pending' }, transaction, lock: transaction.LOCK.UPDATE });
    for (const payment of payments) {
      await payment.update({
        status: 'failed',
        providerResponse: { ...(payment.providerResponse || {}), cancelTime: now.getTime(), reason: 'reservation_expired' },
      }, { transaction });
    }
    await consultation.update({ status: 'cancelled', notes: 'Время резервирования оплаты истекло' }, { transaction });
    if (consultation.promoCode) {
      await Promo.increment('usedCount', { by: -1, where: { code: consultation.promoCode, usedCount: { [Op.gt]: 0 } }, transaction });
    }
    return { id: consultation.id, clientId: consultation.clientId, lawyerId: consultation.lawyerId };
  });
  if (!expired) return null;
  await Promise.all([
    notificationService.createNotification(expired.clientId, 'payment_expired', 'Время оплаты истекло', 'Бронь отменена. Выберите свободное время и запишитесь снова.', { consultationId }),
    notificationService.createNotification(expired.lawyerId, 'payment_expired', 'Неоплаченная бронь отменена', 'Слот снова доступен для записи.', { consultationId }),
  ]);
  return expired;
}

async function expireDueReservations(now = new Date()) {
  const cutoff = new Date(now.getTime() - PAYMENT_RESERVATION_MINUTES * 60000);
  const rows = await Consultation.findAll({
    where: { status: 'payment_pending', createdAt: { [Op.lte]: cutoff } },
    attributes: ['id'], order: [['createdAt', 'ASC']], limit: 100,
  });
  let count = 0;
  for (const row of rows) {
    try { if (await expireReservationById(row.id, now)) count += 1; }
    catch (error) { logger.error('Reservation expiry failed', { consultationId: row.id, error: error.message }); }
  }
  return count;
}

function startReservationExpiryJob() {
  const timer = setInterval(() => expireDueReservations().catch((error) => logger.error('Reservation expiry job failed', { error: error.message })), 60 * 1000);
  timer.unref?.();
  setTimeout(() => expireDueReservations().catch(() => {}), 10 * 1000).unref?.();
  logger.info('[ReservationExpiry] Job started (every 1 min)');
}

module.exports = { expireReservationById, expireDueReservations, startReservationExpiryJob };
