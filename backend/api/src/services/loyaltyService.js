const { Op } = require('sequelize');
const { Consultation } = require('../models');

// Акция «первая консультация бесплатно»: приветственный бонус новому клиенту.
// Первая консультация — бесплатно, все последующие — платные.
const NOT_COUNTED = ['cancelled', 'rejected']; // отменённые/отклонённые не считаем

/**
 * Считает статус акции «первая консультация бесплатно» по факту бронирования.
 * @param {string} clientId
 * @returns {{ paidCount, freeUsed, totalCount, freeAvailable, freeNow }}
 */
async function computeLoyalty(clientId) {
  const paidCount = await Consultation.count({
    where: { clientId, isFree: false, status: { [Op.notIn]: NOT_COUNTED } },
  });
  const freeUsed = await Consultation.count({
    where: { clientId, isFree: true, status: { [Op.notIn]: NOT_COUNTED } },
  });

  const totalCount = paidCount + freeUsed;
  // Бесплатна только самая первая консультация — когда у клиента ещё нет ни одной.
  const freeNow = totalCount === 0;
  const freeAvailable = freeNow ? 1 : 0;

  return { paidCount, freeUsed, totalCount, freeAvailable, freeNow };
}

module.exports = { computeLoyalty };
