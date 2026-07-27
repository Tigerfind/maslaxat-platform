const router = require('express').Router();
const { Subscription, Payment } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getRedis } = require('../config/redis');
const { computeSubscriptionBenefit } = require('../services/subscriptionService');

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

    // Остаток бесплатных консультаций по подписке в этом месяце
    const benefit = await computeSubscriptionBenefit(req.userId);

    res.json({
      plan: activePlan,
      expiresAt: subscription.expiresAt,
      isExpired,
      aiLimit: PLANS[activePlan].aiLimit === Infinity ? null : PLANS[activePlan].aiLimit,
      aiUsedToday,
      consultationsPerMonth: PLANS[activePlan].consultations,
      consultationsLeft: benefit.remaining,
      consultationsUsed: benefit.used,
      price: PLANS[activePlan].price,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/subscriptions/upgrade ─────────────────────────
// Оформление платной подписки. БЕЗОПАСНОСТЬ/ДЕНЬГИ: раньше активировалась БЕСПЛАТНО.
// Теперь проходит через оплату: в dev/test — тестовый платёж (как у консультаций),
// в проде с реальным Payme — активация только после webhook (Фаза 6).
router.post('/upgrade', authenticate, async (req, res, next) => {
  try {
    const { plan } = req.body;

    if (!['basic', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Допустимые планы: basic, pro' });
    }

    // В проде подписка активируется только после реальной оплаты Payme (Фаза 6).
    if (process.env.NODE_ENV === 'production' || process.env.PAYME_KEY) {
      return res.status(501).json({ error: 'Оплата подписки через Payme ещё не подключена' });
    }

    const price = PLANS[plan].price;

    // ТЕСТ-ОПЛАТА подписки: фиксируем платёж в леджере, затем активируем.
    await Payment.create({
      userId: req.userId,
      consultationId: null,
      amount: price,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
      providerResponse: { test: true, subscription: plan, paidAt: Date.now() },
    });

    let subscription = await Subscription.findOne({ where: { userId: req.userId } });

    // Продлеваем от текущего срока, если подписка ещё активна (тот же план) —
    // иначе повторная оплата до истечения теряла оплаченный остаток.
    const now = new Date();
    const base = subscription && subscription.plan === plan && subscription.expiresAt && new Date(subscription.expiresAt) > now
      ? new Date(subscription.expiresAt)
      : now;
    const expiresAt = new Date(base);
    expiresAt.setMonth(expiresAt.getMonth() + 1); // +1 месяц

    if (subscription) {
      await subscription.update({ plan, price, expiresAt });
    } else {
      subscription = await Subscription.create({ userId: req.userId, plan, price, expiresAt });
    }

    res.json({
      success: true,
      plan,
      expiresAt,
      message: `Подписка "${PLANS[plan].label}" оплачена (тест) и активирована до ${expiresAt.toLocaleDateString('ru-RU')}`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
