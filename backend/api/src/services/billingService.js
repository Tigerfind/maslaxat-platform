// Биллинг «оплата через 5 минут звонка» (модель B: холд при брони → захват на 5-й минуте).
//
// Деньги списываются ТОЛЬКО когда юрист и клиент реально созвонились и разговор длится
// 5 минут. Не состоялось (вышли раньше) — захвата нет, клиент платит 0.
//
// РЕАЛЬНОЕ списание с карты требует Payme (токенизация + capture). Пока интеграции нет:
//  • dev/test (нет NODE_ENV=production и нет PAYME_KEY) — СИМУЛЯЦИЯ: создаём оплаченный
//    Payment на цену + резервируем эскроу (pendingBalance). Так проверяется вся логика.
//  • прод без ключей — FAIL-CLOSED: деньги НЕ фабрикуем, помечаем billingStatus='failed'
//    и логируем; юрист/админ решает вручную.
//  • с ключами Payme — здесь подключится реальный capture (TODO, см. captureViaProvider).
const { Op } = require('sequelize');
const { Consultation, Payment, LawyerProfile } = require('../models');
const logger = require('../config/logger');
const notificationService = require('./notificationService');

const CAPTURE_AFTER_MS = 5 * 60 * 1000; // 5 минут разговора до захвата

// Можно ли симулировать захват (без реального провайдера)? Только вне прода и без ключей.
function canSimulate() {
  return process.env.NODE_ENV !== 'production' && !process.env.PAYME_KEY;
}

// Реальный захват через Payme — подключится, когда будут ключи и токен карты.
// Сейчас не реализован: возвращает false (в проде → fail-closed).
async function captureViaProvider(/* consultation */) {
  return false;
}

/**
 * Идемпотентный захват оплаты на 5-й минуте разговора.
 * @returns {Promise<{captured:boolean, reason:string}>}
 */
async function captureHold(consultationId) {
  let notify = null;
  const result = await Consultation.sequelize.transaction(async (t) => {
    const c = await Consultation.findByPk(consultationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!c) return { captured: false, reason: 'not_found' };
    if (c.isFree) {
      if (c.billingStatus !== 'none') await c.update({ billingStatus: 'none' }, { transaction: t });
      return { captured: false, reason: 'free' };
    }
    if (['charged', 'released'].includes(c.billingStatus)) return { captured: false, reason: 'already' };
    const existingPaid = await Payment.findOne({ where: { consultationId, status: 'paid' }, transaction: t, lock: t.LOCK.UPDATE });
    if (existingPaid) {
      await c.update({ billingStatus: 'charged', chargedAt: c.chargedAt || new Date() }, { transaction: t });
      return { captured: true, reason: 'already_paid' };
    }
    const amount = Number(c.price) || 0;
    if (amount <= 0) {
      await c.update({ billingStatus: 'none' }, { transaction: t });
      return { captured: false, reason: 'zero' };
    }
    if (process.env.PAYME_KEY) {
      const ok = await captureViaProvider(c);
      if (!ok) {
        await c.update({ billingStatus: 'failed' }, { transaction: t });
        notify = { c, amount };
        return { captured: false, reason: 'provider_unavailable' };
      }
    } else if (!canSimulate()) {
      await c.update({ billingStatus: 'failed' }, { transaction: t });
      notify = { c, amount };
      return { captured: false, reason: 'no_provider' };
    }
    await Payment.create({
      consultationId, userId: c.clientId, amount, currency: 'UZS', provider: 'payme',
      status: 'paid', escrowReleased: false,
      providerResponse: { simulated: true, model: 'hold-5min', capturedAt: Date.now() },
    }, { transaction: t });
    const lp = await LawyerProfile.findOne({ where: { userId: c.lawyerId }, transaction: t, lock: t.LOCK.UPDATE });
    if (lp) await lp.increment('pendingBalance', { by: amount, transaction: t });
    await c.update({ billingStatus: 'charged', chargedAt: new Date() }, { transaction: t });
    return { captured: true, reason: 'captured', clientId: c.clientId, amount };
  }).catch((error) => {
    logger.error('[Billing] capture failed:', error.message);
    return { captured: false, reason: 'error' };
  });

  if (notify) {
    logger.warn(`[Billing] provider capture unavailable consultation=${consultationId}`);
    await notifyFailure(notify.c, notify.amount);
  }

  if (result.captured && result.reason === 'captured') try {
    await notificationService.createNotification(
      result.clientId, 'payment_charged', 'Оплата списана',
      `Списано ${result.amount.toLocaleString()} сум за консультацию.`, { consultationId },
    );
  } catch (e) { /* best-effort */ }
  return result;
}

async function notifyFailure(c, amount) {
  try {
    await notificationService.createNotification(
      c.lawyerId, 'payment_failed', 'Оплата не прошла',
      `Не удалось списать ${Number(amount).toLocaleString()} сум с карты клиента. Свяжитесь с поддержкой.`,
      { consultationId: c.id },
    );
  } catch (e) { /* best-effort */ }
}

// ─── Фоновый джоб: захват оплаты через 5 минут разговора ───
// Сканирует консультации in_progress с billingStatus='held', у которых оба в звонке
// (callStartedAt) уже ≥5 минут, и захватывает оплату. captureHold идемпотентен —
// параллельные прогоны/повторы не двоят. Ранний выход обнуляет callStartedAt (см.
// signaling.billingOnLeave), поэтому такие сюда не попадают.
async function checkCaptureDue() {
  try {
    const cutoff = new Date(Date.now() - CAPTURE_AFTER_MS);
    const due = await Consultation.findAll({
      where: {
        status: 'in_progress',
        billingStatus: 'held',
        callStartedAt: { [Op.ne]: null, [Op.lte]: cutoff },
      },
      attributes: ['id'],
    });
    for (const c of due) {
      try { await captureHold(c.id); }
      catch (e) { logger.error('[Billing] capture item error:', e.message); }
    }
  } catch (e) {
    logger.error('[Billing] capture job error:', e.message);
  }
}

function startBillingJob() {
  const INTERVAL = 60 * 1000; // раз в минуту
  setInterval(checkCaptureDue, INTERVAL);
  setTimeout(checkCaptureDue, 20 * 1000); // первый прогон ~20с после старта
  logger.info('[Billing] Capture job started (every 1 min, 5-min hold)');
}

module.exports = { captureHold, checkCaptureDue, startBillingJob, canSimulate, CAPTURE_AFTER_MS };
