const router = require('express').Router();
const { Subscription } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getRedis } = require('../config/redis');

const PLANS = {
  free:  { price: 0,      aiLimit: 3,        consultations: 0, label: 'Бесплатный' },
  basic: { price: 99000,  aiLimit: Infinity,  consultations: 1, label: 'Базовый'    },
  pro:   { price: 299000, aiLimit: Infinity,  consultations: 3, label: 'Про'        },
};

// ─── GET /api/subscriptions/plans ────────────────────────────
// Список доступных планов
router.get('/plans', (req, res) => {
  res.json(PLANS);
});

// ─── GET /api/subscriptions/my ───────────────────────────────
// Текущий план пользователя + остаток AI запросов
router.get('/my', authenticate, async (req, res, next) => {
  try {
    let subscription = await Subscription.findOne({ where: { userId: req.userId } });

    if (!subscription) {
      // Создаём free план автоматически
      subscription = await Subscription.create({ userId: req.userId, plan: 'free' });
    }

    const plan = subscription.plan;
    const isExpired = subscription.expiresAt && subscription.expiresAt < new Date();
    const activePlan = isExpired ? 'free' : plan;

    // Остаток AI запросов для free
    let aiUsedToday = 0;
    if (activePlan === 'free') {
      const redis = getRedis();
      if (redis) {
        const today = new Date().toISOString().split('T')[0];
        const count = await redis.get(`ai_limit:${req.userId}:${today}`);
        aiUsedToday = parseInt(count) || 0;
      }
    }

    res.json({
      plan: activePlan,
      expiresAt: subscription.expiresAt,
      isExpired,
      aiLimit: PLANS[activePlan].aiLimit === Infinity ? null : PLANS[activePlan].aiLimit,
      aiUsedToday,
      consultationsPerMonth: PLANS[activePlan].consultations,
      price: PLANS[activePlan].price,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/subscriptions/upgrade ─────────────────────────
// Создать/обновить подписку (вызывается после успешной оплаты)
// В будущем — интеграция с Payme, пока ручное подтверждение
router.post('/upgrade', authenticate, async (req, res, next) => {
  try {
    const { plan } = req.body;

    if (!['basic', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Допустимые планы: basic, pro' });
    }

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 1); // +1 месяц

    let subscription = await Subscription.findOne({ where: { userId: req.userId } });
    if (subscription) {
      await subscription.update({ plan, price: PLANS[plan].price, expiresAt });
    } else {
      subscription = await Subscription.create({ userId: req.userId, plan, price: PLANS[plan].price, expiresAt });
    }

    res.json({
      success: true,
      plan,
      expiresAt,
      message: `Подписка "${PLANS[plan].label}" активирована до ${expiresAt.toLocaleDateString('ru-RU')}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
