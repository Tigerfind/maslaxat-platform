const { Op } = require('sequelize');
const { Consultation } = require('../models');

// Акция «первая консультация бесплатно»: приветственный бонус новому клиенту.
// Первая консультация — бесплатно, все последующие — платные.
const NOT_COUNTED = ['cancelled', 'rejected']; // платные: отменённые/отклонённые не считаем
// Бесплатный бонус: не сгорает только если юрист ОТКЛОНИЛ (rejected) — это не вина
// клиента. А отменённая клиентом бесплатная бронь (cancelled) СЧИТАЕТСЯ использованной,
// иначе бонус фармится бесконечно (бронь → отмена → снова бесплатно).
const FREE_NOT_COUNTED = ['rejected'];

/**
 * Считает статус акции «первая консультация бесплатно» по факту бронирования.
 * @param {string} clientId
 * @returns {{ paidCount, freeUsed, totalCount, freeAvailable, freeNow }}
 */
async function computeLoyalty(clientId, opts = {}) {
  // opts.transaction — чтобы пересчёт шёл на той же транзакции/соединении, что и
  // advisory-lock при бронировании (иначе re-check вне лока бессмыслен). Read-only
  // вызовы (GET /consultations/loyalty) зовут без аргумента — поведение не меняется.
  const transaction = opts.transaction;
  const paidCount = await Consultation.count({
    where: { clientId, isFree: false, status: { [Op.notIn]: NOT_COUNTED } },
    transaction,
  });
  const freeUsed = await Consultation.count({
    where: { clientId, isFree: true, status: { [Op.notIn]: FREE_NOT_COUNTED } },
    transaction,
  });

  const totalCount = paidCount + freeUsed;
  // Бесплатна только самая первая консультация — когда у клиента ещё нет ни одной.
  const freeNow = totalCount === 0;
  const freeAvailable = freeNow ? 1 : 0;

  return { paidCount, freeUsed, totalCount, freeAvailable, freeNow };
}

module.exports = { computeLoyalty };
