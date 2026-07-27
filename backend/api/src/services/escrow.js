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
  const payment = await Payment.findOne({ where: { consultationId, status: 'paid' } });
  if (payment) {
    const lp = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId } });
    if (lp) {
      await lp.decrement('pendingBalance', { by: payment.amount });
      await lp.increment('balance', { by: payment.amount });
      released = true;
    }
    await LawyerProfile.increment('completedCases', {
      by: 1,
      where: { userId: consultation.lawyerId },
    });
  }

  return { consultation, released, alreadyCompleted: false };
}

module.exports = { completeConsultation };
