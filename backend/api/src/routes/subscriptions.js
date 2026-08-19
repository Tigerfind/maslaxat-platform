const router = require('express').Router();
const { randomUUID } = require('crypto');
const { Subscription, User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { getRedis } = require('../config/redis');
const { computeSubscriptionBenefit } = require('../services/subscriptionService');
const { createCheckout, markPaymentPaid } = require('../services/paymentService');

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

async function subscriptionForUser(userId) {
  return Subscription.sequelize.transaction(async (tx) => {
    await User.findByPk(userId, { lock: tx.LOCK.UPDATE, transaction: tx });
    let subscription = await Subscription.findOne({ where: { userId }, lock: tx.LOCK.UPDATE, transaction: tx });
    if (!subscription) subscription = await Subscription.create({ userId, plan: 'free', price: 0 }, { transaction: tx });
    return subscription;
  });
}

async function buildSubscriptionCheckout(userId, plan, idempotencyKey) {
  if (!['basic', 'pro'].includes(plan)) {
    const error = new Error('Допустимые планы: basic, pro');
    error.status = 400;
    throw error;
  }
  const subscription = await subscriptionForUser(userId);
  return createCheckout({
    userId,
    purpose: 'subscription',
    subjectId: subscription.id,
    idempotencyKey,
    plan,
  });
}

// Production checkout remains pending until the authenticated provider webhook confirms payment.
router.post('/checkout', authenticate, async (req, res, next) => {
  try {
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key обязателен' });
    const checkout = await buildSubscriptionCheckout(req.userId, req.body.plan, idempotencyKey);
    return res.json({
      paymentId: checkout.payment.id,
      checkoutUrl: checkout.checkoutUrl,
      amount: checkout.amount,
      amountTiyin: checkout.amountTiyin,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// Compatibility endpoint for the current client. Real-provider environments return checkout;
// only dev/test without Payme credentials performs the explicit simulation through paymentService.
router.post('/upgrade', authenticate, async (req, res, next) => {
  try {
    const plan = req.body.plan;
    const checkout = await buildSubscriptionCheckout(
      req.userId,
      plan,
      req.get('Idempotency-Key') || randomUUID()
    );
    const configuredKey = String(process.env.PAYME_KEY || '').trim();
    const hasRealPayme = configuredKey && !['CHANGE_ME', 'sk-CHANGE_ME'].includes(configuredKey);
    if (process.env.NODE_ENV === 'production' || hasRealPayme) {
      return res.json({
        paymentId: checkout.payment.id,
        checkoutUrl: checkout.checkoutUrl,
        amount: checkout.amount,
        amountTiyin: checkout.amountTiyin,
      });
    }

    await markPaymentPaid({
      paymentId: checkout.payment.id,
      providerTransactionId: `test:${checkout.payment.id}`,
      amountTiyin: checkout.amountTiyin,
      providerData: { test: true, performTime: Date.now() },
    });
    const subscription = await Subscription.findOne({ where: { userId: req.userId } });
    return res.json({
      success: true,
      plan,
      expiresAt: subscription.expiresAt,
      message: `Подписка "${PLANS[plan].label}" оплачена (тест) и активирована до ${subscription.expiresAt.toLocaleDateString('ru-RU')}`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

module.exports = router;
