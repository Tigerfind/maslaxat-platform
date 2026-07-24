const router = require('express').Router();
const { Consultation, User, LawyerProfile } = require('../models');
const { authenticate } = require('../middleware/auth');
const { completeConsultation } = require('../services/escrow');

// All routes require authentication (any role)
router.use(authenticate);

// GET /api/video/consultation/:id — get consultation details for the video call page
router.get('/consultation/:id', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile', attributes: ['specialization'] }],
        },
      ],
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    // Only participants can access
    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      id: consultation.id,
      type: consultation.type,
      status: consultation.status,
      question: consultation.question,
      preferredDate: consultation.preferredDate,
      preferredTime: consultation.preferredTime,
      client: consultation.client,
      lawyer: consultation.lawyer,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/start — mark consultation as in_progress
router.post('/consultation/:id/start', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (consultation.status === 'accepted' || consultation.status === 'pending') {
      consultation.status = 'in_progress';
      await consultation.save();
    }

    res.json({ success: true, status: consultation.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/end — mark consultation as completed
router.post('/consultation/:id/end', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }

    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Единый идемпотентный путь: завершение + высвобождение эскроу (раньше видео-
    // завершение НЕ платило юристу — деньги застревали в pendingBalance).
    await completeConsultation(consultation.id);

    res.json({ success: true, status: 'completed' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
