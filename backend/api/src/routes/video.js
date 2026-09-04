const router = require('express').Router();
const crypto = require('crypto');
const { DateTime } = require('luxon');
const { Consultation, User, LawyerProfile, Payment } = require('../models');
const { authenticate } = require('../middleware/auth');
const { completeConsultation } = require('../services/escrow');
const availabilityService = require('../services/availabilityService');
const { requireSupportedCall } = require('../services/callProviderPolicy');
const { hasBilateralPeerEvidence } = require('../services/webrtcEvidenceService');
const consultationPolicy = require('../services/consultationPolicy');

const extensionPaymentsAvailable = () => process.env.NODE_ENV !== 'production' && !process.env.PAYME_KEY;

function buildIceServers(userId) {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const urls = String(process.env.TURN_URLS || process.env.TURN_URL || '')
    .split(',').map((url) => url.trim()).filter(Boolean);
  if (!urls.length) return servers;

  if (process.env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls, username, credential });
  } else if ((process.env.NODE_ENV !== 'production' || process.env.TURN_ALLOW_STATIC === '1')
    && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  return servers;
}

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
        { model: Payment, as: 'payments', separate: true, attributes: ['status', 'refundStatus'] },
      ],
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }
    const callPolicy = requireSupportedCall(consultation);

    // Only participants can access
    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const access = consultationPolicy.policyDto(consultation, req.userRole, new Date());
    const canUseVideo = access.canJoin;

    res.json({
      id: consultation.id,
      type: consultation.type,
      callMode: callPolicy.mode,
      status: consultation.status,
      question: consultation.question,
      preferredDate: consultation.preferredDate,
      preferredTime: consultation.preferredTime,
      // нужны фронту: обратный отсчёт (duration), превью доплаты (price),
      // определение собеседника для отмены дозвона (clientId/lawyerId)
      duration: consultation.duration,
      price: consultation.price,
      actualDuration: consultation.actualDuration,
      callStartedAt: consultation.callStartedAt,
      clientId: consultation.clientId,
      lawyerId: consultation.lawyerId,
      client: consultation.client,
      lawyer: consultation.lawyer,
      iceServers: canUseVideo ? buildIceServers(req.userId) : [],
      iceServersExpiresAt: canUseVideo && process.env.TURN_SECRET
        ? new Date(Date.now() + 55 * 60 * 1000).toISOString()
        : null,
      access,
      capabilities: { extensionPayments: extensionPaymentsAvailable() },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/start — mark consultation as in_progress
router.post('/consultation/:id/start', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [{ model: Payment, as: 'payments', separate: true, attributes: ['status', 'refundStatus'] }],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Consultation not found' });
    }
    requireSupportedCall(consultation);

    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!['accepted', 'in_progress'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Консультация ещё не подтверждена юристом' });
    }
    const access = consultationPolicy.policyDto(consultation, req.userRole, new Date());
    if (!access.canJoin) return res.status(403).json({ error: 'Подключение сейчас недоступно', code: access.reason, ...access });
    if (!consultation.callStartedAt || !await hasBilateralPeerEvidence(consultation.id)) {
      return res.status(409).json({ error: 'Ожидается соединение второго участника', code: 'PEER_NOT_CONNECTED' });
    }

    // Старт только из подтверждённой юристом консультации (accepted).
    // Идемпотентно: если уже in_progress — просто возвращаем текущий статус.
    if (consultation.status === 'accepted') {
      const [affected] = await Consultation.update(
        { status: 'in_progress' },
        { where: { id: consultation.id, status: 'accepted' } }
      );
      if (affected === 0) return res.status(400).json({ error: 'Консультация уже изменена' });
      await consultation.reload();
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
    requireSupportedCall(consultation);

    const isParticipant =
      consultation.clientId === req.userId ||
      consultation.lawyerId === req.userId;

    if (!isParticipant) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (consultation.status === 'completed') {
      if (!consultation.callStartedAt || !await hasBilateralPeerEvidence(consultation.id)) {
        return res.status(409).json({ error: 'Нет подтверждения соединения участников', code: 'SESSION_EVIDENCE_REQUIRED' });
      }
      return res.json({ success: true, status: 'completed', alreadyCompleted: true });
    }

    // Завершить можно только идущую сессию (in_progress) — иначе юрист мог бы
    // забрать эскроу за непроведённую консультацию (pending/accepted).
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Завершить можно только начатую консультацию' });
    }
    if (!consultation.callStartedAt || !await hasBilateralPeerEvidence(consultation.id)) {
      return res.status(400).json({ error: 'Нет подтверждения соединения участников' });
    }

    if (consultation.clientId === req.userId) {
      const outcome = await completeConsultation(consultation.id, undefined, undefined, {
        precondition: async (locked, transaction) => {
          if (locked.clientId !== req.userId) throw Object.assign(new Error('Access denied'), { status: 403 });
          if (!locked.scheduledStartAt || !locked.scheduledEndAt || new Date(locked.scheduledEndAt) <= new Date(locked.scheduledStartAt)) {
            throw Object.assign(new Error('Расписание консультации не подтверждено'), { status: 409, code: 'CONSULTATION_NOT_SCHEDULED' });
          }
          if (!locked.callStartedAt || !await hasBilateralPeerEvidence(locked.id, transaction)) throw Object.assign(new Error('Нет подтверждения соединения участников'), { status: 409, code: 'SESSION_EVIDENCE_REQUIRED' });
        },
      });
      if (!outcome.alreadyCompleted && outcome.consultation?.status !== 'completed') {
        return res.status(409).json({ error: 'Консультация уже отменена или недоступна для завершения', code: 'INVALID_STATUS_TRANSITION' });
      }
      return res.json({ success: true, status: 'completed', actualDuration: outcome.consultation.actualDuration });
    }

    await consultation.update({
      lawyerEndedAt: consultation.lawyerEndedAt || new Date(),
      ...(typeof req.body?.summary === 'string' && req.body.summary.trim()
        ? { lawyerSummary: req.body.summary.trim().slice(0, 5000) } : {}),
    });

    res.json({ success: true, status: consultation.status, awaitingClientConfirmation: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/video/consultation/:id/extend — продлить идущую консультацию
// Доплата резервируется на эскроу юриста (в dev — тест-оплата; реальный Payme —
// Фаза 6). Только участник, только in_progress.
const EXTEND_MINUTES = [30];
router.post('/consultation/:id/extend', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [{ model: User, as: 'lawyer', include: [{ model: LawyerProfile, as: 'profile', attributes: ['price'] }] }],
    });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });
    requireSupportedCall(consultation);

    const isParticipant = consultation.clientId === req.userId || consultation.lawyerId === req.userId;
    if (!isParticipant) return res.status(403).json({ error: 'Access denied' });
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Продлить можно только идущую консультацию' });
    }

    const minutes = parseInt(req.body?.minutes, 10);
    if (!EXTEND_MINUTES.includes(minutes)) return res.status(400).json({ error: 'Допустимо продление на 30 минут' });

    // Доплата = базовая ставка юриста × минуты/60 (на сервере, клиенту не доверяем)
    const basePrice = consultation.lawyer?.profile?.price || 0;
    const addAmount = Math.round((basePrice * minutes) / 60);

    // Реальная оплата продления через Payme — Фаза 6; сейчас тест-режим.
    if (!extensionPaymentsAvailable()) {
      return res.status(501).json({ error: 'Оплата продления через Payme ещё не подключена', code: 'EXTENSION_PAYMENT_UNAVAILABLE' });
    }

    // Продление + резерв эскроу — в ОДНОЙ транзакции с блокировкой строки
    // консультации, чтобы конкурентные продления не искажали price/duration
    // и не задваивали резерв (SELECT ... FOR UPDATE через lock).
    let newDuration; let newPrice;
    await Consultation.sequelize.transaction(async (t) => {
      await availabilityService.lockBookingParticipants(consultation.lawyerId, consultation.clientId, t);
      const locked = await Consultation.findByPk(consultation.id, { lock: t.LOCK.UPDATE, transaction: t });
      // Внутри лока перепроверяем статус (мог измениться между проверкой и локом)
      if (!locked || locked.status !== 'in_progress') {
        const err = new Error('NOT_IN_PROGRESS');
        err.code = 'NOT_IN_PROGRESS';
        throw err;
      }
      newDuration = (locked.duration || 60) + minutes;
      if (![60, 90].includes(newDuration)) {
        const err = new Error('INVALID_EXTENSION_DURATION'); err.code = 'INVALID_EXTENSION_DURATION'; throw err;
      }
      const newEnd = new Date(new Date(locked.scheduledEndAt).getTime() + minutes * 60000);
      await availabilityService.assertAvailable({
        lawyerId: locked.lawyerId, clientId: locked.clientId,
        window: { start: DateTime.fromJSDate(locked.scheduledStartAt), end: DateTime.fromJSDate(newEnd) },
        excludeConsultationId: locked.id, transaction: t,
      });
      newPrice = (locked.price || 0) + addAmount;
      await locked.update({ duration: newDuration, scheduledEndAt: newEnd, price: newPrice }, { transaction: t });

      if (addAmount > 0) {
        await Payment.create({
          userId: locked.clientId,
          consultationId: locked.id,
          amount: addAmount,
          currency: 'UZS',
          provider: 'payme',
          status: 'paid',
          providerResponse: { test: true, extension: minutes, paidAt: Date.now() },
        }, { transaction: t });
        await LawyerProfile.increment('pendingBalance', { by: addAmount, where: { userId: locked.lawyerId }, transaction: t });
      }
    });

    res.json({
      success: true,
      minutes,
      addAmount,
      duration: newDuration,
      price: newPrice,
    });
  } catch (err) {
    if (err.code === 'NOT_IN_PROGRESS') {
      return res.status(400).json({ error: 'Продлить можно только идущую консультацию' });
    }
    if (err.code === 'INVALID_EXTENSION_DURATION') return res.status(409).json({ error: 'Максимальная длительность консультации — 90 минут' });
    if (err.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ error: 'Следующее время занято, продление невозможно', code: err.code });
    next(err);
  }
});

module.exports = router;
module.exports.extensionPaymentsAvailable = extensionPaymentsAvailable;
