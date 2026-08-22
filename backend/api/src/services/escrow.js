const { Op } = require('sequelize');
const { Consultation, Payment, LawyerProfile, FinancialEvent } = require('../models');

/**
 * Идемпотентное завершение консультации + высвобождение эскроу.
 *
 * ВЫСВОБОЖДЕНИЕ ПРИВЯЗАНО К ПЛАТЕЖУ, НЕ К СТАТУСУ. Каждый вызов атомарно «забирает»
 * только ещё не высвобожденные оплаченные платежи (status='paid', escrowReleased=false),
 * помечая их escrowReleased=true, и выплачивает СУММУ ИМЕННО ЭТИХ строк. Поэтому:
 *   • выплата происходит РОВНО ОДИН РАЗ на платёж, кто бы ни завершил консультацию;
 *   • откат статуса из completed и повторное завершение НЕ выплачивают снова —
 *     платёж уже escrowReleased=true, вторая попытка заберёт 0 строк.
 * Раньше сумма пересчитывалась из всех paid-платежей по статусу консультации, и
 * откат статуса позволял выплатить повторно.
 *
 * Все денежные движения (пометка платежа + pendingBalance→balance) — в ОДНОЙ
 * транзакции, чтобы сбой не оставил рассинхрон балансов.
 *
 * @returns {Promise<{consultation, released:boolean, alreadyCompleted:boolean}>}
 */
async function completeConsultation(consultationId, notes, actualDuration) {
  return Consultation.sequelize.transaction(async (t) => {
    const current = await Consultation.findByPk(consultationId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!current) return { consultation: null, released: false, alreadyCompleted: true };
    if (current.status === 'completed') {
      return { consultation: current, released: false, alreadyCompleted: true };
    }
    // Никогда не воскрешаем cancelled/rejected/payment_pending и не платим за них.
    if (!['accepted', 'in_progress'].includes(current.status)) {
      return { consultation: current, released: false, alreadyCompleted: false };
    }

    // Платная услуга не может стать completed без реально подтверждённого платежа:
    // иначе юрист получает завершённое дело, а платформа теряет выручку.
    if (!current.isFree) {
      const paidCount = await Payment.count({
        where: { consultationId, status: 'paid', refundStatus: 'none' }, transaction: t,
      });
      if (paidCount === 0) throw Object.assign(new Error('Оплата консультации не подтверждена'), { status: 409, code: 'PAYMENT_REQUIRED' });
    }

    const patch = { status: 'completed' };
    if (notes) patch.notes = notes;
    // Фактическая длительность звонка (сек) — только если валидная и положительная
    if (Number.isFinite(actualDuration) && actualDuration > 0) {
      patch.actualDuration = Math.round(actualDuration);
    }

    // Атомарный переход в completed (только если ещё НЕ completed). Служит гейтом
    // для «первого завершения» (completedCases), но БОЛЬШЕ не гейтит выплату.
    const [statusAffected] = await Consultation.update(patch, {
      where: { id: consultationId, status: { [Op.in]: ['accepted', 'in_progress'] } },
      transaction: t,
    });

    const consultation = await Consultation.findByPk(consultationId, { transaction: t });
    if (!consultation) {
      return { consultation: null, released: false, alreadyCompleted: true };
    }

    // Атомарно забираем не высвобожденные оплаченные платежи. returning:true (Postgres)
    // отдаёт именно перехваченные строки — их сумму и выплачиваем. Конкурентный вызов
    // на тех же строках дождётся коммита и перечитает WHERE → escrowReleased уже true.
    const [, releasedPayments] = await Payment.update(
      { escrowReleased: true },
      {
        where: { consultationId, status: 'paid', escrowReleased: false, refundStatus: 'none' },
        returning: true,
        transaction: t,
      }
    );
    const totalPaid = (releasedPayments || []).reduce((s, p) => s + Number(p.amount), 0);

    let released = false;
    if (totalPaid > 0) {
      const lp = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId }, transaction: t });
      if (!lp) throw new Error('Lawyer profile missing for escrow release');
      if (Number(lp.pendingBalance) < totalPaid) {
        throw Object.assign(new Error('Недостаточный резерв эскроу'), { status: 409, code: 'ESCROW_BALANCE_MISMATCH' });
      }
      await lp.decrement('pendingBalance', { by: totalPaid, transaction: t });
      await lp.increment('balance', { by: totalPaid, transaction: t });
      released = true;
      for (const payment of releasedPayments) {
        await FinancialEvent.findOrCreate({
          where: { idempotencyKey: `escrow_released:${payment.id}` },
          defaults: {
            consultationId, paymentId: payment.id, source: 'system', type: 'escrow_released',
            amount: payment.amount, idempotencyKey: `escrow_released:${payment.id}`,
          },
          transaction: t,
        });
      }
    }
    // Биллинг (модель B): эскроу отдан юристу → помечаем released (только когда деньги
    // реально двинулись). Аддитивно, на денежную логику не влияет.
    if (released) {
      await Consultation.update({ billingStatus: 'released' }, { where: { id: consultationId }, transaction: t });
    }

    // completedCases растёт ровно при ПЕРВОМ переходе в completed (statusAffected===1),
    // включая бесплатные консультации (у них нет Payment). При повторном завершении
    // (например, админ-форс после отката) не задваиваем.
    if (statusAffected === 1) {
      await LawyerProfile.increment('completedCases', {
        by: 1,
        where: { userId: consultation.lawyerId },
        transaction: t,
      });
    }

    return { consultation, released, alreadyCompleted: statusAffected === 0 };
  });
}

