const { Op } = require('sequelize');
const { Subscription, Consultation } = require('../models');

// Сколько бесплатных консультаций в месяц даёт план
const PLAN_CONSULTATIONS = { free: 0, basic: 1, pro: 3 };

// Активный план пользователя (free, если подписки нет или истекла)
async function activePlan(userId) {
  const sub = await Subscription.findOne({ where: { userId } });
  if (!sub) return { plan: 'free', expiresAt: null };
  const expired = sub.expiresAt && new Date(sub.expiresAt) < new Date();
  return { plan: expired ? 'free' : sub.plan, expiresAt: sub.expiresAt };
}

// Начало текущего календарного месяца
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Сколько подписочных бесплатных консультаций осталось у клиента в этом месяце.
 * @returns {{ plan, limit, used, remaining }}
 */
async function computeSubscriptionBenefit(userId) {
  const { plan } = await activePlan(userId);
  const limit = PLAN_CONSULTATIONS[plan] || 0;
  if (limit === 0) return { plan, limit: 0, used: 0, remaining: 0 };

  // Считаем уже использованные подписочные бесплатные брони этого месяца
  // (отменённые/отклонённые не в счёт — они возвращают лимит).
  const used = await Consultation.count({
    where: {
      clientId: userId,
      freeSource: 'subscription',
      status: { [Op.notIn]: ['cancelled', 'rejected'] },
      createdAt: { [Op.gte]: startOfMonth() },
    },
  });
  return { plan, limit, used, remaining: Math.max(0, limit - used) };
}

module.exports = { computeSubscriptionBenefit, activePlan, PLAN_CONSULTATIONS };
