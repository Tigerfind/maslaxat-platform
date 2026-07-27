const { Op } = require('sequelize');
const { Consultation, Payment, LawyerProfile } = require('../models');

/**
 * Идемпотентное завершение консультации + высвобождение эскроу.
 *
 * Атомарный переход в 'completed' (только если ещё НЕ completed) работает как гейт:
 * эскроу (pendingBalance → balance юриста) высвобождается РОВНО ОДИН РАЗ, кто бы ни
 * завершил консультацию — клиент (/complete), юрист (/end, /status), видео (/video .../end)
 * или админ. Раньше эти пути дублировали логику, а video/end вообще не платил юристу.
 *
 * @returns {Promise<{consultation, released:boolean, alreadyCompleted:boolean}>}
 */
async function completeConsultation(consultationId, notes, actualDuration) {
  const patch = { status: 'completed' };
  if (notes) patch.notes = notes;
  // Фактическая длительность звонка (сек) — только если валидная и положительная
  if (Number.isFinite(actualDuration) && actualDuration > 0) {
    patch.actualDuration = Math.round(actualDuration);
  }

  // Кто первый переведёт в completed — тот и высвобождает эскроу (гонки исключены).
  const [affected] = await Consultation.update(patch, {
    where: { id: consultationId, status: { [Op.ne]: 'completed' } },
  });

  const consultation = await Consultation.findByPk(consultationId);
  if (!consultation || affected === 0) {
    return { consultation, released: false, alreadyCompleted: true };
  }

  let released = false;
  // Сумма ВСЕХ оплаченных платежей по консультации (оригинал + продления) —
  // раньше бралась только одна запись, и доплата за продление не выплачивалась.
  const payments = await Payment.findAll({ where: { consultationId, status: 'paid' }, attributes: ['amount'] });
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  if (totalPaid > 0) {
    const lp = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId } });
    if (lp) {
      await lp.decrement('pendingBalance', { by: totalPaid });
      await lp.increment('balance', { by: totalPaid });
      released = true;
    }
  }

  // completedCases растёт для ЛЮБОЙ завершённой консультации, включая бесплатные
  // (у которых нет Payment) — раньше инкремент был внутри if(payment) и занижал
  // статистику юриста (топ-юристов, онбординг, рейтинги).
  await LawyerProfile.increment('completedCases', {
    by: 1,
    where: { userId: consultation.lawyerId },
  });

  return { consultation, released, alreadyCompleted: false };
}

module.exports = { completeConsultation };