/**
 * Возврат клиенту удержанного (но ещё НЕ высвобожденного) эскроу при отклонении.
 *
 * Возвращаются только платежи status='paid' AND escrowReleased=false — т.е. деньги,
 * которые всё ещё лежат в pendingBalance юриста. Платежи с escrowReleased=true
 * (деньги уже в balance) НЕ трогаются: это защита в глубину — reject источник-гейтом
 * недостижим для completed, поэтому такой случай не возникает, но даже если бы возник,
 * pendingBalance не уйдёт в минус.
 *
 * Вызывать ВНУТРИ транзакции (options.transaction), вместе с переводом в 'rejected'.
 *
 * @returns {Promise<{refunded:number}>} сумма возврата
 */
async function refundConsultationEscrow(consultationId, options = {}) {
  const t = options.transaction;
  const consultation = await Consultation.findByPk(consultationId, { transaction: t, lock: t?.LOCK.UPDATE });
  if (!consultation) return { refunded: 0 };

  // Реальные деньги ещё находятся у Payme. Локальная отмена только снимает
  // внутренний escrow и создаёт обязательство возврата; refunded ставится лишь
  // после подтверждённого CancelTransaction провайдера.
  const now = new Date();
  const [, refundRequestedPayments] = await Payment.update(
    {
      refundStatus: 'requested',
      refundRequestedAt: now,
      refundReason: options.reason || consultation.notes || null,
      refundRequestedBy: options.actorUserId || null,
    },
    {
      where: { consultationId, status: 'paid', escrowReleased: false, refundStatus: 'none' },
      returning: true,
      transaction: t,
    }
  );
  const totalRefund = (refundRequestedPayments || []).reduce((s, p) => s + Number(p.amount), 0);

  // Не проведённые операции внешних денег не содержат: закрываем их как failed.
  await Payment.update(
    { status: 'failed', refundStatus: 'completed', refundedAt: now },
    { where: { consultationId, status: 'pending' }, transaction: t }
  );

  if (totalRefund > 0) {
    const profile = await LawyerProfile.findOne({
      where: { userId: consultation.lawyerId }, transaction: t, lock: t?.LOCK.UPDATE,
    });
    if (!profile || Number(profile.pendingBalance) < totalRefund) {
      throw new Error('Escrow balance mismatch during refund request');
    }
    await profile.decrement('pendingBalance', { by: totalRefund, transaction: t });
    for (const payment of refundRequestedPayments) {
      await FinancialEvent.findOrCreate({
        where: { idempotencyKey: `refund_requested:${payment.id}` },
        defaults: {
          consultationId,
          paymentId: payment.id,
          actorUserId: options.actorUserId || null,
          source: options.source || 'system',
          type: 'refund_requested',
          amount: payment.amount,
          idempotencyKey: `refund_requested:${payment.id}`,
          metadata: { reason: options.reason || consultation.notes || null },
        },
        transaction: t,
      });
    }
  }

  return { refunded: totalRefund };
}

module.exports = { completeConsultation, refundConsultationEscrow };
