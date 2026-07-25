const { Promo } = require('../models');

/**
 * Проверяет промокод на сумму заказа. Возвращает единый результат для эндпоинта
 * валидации и для применения при брони (серверу нельзя доверять клиентской скидке).
 *
 * @returns {Promise<{valid:boolean, reason?:string, code?:string,
 *   discountPercent?:number, discountAmount?:number, minAmount?:number, promo?:object}>}
 */
async function validatePromo(rawCode, amount) {
  if (!rawCode || !String(rawCode).trim()) return { valid: false, reason: 'empty' };
  const code = String(rawCode).trim().toUpperCase();

  const promo = await Promo.findOne({ where: { code } });
  if (!promo || !promo.isActive) return { valid: false, reason: 'notfound' };
  if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return { valid: false, reason: 'expired' };
  if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) return { valid: false, reason: 'limit' };

  const amt = Number(amount) || 0;
  if (amt < (promo.minAmount || 0)) {
    return { valid: false, reason: 'min', minAmount: promo.minAmount };
  }

  const discountAmount = Math.round((amt * promo.discountPercent) / 100);
  return {
    valid: true,
    code: promo.code,
    discountPercent: promo.discountPercent,
    discountAmount,
    promo,
  };
}

module.exports = { validatePromo };
