const router = require('express').Router();
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Consultation, User, LawyerProfile, Document, Review, Specialization, Notification, AIConversation, Payment } = require('../models');

// Последние N месяцев: [{ key:'YYYY-MM', year, month }] от старого к новому
function lastMonths(n) {
  const arr = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, year: d.getFullYear(), month: d.getMonth() });
  }
  return arr;
}
const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const { authenticate, authorize } = require('../middleware/auth');
const { withLawyerCounts } = require('../services/specializationStats');

// GET /api/dashboard/client/stats
router.get('/client/stats', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const [active, completed, documents, unreadNotifications, aiChats] = await Promise.all([
      Consultation.count({ where: { clientId: req.userId, status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } } }),
      Consultation.count({ where: { clientId: req.userId, status: 'completed' } }),
      Document.count({ where: { userId: req.userId } }),
      Notification.count({ where: { userId: req.userId, isRead: false } }),
      AIConversation.count({ where: { userId: req.userId } }),
    ]);

    res.json({
      activeConsultations: active,
      completedConsultations: completed,
      documents,
      aiChats,
      unreadNotifications,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/lawyer/stats
router.get('/lawyer/stats', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const [pending, active, completed, reviews, unreadNotifications] = await Promise.all([
      Consultation.count({ where: { lawyerId: req.userId, status: 'pending' } }),
      Consultation.count({ where: { lawyerId: req.userId, status: { [Op.in]: ['accepted', 'in_progress'] } } }),
      Consultation.count({ where: { lawyerId: req.userId, status: 'completed' } }),
      Review.count({ where: { lawyerId: req.userId } }),
      Notification.count({ where: { userId: req.userId, isRead: false } }),
    ]);

    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });

    // Weekly activity: consultations per day for last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const weeklyRaw = await Consultation.findAll({
      where: {
        lawyerId: req.userId,
        createdAt: { [Op.gte]: sevenDaysAgo },
      },
      attributes: [
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      raw: true,
    });

    // Build 7-day array [Mon..Sun] mapped to actual counts
    const weeklyActivity = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const found = weeklyRaw.find((r) => r.date === dateStr);
      weeklyActivity.push(parseInt(found?.count) || 0);
    }

    // Response rate: accepted / (accepted + rejected) from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // Принятой считается заявка, дошедшая до accepted/in_progress/completed (а не только
    // ровно 'accepted' — иначе принятые, но уже идущие/завершённые не попадали в расчёт).
    const [acceptedCount, rejectedCount] = await Promise.all([
      Consultation.count({ where: { lawyerId: req.userId, status: { [Op.in]: ['accepted', 'in_progress', 'completed'] }, updatedAt: { [Op.gte]: thirtyDaysAgo } } }),
      Consultation.count({ where: { lawyerId: req.userId, status: 'rejected', updatedAt: { [Op.gte]: thirtyDaysAgo } } }),
    ]);
    const totalResponded = acceptedCount + rejectedCount;
    const responseRate = totalResponded > 0 ? Math.round((acceptedCount / totalResponded) * 100) : null;

    // Calculate active clients (unique clients with active consultations)
    const activeClients = await Consultation.count({
      where: { lawyerId: req.userId, status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } },
      distinct: true,
      col: 'clientId',
    });

    // Заработок — по ФАКТИЧЕСКИМ ценам завершённых консультаций (с учётом промо/бесплатных),
    // а не число × текущая цена профиля (которая могла меняться).
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [monthlyEarningsRaw, totalEarningsRaw] = await Promise.all([
      Consultation.sum('price', { where: { lawyerId: req.userId, status: 'completed', updatedAt: { [Op.gte]: startOfMonth } } }),
      Consultation.sum('price', { where: { lawyerId: req.userId, status: 'completed' } }),
    ]);
    const monthlyEarnings = monthlyEarningsRaw || 0;
    const totalEarnings = totalEarningsRaw || 0;

    res.json({
      pendingRequests: pending,
      activeConsultations: active,
      completedConsultations: completed,
      activeClients,
      totalReviews: reviews,
      rating: profile?.rating || 0,
      earnings: totalEarnings,
      monthlyEarnings,
      totalEarnings,
      unreadNotifications,
      weeklyActivity,
      responseRate: responseRate || 0,
      // Профиль настроен? Признак = заполнено описание (его ставит онбординг/редактор
      // профиля и НЕ трогает переключатель онлайн/офлайн — в отличие от isAvailable).
      // Нужен фронту, чтобы показывать мастер онбординга только пока профиль не заполнен.
      profileComplete: !!(profile && profile.description && String(profile.description).trim()),
      // Реальный онлайн/офлайн — чтобы пилюля статуса отражала состояние после загрузки,
      // а не всегда «онлайн».
      isAvailable: profile ? Boolean(profile.isAvailable) : false,
      // Статус модерации админом — для баннера в кабинете (на проверке/одобрен/отклонён).
      verificationStatus: profile?.verificationStatus || 'pending',
      rejectionReason: profile?.rejectionReason || null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyer/dashboard/analytics — доход по месяцам, воронка, рейтинг
router.get('/lawyer/analytics', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const months = lastMonths(6);
    const sixMonthsAgo = new Date(months[0].year, months[0].month, 1);

    // Доход по месяцам — по фактической цене завершённых консультаций
    const completedRows = await Consultation.findAll({
      where: { lawyerId: req.userId, status: 'completed', updatedAt: { [Op.gte]: sixMonthsAgo } },
      attributes: ['price', 'updatedAt'], raw: true,
    });
    const incomeByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
    const countByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
    for (const r of completedRows) {
      const k = monthKey(r.updatedAt);
      if (k in incomeByMonth) { incomeByMonth[k] += Number(r.price) || 0; countByMonth[k] += 1; }
    }
    const monthlyIncome = months.map((m) => ({ month: m.key, income: incomeByMonth[m.key], count: countByMonth[m.key] }));

    // Воронка конверсии (за всё время)
    const [requests, accepted, completedTotal, rejected] = await Promise.all([
      Consultation.count({ where: { lawyerId: req.userId, status: { [Op.notIn]: ['payment_pending'] } } }),
      Consultation.count({ where: { lawyerId: req.userId, status: { [Op.in]: ['accepted', 'in_progress', 'completed'] } } }),
      Consultation.count({ where: { lawyerId: req.userId, status: 'completed' } }),
      Consultation.count({ where: { lawyerId: req.userId, status: 'rejected' } }),
    ]);
    const acceptRate = (accepted + rejected) > 0 ? Math.round((accepted / (accepted + rejected)) * 100) : null;
    const completeRate = accepted > 0 ? Math.round((completedTotal / accepted) * 100) : null;

    // Разбивка по звёздам
    const reviews = await Review.findAll({ where: { lawyerId: req.userId }, attributes: ['rating'], raw: true });
    const ratingBreakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let ratingSum = 0;
    for (const rv of reviews) {
      const s = Math.round(rv.rating);
      if (ratingBreakdown[s] !== undefined) ratingBreakdown[s]++;
      ratingSum += rv.rating;
    }
    const avgRating = reviews.length ? +(ratingSum / reviews.length).toFixed(1) : 0;

    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });

    res.json({
      monthlyIncome,
      totalIncome: monthlyIncome.reduce((s, m) => s + m.income, 0),
      funnel: { requests, accepted, completed: completedTotal, rejected, acceptRate, completeRate },
      ratingBreakdown, avgRating, totalReviews: reviews.length,
      balance: profile ? Number(profile.balance) : 0,
      pendingBalance: profile ? Number(profile.pendingBalance) : 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/dashboard/reports — выручка, консультации по статусам, рост юзеров, топ юристов
router.get('/admin/reports', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const months = lastMonths(6);
    const sixMonthsAgo = new Date(months[0].year, months[0].month, 1);

    // Выручка платформы — по оплаченным платежам
    const paidRows = await Payment.findAll({ where: { status: 'paid' }, attributes: ['amount', 'createdAt'], raw: true });
    const revenueByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
    let totalRevenue = 0;
    for (const p of paidRows) {
      totalRevenue += Number(p.amount) || 0;
      const k = monthKey(p.createdAt);
      if (k in revenueByMonth) revenueByMonth[k] += Number(p.amount) || 0;
    }
    const monthlyRevenue = months.map((m) => ({ month: m.key, revenue: revenueByMonth[m.key] }));

    // Консультации по статусам
    const statuses = ['payment_pending', 'pending', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled'];
    const byStatusRaw = await Promise.all(statuses.map((s) => Consultation.count({ where: { status: s } })));
    const consultationsByStatus = Object.fromEntries(statuses.map((s, i) => [s, byStatusRaw[i]]));

    // Рост пользователей (новые клиенты/юристы по месяцам)
    const userRows = await User.findAll({
      where: { role: { [Op.in]: ['client', 'lawyer'] }, createdAt: { [Op.gte]: sixMonthsAgo } },
      attributes: ['role', 'createdAt'], raw: true,
    });
    const clientsByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
    const lawyersByMonth = Object.fromEntries(months.map((m) => [m.key, 0]));
    for (const u of userRows) {
      const k = monthKey(u.createdAt);
      if (k in clientsByMonth) { if (u.role === 'lawyer') lawyersByMonth[k]++; else clientsByMonth[k]++; }
    }
    const usersGrowth = months.map((m) => ({ month: m.key, clients: clientsByMonth[m.key], lawyers: lawyersByMonth[m.key] }));

    // Топ юристов по завершённым делам
    const topProfiles = await LawyerProfile.findAll({
      order: [['completedCases', 'DESC']], limit: 5,
      include: [{ model: User, as: 'user', attributes: ['name'] }],
    });
    const topLawyers = topProfiles.map((p) => ({
      name: p.user?.name || '—',
      completedCases: p.completedCases || 0,
      rating: Number(p.rating) || 0,
      earnings: Number(p.balance) || 0,
    }));

    res.json({ totalRevenue, monthlyRevenue, consultationsByStatus, usersGrowth, topLawyers });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/admin/stats
router.get('/admin/stats', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [totalUsers, totalClients, totalLawyers, totalConsultations, totalActive, totalRevenue, monthlyRevenue] = await Promise.all([
      User.count(), // все пользователи (раньше карточка «Всего» считала только клиентов)
      User.count({ where: { role: 'client' } }),
      User.count({ where: { role: 'lawyer' } }),
      Consultation.count(),
      Consultation.count({ where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } } }),
      // Доход = сумма ОПЛАЧЕННЫХ платежей (как в /reports), скаляром для KPI-карточек,
      // которые раньше читали несуществующие поля → всегда 0.
      Payment.sum('amount', { where: { status: 'paid' } }),
      Payment.sum('amount', { where: { status: 'paid', createdAt: { [Op.gte]: startOfMonth } } }),
    ]);

    res.json({
      totalUsers,
      totalClients,
      totalLawyers,
      totalConsultations,
      activeConsultations: totalActive,
      totalRevenue: totalRevenue || 0,
      monthlyRevenue: monthlyRevenue || 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/client/dashboard/activity — лента активности клиента (агрегация реальных
// событий: консультации, загруженные документы, оставленные отзывы). Без выдуманных данных.
router.get('/client/activity', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const [cons, docs, reviews] = await Promise.all([
      Consultation.findAll({
        where: { clientId: req.userId },
        include: [{ model: User, as: 'lawyer', attributes: ['name'] }],
        order: [['createdAt', 'DESC']], limit: 20,
      }),
      Document.findAll({ where: { userId: req.userId }, order: [['createdAt', 'DESC']], limit: 20 }),
      Review.findAll({
        where: { clientId: req.userId },
        include: [{ model: User, as: 'lawyer', attributes: ['name'] }],
        order: [['createdAt', 'DESC']], limit: 20,
      }),
    ]);

    const events = [];
    for (const c of cons) events.push({ type: 'consultation', date: c.createdAt, name: c.lawyer?.name || null, status: c.status });
    for (const d of docs) events.push({ type: 'document', date: d.createdAt, name: d.name });
    for (const r of reviews) events.push({ type: 'review', date: r.createdAt, name: r.lawyer?.name || null, rating: r.rating });

    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(events.slice(0, 30));
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/specializations
router.get('/specializations', async (req, res, next) => {
  try {
    const specializations = await Specialization.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']],
    });
    // Реальное число юристов по каждой специализации (раньше lawyerCount всегда был 1 из сида).
    // Общий хелпер — тот же, что использует админка, чтобы цифры не расходились.
    res.json(await withLawyerCounts(specializations));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
