const router = require('express').Router();
const { Consultation, User, LawyerProfile } = require('../models');
const {
  authenticate,
  authorizeConsultationMode,
  ownsConsultationPerspective,
} = require('../middleware/auth');
const { completeConsultation } = require('../services/escrow');
const {
  cancelExtensionProposal,
  consentToExtensionCheckout,
  getExtensionProposalState,
} = require('../services/paymentService');

// All routes require authentication (any role)
router.use(authenticate);

async function requireVideoParticipant(req, res, next) {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    req.consultation = consultation;
    next();
  } catch (error) {
    next(error);
  }
}

// GET /api/video/consultation/:id — get consultation details for the video call page
router.get('/consultation/:id', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
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

    res.json({
      id: consultation.id,
      type: consultation.type,
      status: consultation.status,
      question: consultation.question,
      preferredDate: consultation.preferredDate,
      preferredTime: consultation.preferredTime,
      // нужны фронту: обратный отсчёт (duration), превью доплаты (price),
      // определение собеседника для отмены дозвона (clientId/lawyerId)
      duration: consultation.duration,
      price: consultation.price,
      actualDuration: consultation.actualDuration,
      clientId: consultation.clientId,
      lawyerId: consultation.lawyerId,
      client: consultation.client,
      lawyer: consultation.lawyer,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/start — mark consultation as in_progress
router.post('/consultation/:id/start', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const consultation = req.consultation;

    // Старт только из подтверждённой юристом консультации (accepted).
    // Идемпотентно: если уже in_progress — просто возвращаем текущий статус.
    if (consultation.status === 'accepted') {
      consultation.status = 'in_progress';
      await consultation.save();
    } else if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Консультация ещё не подтверждена юристом' });
    }

    res.json({ success: true, status: consultation.status });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/end — mark consultation as completed
router.post('/consultation/:id/end', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const consultation = req.consultation;

    // Завершить можно только идущую сессию (in_progress) — иначе юрист мог бы
    // забрать эскроу за непроведённую консультацию (pending/accepted).
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Завершить можно только начатую консультацию' });
    }

    // Единый идемпотентный путь: завершение + высвобождение эскроу (раньше видео-
    // завершение НЕ платило юристу — деньги застревали в pendingBalance).
    const durationSeconds = parseInt(req.body?.durationSeconds, 10);
    await completeConsultation(consultation.id, undefined, durationSeconds);

    res.json({ success: true, status: 'completed' });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/extend — durable consent + prepaid extension checkout.
const EXTEND_MINUTES = [15, 30];
router.get('/consultation/:id/extension', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const state = await getExtensionProposalState({ actorId: req.userId, consultationId: req.params.id });
    return res.json(state);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.delete('/consultation/:id/extension/:proposalId', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const result = await cancelExtensionProposal({
      actorId: req.userId,
      consultationId: req.params.id,
      proposalId: req.params.proposalId,
    });
    return res.status(result.outcome === 'cancellation_requested' ? 202 : 200).json({
      success: true,
      paymentStatus: result.payment.status,
      outcome: result.outcome,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

router.post('/consultation/:id/extend', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    let minutes = parseInt(req.body?.minutes, 10);
    if (!EXTEND_MINUTES.includes(minutes)) minutes = 15;
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key обязателен' });
    const result = await consentToExtensionCheckout({
      actorId: req.userId,
      consultationId: req.params.id,
      minutes,
      idempotencyKey,
    });
    const payload = {
      success: true,
      ...result.proposal,
      addAmount: Number(result.payment.amount),
    };
    return res.status(result.consentComplete ? 200 : 202).json(payload);
  } catch (err) {
    if (/not found/i.test(err.message)) return res.status(404).json({ error: err.message });
    if (/access denied/i.test(err.message)) return res.status(403).json({ error: err.message });
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (/not in progress|unsupported|idempotency|active checkout|terminal/i.test(err.message)) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
