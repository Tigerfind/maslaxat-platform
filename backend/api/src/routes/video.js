const router = require('express').Router();
const { Consultation, User, LawyerProfile, Payment } = require('../models');
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

// POST /api/video/consultation/:id/extend — продлить идущую консультацию
// Доплата резервируется на эскроу юриста (в dev — тест-оплата; реальный Payme —
// Фаза 6). Только участник, только in_progress.
const EXTEND_MINUTES = [15, 30];
router.post('/consultation/:id/extend', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [{ model: User, as: 'lawyer', include: [{ model: LawyerProfile, as: 'profile', attributes: ['price'] }] }],
    });
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    const isParticipant = consultation.clientId === req.userId || consultation.lawyerId === req.userId;
    if (!isParticipant) return res.status(403).json({ error: 'Access denied' });
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Продлить можно только идущую консультацию' });
    }

    let minutes = parseInt(req.body?.minutes, 10);
    if (!EXTEND_MINUTES.includes(minutes)) minutes = 15;

    // Доплата = базовая ставка юриста × минуты/60 (на сервере, клиенту не доверяем)
    const basePrice = consultation.lawyer?.profile?.price || 0;
    const addAmount = Math.round((basePrice * minutes) / 60);

    // Реальная оплата продления через Payme — Фаза 6; сейчас тест-режим.
    if (process.env.NODE_ENV === 'production' || process.env.PAYME_KEY) {
      return res.status(501).json({ error: 'Оплата продления через Payme ещё не подключена' });
    }

    // Продление + резерв эскроу — в ОДНОЙ транзакции с блокировкой строки
    // консультации, чтобы конкурентные продления не искажали price/duration
    // и не задваивали резерв (SELECT ... FOR UPDATE через lock).
    let newDuration; let newPrice;
    await Consultation.sequelize.transaction(async (t) => {
      const locked = await Consultation.findByPk(consultation.id, { lock: t.LOCK.UPDATE, transaction: t });
      // Внутри лока перепроверяем статус (мог измениться между проверкой и локом)
      if (!locked || locked.status !== 'in_progress') {
        const err = new Error('NOT_IN_PROGRESS');
        err.code = 'NOT_IN_PROGRESS';
        throw err;
      }
      newDuration = (locked.duration || 60) + minutes;
      newPrice = (locked.price || 0) + addAmount;
      await locked.update({ duration: newDuration, price: newPrice }, { transaction: t });

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
    next(err);
  }
});

module.exports = router;
