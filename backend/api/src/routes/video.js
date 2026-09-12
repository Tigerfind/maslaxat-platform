const router = require('express').Router();
const crypto = require('crypto');
const { DateTime } = require('luxon');
const { Consultation, User, LawyerProfile, sequelize } = require('../models');
const {
  authenticate,
  authorizeConsultationMode,
  ownsConsultationPerspective,
} = require('../middleware/auth');
const { completeConsultation } = require('../services/escrow');
const { consultationAccess } = require('../services/consultationAccessService');
const { loadTurnConfig } = require('../config/env');
const {
  cancelExtensionProposal,
  consentToExtensionCheckout,
  getExtensionProposalState,
} = require('../services/paymentService');

function buildIceServers(userId) {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turn = loadTurnConfig(process.env);
  if (!turn) return servers;

  if (turn.mode === 'rest') {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
    const credential = crypto.createHmac('sha1', turn.secret).update(username).digest('base64');
    servers.push({ urls: turn.urls, username, credential });
  } else {
    servers.push({ urls: turn.urls, username: turn.username, credential: turn.credential });
  }
  return servers;
}

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
    if (consultation.meetingProvider === 'zoom') {
      return res.status(409).json({ error: 'Используйте защищённый Zoom-вход', code: 'ZOOM_PROVIDER_REQUIRED' });
    }

    // Only participants can access
    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const access = consultationAccess(consultation);
    const canUseVideo = consultation.type === 'video' && access.canJoin;

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
      iceServers: canUseVideo ? buildIceServers(req.userId) : [],
      iceServersExpiresAt: canUseVideo && loadTurnConfig(process.env)?.mode === 'rest'
        ? new Date(Date.now() + 55 * 60 * 1000).toISOString()
        : null,
      access,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/start — mark consultation as in_progress
router.post('/consultation/:id/start', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const consultation = await sequelize.transaction(async (transaction) => {
      const locked = await Consultation.findByPk(req.params.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked) throw Object.assign(new Error('Consultation not found'), { status: 404 });
      if (!ownsConsultationPerspective(req, locked)) {
        throw Object.assign(new Error('Access denied'), { status: 403 });
      }
      if (locked.meetingProvider === 'zoom') {
        throw Object.assign(new Error('Используйте Zoom-вход'), { status: 409, code: 'ZOOM_PROVIDER_REQUIRED' });
      }
      if (!['accepted', 'in_progress'].includes(locked.status)) {
        throw Object.assign(new Error('Консультация ещё не подтверждена юристом'), { status: 400, code: 'INVALID_VIDEO_STATUS' });
      }
      const access = consultationAccess(locked);
      if (!access.canJoin) {
        throw Object.assign(new Error('Подключение сейчас недоступно'), { status: 403, code: access.reason, access });
      }
      if (locked.status === 'accepted') {
        locked.status = 'in_progress';
        locked.callStartedAt = new Date();
        await locked.save({ transaction, fields: ['status', 'callStartedAt'] });
      }
      return locked;
    });

    res.json({ success: true, status: consultation.status });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code, ...err.access });
    next(err);
  }
});

// POST /api/video/consultation/:id/end — mark consultation as completed
router.post('/consultation/:id/end', authorizeConsultationMode, requireVideoParticipant, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }
    if (consultation.meetingProvider === 'zoom') return res.status(409).json({ error: 'Завершение Zoom фиксируется сервером', code: 'ZOOM_PROVIDER_REQUIRED' });

    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (consultation.status === 'completed') {
      return res.json({ success: true, status: 'completed' });
    }

    // Завершить можно только идущую сессию (in_progress) — иначе юрист мог бы
    // забрать эскроу за непроведённую консультацию (pending/accepted).
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Завершить можно только начатую консультацию' });
    }
    if (!consultation.callStartedAt) {
      return res.status(400).json({ error: 'Нет подтверждения соединения участников' });
    }

    const durationSeconds = parseInt(req.body?.durationSeconds, 10);
    if (consultation.clientId === req.userId) {
      await completeConsultation(consultation.id, undefined, durationSeconds);
      return res.json({ success: true, status: 'completed' });
    }

    await consultation.update({
      lawyerEndedAt: consultation.lawyerEndedAt || new Date(),
      ...(Number.isFinite(durationSeconds) && durationSeconds >= 0 ? { actualDuration: durationSeconds } : {}),
    });

    res.json({ success: true, status: consultation.status, awaitingClientConfirmation: true });
  } catch (err) {
    next(err);
  }
});

// Durable consent and prepaid extension checkout.
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
    if (err.code === 'INVALID_EXTENSION_DURATION') return res.status(409).json({ error: 'Максимальная длительность консультации — 90 минут' });
    if (err.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ error: 'Следующее время занято, продление невозможно', code: err.code });
    next(err);
  }
});

module.exports = router;
