const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { validatePromo } = require('../services/promoService');

// Человеко-читаемые причины отказа
const REASONS = {
  empty: 'Введите промокод',
  notfound: 'Промокод не найден или неактивен',
  expired: 'Срок действия промокода истёк',
  limit: 'Лимит использований промокода исчерпан',
  min: 'Сумма заказа меньше минимальной для этого промокода',
};

// ─── POST /api/promo/validate ─────────────────────────────────
// Проверить промокод для суммы. Тело: { code, amount }
router.post('/validate', authenticate, async (req, res, next) => {
  try {
    const { code, amount } = req.body;
    const result = await validatePromo(code, amount);

    if (!result.valid) {
      return res.status(200).json({
        valid: false,
        reason: result.reason, // код для перевода на фронте
        message: REASONS[result.reason] || 'Промокод недействителен',
        minAmount: result.minAmount,
      });
    }

    res.json({
      valid: true,
      code: result.code,
      discountPercent: result.discountPercent,
      discountAmount: result.discountAmount,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
