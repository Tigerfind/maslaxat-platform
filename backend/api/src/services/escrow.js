const { Op } = require('sequelize');
const { Consultation, Payment, LawyerProfile } = require('../models');

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
    const patch = { status: 'completed' };
    if (notes) patch.notes = notes;
    // Фактическая длительность звонка (сек) — только если валидная и положительная
    if (Number.isFinite(actualDuration) && actualDuration > 0) {
      patch.actualDuration = Math.round(actualDuration);
    }

    // Атомарный переход в completed (только если ещё НЕ completed). Служит гейтом
    // для «первого завершения» (completedCases), но БОЛЬШЕ не гейтит выплату.
    const [statusAffected] = await Consultation.update(patch, {
      where: { id: consultationId, status: { [Op.ne]: 'completed' } },
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
        where: { consultationId, status: 'paid', escrowReleased: false },
        returning: true,
        transaction: t,
      }
    );
    const totalPaid = (releasedPayments || []).reduce((s, p) => s + Number(p.amount), 0);

    let released = false;
    if (totalPaid > 0) {
      const lp = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId }, transaction: t });
      if (lp) {
        await lp.decrement('pendingBalance', { by: totalPaid, transaction: t });
        await lp.increment('balance', { by: totalPaid, transaction: t });
        released = true;
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
  const consultation = await Consultation.findByPk(consultationId, { transaction: t });
  if (!consultation) return { refunded: 0 };

  const [, refundedPayments] = await Payment.update(
    { status: 'refunded' },
    {
      where: { consultationId, status: 'paid', escrowReleased: false },
      returning: true,
      transaction: t,
    }
  );
  const totalRefund = (refundedPayments || []).reduce((s, p) => s + Number(p.amount), 0);

  if (totalRefund > 0) {
    await LawyerProfile.decrement('pendingBalance', {
      by: totalRefund,
      where: { userId: consultation.lawyerId },
      transaction: t,
    });
  }

  return { refunded: totalRefund };
}

module.exports = { completeConsultation, refundConsultationEscrow };
