const router = require('express').Router();
const { Op } = require('sequelize');
const { Consultation, User, LawyerProfile, Payment } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

// GET /api/consultations — мои консультации
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.userRole === 'client') where.clientId = req.userId;
    if (req.userRole === 'lawyer') where.lawyerId = req.userId;
    if (status && status !== 'all') where.status = status;

    const { count, rows } = await Consultation.findAndCountAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar', 'email'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar', 'email'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      consultations: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/upcoming — предстоящие
router.get('/upcoming', authenticate, async (req, res, next) => {
  try {
    const where = {
      status: { [Op.in]: ['accepted', 'in_progress'] },
    };
    if (req.userRole === 'client') where.clientId = req.userId;
    if (req.userRole === 'lawyer') where.lawyerId = req.userId;

    const consultations = await Consultation.findAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
      order: [['preferredDate', 'ASC']],
      limit: 10,
    });

    res.json(consultations);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/consultations/:id/status — изменить статус (юрист/админ)
router.patch('/:id/status', authenticate, authorize('lawyer', 'admin'), async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (req.userRole === 'lawyer' && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const prevStatus = consultation.status;
    consultation.status = req.body.status;
    if (req.body.notes) consultation.notes = req.body.notes;
    await consultation.save();

    // ── Эскроу: при завершении консультации переводим деньги юристу ──
    if (req.body.status === 'completed' && prevStatus !== 'completed') {
      const payment = await Payment.findOne({
        where: { consultationId: consultation.id, status: 'paid' },
      });
      if (payment) {
        const lawyerProfile = await LawyerProfile.findOne({
          where: { userId: consultation.lawyerId },
        });
        if (lawyerProfile) {
          await lawyerProfile.decrement('pendingBalance', { by: payment.amount });
          await lawyerProfile.increment('balance', { by: payment.amount });
        }
        await LawyerProfile.increment('completedCases', {
          by: 1,
          where: { userId: consultation.lawyerId },
        });
      }
    }

    res.json({ consultation });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/:id — получить детали консультации
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    res.json({ consultation });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/join — присоединиться к консультации
router.post('/:id/join', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'] },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    if (['accepted', 'pending'].includes(consultation.status)) {
      consultation.status = 'in_progress';
      await consultation.save();
    }

    res.json({ consultation });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/cancel — отменить
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    consultation.status = 'cancelled';
    consultation.notes = req.body.reason || 'Отменено пользователем';
    await consultation.save();

    // Notify the other party about cancellation
    const canceller = await User.findByPk(req.userId, { attributes: ['name'] });
    const otherUserId = consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId;
    notificationService.notifyConsultationCancelled(otherUserId, canceller?.name || 'Пользователь', consultation);

    res.json({ message: 'Консультация отменена', consultation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
