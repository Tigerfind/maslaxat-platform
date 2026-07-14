const router = require('express').Router();
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { Consultation, User, LawyerProfile, Document, Review, Specialization, Notification, AIConversation } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

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
    const [acceptedCount, rejectedCount] = await Promise.all([
      Consultation.count({ where: { lawyerId: req.userId, status: 'accepted', updatedAt: { [Op.gte]: thirtyDaysAgo } } }),
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

    // Calculate monthly earnings (completed this month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthlyCompleted = await Consultation.count({
      where: { lawyerId: req.userId, status: 'completed', updatedAt: { [Op.gte]: startOfMonth } },
    });
    const pricePerConsultation = profile?.price || 0;
    const monthlyEarnings = monthlyCompleted * pricePerConsultation;
    const totalEarnings = completed * pricePerConsultation;

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
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/admin/stats
router.get('/admin/stats', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const [totalUsers, totalLawyers, totalConsultations, totalActive] = await Promise.all([
      User.count({ where: { role: 'client' } }),
      User.count({ where: { role: 'lawyer' } }),
      Consultation.count(),
      Consultation.count({ where: { status: { [Op.in]: ['pending', 'accepted', 'in_progress'] } } }),
    ]);

    res.json({
      totalUsers,
      totalLawyers,
      totalConsultations,
      activeConsultations: totalActive,
    });
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
    res.json(specializations);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
