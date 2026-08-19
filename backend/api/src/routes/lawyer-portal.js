const express = require('express');
const crypto = require('crypto');
const { Op, fn, col } = require('sequelize');
const { sequelize, Consultation, User, LawyerProfile, Review, Notification, Payment, LawyerDocument, Message } = require('../models');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const {
  profileFieldSnapshot,
  applyManualProfileChangePolicy,
  invalidateDocumentProvenance,
} = require('../services/profileImportService');
const { completeConsultation, refundConsultationEscrow } = require('../services/escrow');
const { toConsultationDto } = require('../services/consultationDto');
const { createMemoryUpload } = require('../middleware/fileUpload');
const { getFileStorageService } = require('../services/fileStorageRuntime');
const { streamFile } = require('../services/fileHttpService');
const { FILE_LIMITS, uploadLimitFor } = require('../config/fileLimits');
const { registerUuidParams } = require('../middleware/uuidParams');

// Источники-статусы, из которых юрист вправе делать переход (машина состояний).
// Запрещаем откат из completed/in_progress назад — это ломало «выплата один раз».
const ACCEPTABLE_FROM = ['pending']; // принять/подтвердить можно только новую заявку
const REJECTABLE_FROM = ['payment_pending', 'pending', 'accepted']; // до начала сессии
const STARTABLE_FROM = ['accepted']; // начать можно только подтверждённую

// Канонический формат недельного расписания: { mon:{enabled,from,to}, …, sun:{…} }.
// Приводим к нему ЛЮБОЙ вход — и старый {start,end}/присутствие-ключа-=-активен
// (онбординг, редактор профиля), и {enabled,from,to} (редактор «Часы приёма») —
// чтобы часы совпадали во всех редакторах (раньше форматы клобберили друг друга в
// одной колонке profile.schedule).
const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const isHHmm = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function normalizeSchedule(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const day of SCHEDULE_DAYS) {
    const v = src[day];
    if (!v || typeof v !== 'object') { out[day] = { enabled: false, from: '09:00', to: '18:00' }; continue; }
    const enabled = 'enabled' in v ? Boolean(v.enabled) : true; // старый формат: присутствие = включён
    const from = isHHmm(v.from) ? v.from : (isHHmm(v.start) ? v.start : '09:00');
    const to = isHHmm(v.to) ? v.to : (isHHmm(v.end) ? v.end : '18:00');
    out[day] = { enabled, from, to };
  }
  return out;
}

const upload = createMemoryUpload({
  types: ['jpeg', 'png', 'webp'],
  maxBytes: uploadLimitFor('avatar'),
});

// Загрузка верификационных документов (диплом/лицензия/удостоверение) — PDF + картинки.
const docUpload = createMemoryUpload({
  types: ['pdf', 'jpeg', 'png', 'webp'],
  maxBytes: uploadLimitFor('lawyer'),
});
const VERIF_DOC_TYPES = ['diploma', 'license', 'id', 'other'];

function avatarRecord(user) {
  if (!user?.avatarStorageKey) return null;
  return {
    storageProvider: user.avatarStorageProvider,
    storageKey: user.avatarStorageKey,
    mimeType: user.avatarMimeType,
    size: user.avatarSize,
    sha256: user.avatarSha256,
    path: user.avatarLocalPath || null,
  };
}

function createLawyerPortalRouter({ fileStorageService = getFileStorageService() } = {}) {
const router = express.Router();
registerUuidParams(router, 'id');

async function deleteVerificationDocument(doc) {
  const destroy = async ({ transaction }) => {
    const profile = await LawyerProfile.findOne({
      where: { userId: doc.userId }, transaction, lock: transaction.LOCK.UPDATE,
    });
    const locked = await LawyerDocument.findOne({
      where: { id: doc.id, userId: doc.userId }, transaction, lock: transaction.LOCK.UPDATE,
    });
    if (!locked) return;
    if (profile) {
      await invalidateDocumentProvenance({
        userId: doc.userId,
        documentId: doc.id,
        transaction,
        lockedProfile: profile,
      });
    }
    await locked.destroy({ transaction });
  };
  if (doc.storageKey) return fileStorageService.delete({ record: doc, destroy });
  return sequelize.transaction((transaction) => destroy({ transaction }));
}

const applicantAccess = authorizeCompat({
  legacyRoles: ['lawyer'], capability: 'lawyerApplicant', telemetryName: 'http.lawyer-applicant',
});
const operationalAccess = authorizeCompat({
  legacyRoles: ['lawyer'], capability: 'lawyer', telemetryName: 'http.lawyer',
});
const APPLICANT_PATHS = [
  /^\/profile\/?$/,
  /^\/verification-documents(?:\/|$)/,
  /^\/verification(?:\/|$)/,
];

// Applicants may prepare and submit a profile, but all consultation, money,
// schedule, review, availability, notification, and status routes are operational.
const portalAccess = (req, res, next) => {
  const guard = APPLICANT_PATHS.some((pattern) => pattern.test(req.path))
    ? applicantAccess
    : operationalAccess;
  return guard(req, res, next);
};
portalAccess.authorizationGuard = {
  legacyRoles: ['lawyer'], modes: ['client', 'lawyer', 'admin'], stage: null,
};
router.use(authenticate, portalAccess);

// ─── CONSULTATION REQUESTS ──────────────────────────────────

// GET /consultation-requests — pending booking requests for this lawyer
router.get('/consultation-requests', async (req, res, next) => {
  try {
    const { status = 'all' } = req.query;

    const where = { lawyerId: req.userId, status: { [Op.ne]: 'payment_pending' } };
    if (status !== 'all') {
      where.status = status === 'payment_pending' ? { [Op.ne]: 'payment_pending' } : status;
    }

    const consultations = await Consultation.findAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar', 'email', 'phone'] },
      ],
      order: [['createdAt', 'DESC']],
    });

    // История клиента: сколько ЗАВЕРШЁННЫХ консультаций у него было с ЭТИМ юристом
    // (одним запросом, без N+1). Юристу удобно видеть постоянных клиентов.
    const clientIds = [...new Set(consultations.map((c) => c.clientId).filter(Boolean))];
    let repeatByClient = {};
    if (clientIds.length) {
      const rows = await Consultation.findAll({
        where: { lawyerId: req.userId, clientId: { [Op.in]: clientIds }, status: 'completed' },
        attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
        group: ['clientId'], raw: true,
      });
      repeatByClient = Object.fromEntries(rows.map((r) => [r.clientId, Number(r.cnt)]));
    }

    // Map to the format the frontend expects
    const requests = consultations.map((c) => ({
      id: c.id,
      client: c.client ? {
        id: c.client.id,
        name: c.client.name,
        avatar: c.client.avatar,
      } : { id: null, name: 'Клиент', avatar: null },
      question: c.question,
      problems: Array.isArray(c.problems) && c.problems.length ? c.problems : [c.question],
      specialization: c.specialization || null,
      description: c.description,
      consultationType: c.type,
      preferredDate: c.preferredDate,
      preferredTime: c.preferredTime,
      status: c.status,
      createdAt: c.createdAt,
      price: c.price,
      // Сколько завершённых консультаций у этого клиента было с данным юристом (0 = новый).
      repeatCount: repeatByClient[c.clientId] || 0,
      // Приватная заметка юриста по делу.
      lawyerNote: c.lawyerNote || '',
    }));

    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// POST /consultation-requests/:id/accept — accept a booking request
router.post('/consultation-requests/:id/accept', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Запрос не найден' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Источник-гейт: принять можно только новую заявку (pending). Повторный вызов на
    // уже принятой — идемпотентный no-op; из completed/in_progress/rejected — нельзя.
    if (![...ACCEPTABLE_FROM, 'accepted'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Запрос нельзя принять в текущем статусе' });
    }
    const wasAlreadyAccepted = consultation.status === 'accepted';

    consultation.status = 'accepted';
    await consultation.save();

    // Приветствие юриста при принятии → уходит клиенту первым сообщением в чат
    // (НЕ перезаписываем notes клиента). Маскируем контакты (anti-churn, как в чате).
    if (!wasAlreadyAccepted && req.body.responseMessage && String(req.body.responseMessage).trim()) {
      const welcome = String(req.body.responseMessage).trim().slice(0, 2000)
        .replace(/(\+?998[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g, '***')
        .replace(/(\+?\d{10,13})/g, '***')
        .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '***');
      try { await Message.create({ consultationId: consultation.id, senderId: req.userId, text: welcome }); }
      catch (e) { /* сообщение best-effort, не валим принятие */ }
    }

    // Уведомляем только при реальном переходе pending → accepted (не при повторе)
    if (!wasAlreadyAccepted) {
      const lawyer = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyBookingAccepted(consultation.clientId, lawyer?.name || 'Юрист', consultation);
    }

    res.json({
      success: true,
      message: 'Запрос принят',
      consultation: toConsultationDto(consultation, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /consultation-requests/:id/reject — reject a booking request
router.post('/consultation-requests/:id/reject', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Запрос не найден' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Атомарно: источник-гейт (только до начала сессии) + перевод в rejected +
    // возврат удержанного эскроу клиенту — в одной транзакции. Reject недостижим для
    // completed/in_progress, поэтому возврат всегда идёт из pendingBalance (не balance).
    const rejected = await Consultation.sequelize.transaction(async (tx) => {
      const [affected] = await Consultation.update(
        { status: 'rejected', ...(req.body.reason ? { notes: req.body.reason } : {}) },
        { where: { id: consultation.id, status: { [Op.in]: REJECTABLE_FROM } }, transaction: tx }
      );
      if (affected === 0) return null;
      await refundConsultationEscrow(consultation.id, {
        transaction: tx,
        requestedBy: req.userId,
        reason: req.body.reason || 'lawyer_rejected_consultation',
      });
      return true;
    });
    if (!rejected) {
      return res.status(400).json({ error: 'Заявку нельзя отклонить в текущем статусе' });
    }
    await consultation.reload();

    // Notify client
    const lawyerForReject = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyBookingRejected(consultation.clientId, lawyerForReject?.name || 'Юрист', consultation);

    res.json({
      success: true,
      message: 'Запрос отклонён',
      consultation: toConsultationDto(consultation, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── CONSULTATIONS MANAGEMENT ───────────────────────────────

// GET /consultations/pending — pending consultations
router.get('/consultations/pending', async (req, res, next) => {
  try {
    const consultations = await Consultation.findAll({
      where: {
        lawyerId: req.userId,
        status: { [Op.in]: ['accepted', 'pending'] },
      },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
      ],
      order: [['preferredDate', 'ASC'], ['preferredTime', 'ASC']],
      limit: 20,
    });

    // Map to the format the frontend expects
    const mapped = consultations.map((c) => ({
      id: c.id,
      clientName: c.client?.name || 'Клиент',
      clientAvatar: c.client?.avatar,
      topic: c.question,
      date: c.preferredDate,
      time: c.preferredTime,
      type: c.type,
      status: c.status,
      price: c.price,
    }));

    res.json(mapped);
  } catch (err) {
    next(err);
  }
});

// POST /consultations/:id/confirm — confirm (alias for accept)
router.post('/consultations/:id/confirm', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Источник-гейт (как в accept): подтвердить можно только pending; повтор на
    // accepted — no-op; из completed/in_progress/rejected — нельзя (без отката).
    if (![...ACCEPTABLE_FROM, 'accepted'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Консультацию нельзя подтвердить в текущем статусе' });
    }
    const wasAlreadyAccepted = consultation.status === 'accepted';

    consultation.status = 'accepted';
    await consultation.save();

    if (!wasAlreadyAccepted) {
      const lawyerConfirm = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyBookingAccepted(consultation.clientId, lawyerConfirm?.name || 'Юрист', consultation);
    }

    res.json({
      success: true,
      message: 'Консультация подтверждена',
      consultation: toConsultationDto(consultation, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /consultations/:id/reject — reject consultation
router.post('/consultations/:id/reject', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Атомарно: источник-гейт (только до начала сессии) + rejected + возврат эскроу.
    const rejected = await Consultation.sequelize.transaction(async (tx) => {
      const [affected] = await Consultation.update(
        { status: 'rejected', ...(req.body.reason ? { notes: req.body.reason } : {}) },
        { where: { id: consultation.id, status: { [Op.in]: REJECTABLE_FROM } }, transaction: tx }
      );
      if (affected === 0) return null;
      await refundConsultationEscrow(consultation.id, {
        transaction: tx,
        requestedBy: req.userId,
        reason: req.body.reason || 'lawyer_rejected_consultation',
      });
      return true;
    });
    if (!rejected) {
      return res.status(400).json({ error: 'Консультацию нельзя отклонить в текущем статусе' });
    }
    await consultation.reload();

    // Notify client
    const lawyerReject2 = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyBookingRejected(consultation.clientId, lawyerReject2?.name || 'Юрист', consultation);

    res.json({
      success: true,
      message: 'Консультация отклонена',
      consultation: toConsultationDto(consultation, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /consultations/:id/start — start a consultation
router.post('/consultations/:id/start', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Источник-гейт: начать можно ТОЛЬКО подтверждённую (accepted). Идемпотентно, если
    // уже in_progress. Запрет старта из completed убирает revert-примитив (повторную
    // выплату эскроу через start→end по уже завершённой консультации).
    if (STARTABLE_FROM.includes(consultation.status)) {
      consultation.status = 'in_progress';
      await consultation.save();
      const lawyerStart = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyConsultationStarted(consultation.clientId, lawyerStart?.name || 'Юрист', consultation);
    } else if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Начать можно только подтверждённую консультацию' });
    }

    res.json({
      success: true,
      message: 'Консультация начата',
      consultation: toConsultationDto(consultation, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /consultations/:id/end — end a consultation
router.post('/consultations/:id/end', async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    // ДЕНЬГИ: юрист высвобождает эскроу только по РЕАЛЬНО начатой консультации
    // (нельзя принять оплату и сразу «завершить», не проведя сессию). Клиент
    // подтверждает завершение своим путём (/complete).
    if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Сначала начните консультацию, затем завершайте' });
    }

    // Единый идемпотентный путь: завершение + высвобождение эскроу
    const { consultation: updated } = await completeConsultation(consultation.id, req.body.notes);

    // Notify client that consultation completed
    const lawyerEnd = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyConsultationCompleted(updated.clientId, lawyerEnd?.name || 'Юрист', updated);

    res.json({
      success: true,
      message: 'Консультация завершена',
      consultation: toConsultationDto(updated, { perspective: 'lawyer' }),
    });
  } catch (err) {
    next(err);
  }
});

// GET /consultations/:id — consultation details
router.get('/consultations/:id', async (req, res, next) => {
  try {
    const consultation = await Consultation.findOne({
      where: { id: req.params.id, lawyerId: req.userId },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar', 'email', 'phone'] },
      ],
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    res.json(toConsultationDto(consultation, { perspective: 'lawyer' }));
  } catch (err) {
    next(err);
  }
});

// PUT /consultations/:id/note — приватная заметка юриста по делу (только своя консультация).
router.put('/consultations/:id/note', async (req, res, next) => {
  try {
    const consultation = await Consultation.findOne({ where: { id: req.params.id, lawyerId: req.userId } });
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    const note = typeof req.body.note === 'string' ? req.body.note.slice(0, 5000) : '';
    consultation.lawyerNote = note || null;
    await consultation.save();
    res.json({ success: true, lawyerNote: consultation.lawyerNote || '' });
  } catch (err) {
    next(err);
  }
});

// ─── SCHEDULE ───────────────────────────────────────────────

// GET /schedule — lawyer's consultations grouped by date
router.get('/schedule', async (req, res, next) => {
  try {
    const { year, month } = req.query;

    const where = {
      lawyerId: req.userId,
      status: { [Op.in]: ['pending', 'accepted', 'in_progress'] },
    };

    // Filter by month if provided
    if (year && month) {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const endMonth = parseInt(month) + 1;
      const endYear = endMonth > 12 ? parseInt(year) + 1 : year;
      const endMonthStr = endMonth > 12 ? '01' : String(endMonth).padStart(2, '0');
      const endDate = `${endYear}-${endMonthStr}-01`;

      where.preferredDate = { [Op.gte]: startDate, [Op.lt]: endDate };
    }

    const consultations = await Consultation.findAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
      ],
      order: [['preferredDate', 'ASC'], ['preferredTime', 'ASC']],
    });

    // Group by date
    const events = {};
    consultations.forEach((c) => {
      const dateKey = c.preferredDate;
      if (!events[dateKey]) events[dateKey] = [];
      events[dateKey].push({
        id: c.id,
        time: c.preferredTime,
        client: c.client?.name || 'Клиент',
        clientAvatar: c.client?.avatar,
        topic: c.question,
        type: c.type,
        status: c.status,
        price: c.price,
      });
    });

    res.json({ events });
  } catch (err) {
    next(err);
  }
});

// ─── REVIEWS ────────────────────────────────────────────────

// GET /reviews — all reviews for this lawyer
router.get('/reviews', async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await Review.findAndCountAll({
      where: { lawyerId: req.userId },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    // Compute rating distribution
    const allReviews = await Review.findAll({
      where: { lawyerId: req.userId },
      attributes: ['rating'],
    });

    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let total = 0;
    allReviews.forEach((r) => {
      distribution[r.rating] = (distribution[r.rating] || 0) + 1;
      total += r.rating;
    });

    const average = allReviews.length > 0 ? Math.round((total / allReviews.length) * 10) / 10 : 0;

    res.json({
      reviews: rows.map((r) => ({
        id: r.id,
        clientName: r.client?.name || 'Клиент',
        clientAvatar: r.client?.avatar,
        rating: r.rating,
        comment: r.text,
        date: r.createdAt,
        reply: r.replyText || null,
        repliedAt: r.repliedAt || null,
        helpful: r.helpfulCount || 0,
      })),
      stats: {
        average,
        total: allReviews.length,
        distribution,
      },
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /reviews/recent — recent reviews (for dashboard)
router.get('/reviews/recent', async (req, res, next) => {
  try {
    const { limit = 3 } = req.query;

    const reviews = await Review.findAll({
      where: { lawyerId: req.userId },
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
    });

    res.json(
      reviews.map((r) => ({
        id: r.id,
        clientName: r.client?.name || 'Клиент',
        rating: r.rating,
        comment: r.text,
        date: r.createdAt,
        reply: r.replyText || null,
        repliedAt: r.repliedAt || null,
        helpful: r.helpfulCount || 0,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// POST /reviews/:id/reply — reply to review
router.post('/reviews/:id/reply', async (req, res, next) => {
  try {
    const review = await Review.findByPk(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }
    if (review.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const reply = typeof req.body.reply === 'string' ? req.body.reply.trim() : '';
    if (!reply) {
      return res.status(400).json({ error: 'Ответ не может быть пустым' });
    }

    review.replyText = reply.slice(0, 2000);
    review.repliedAt = new Date();
    await review.save();

    res.json({ success: true, message: 'Ответ добавлен' });
  } catch (err) {
    next(err);
  }
});

// POST /reviews/:id/helpful — mark review as helpful
router.post('/reviews/:id/helpful', async (req, res, next) => {
  try {
    const review = await Review.findByPk(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Отзыв не найден' });
    }
    // Нельзя накручивать «полезность» собственному отзыву
    if (review.lawyerId === req.userId) {
      return res.status(403).json({ error: 'Нельзя отмечать свой отзыв' });
    }

    review.helpfulCount = (review.helpfulCount || 0) + 1;
    await review.save();

    res.json({ success: true, helpfulCount: review.helpfulCount });
  } catch (err) {
    next(err);
  }
});

// ─── NOTIFICATIONS ──────────────────────────────────────────

// GET /notifications — get lawyer notifications
router.get('/notifications', async (req, res, next) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json(notifications);
  } catch (err) {
    next(err);
  }
});

// PUT /notifications/:id/read — mark notification as read
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    notification.isRead = true;
    await notification.save();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PUT /notifications/read-all — mark all notifications as read
router.put('/notifications/read-all', async (req, res, next) => {
  try {
    await Notification.update(
      { isRead: true },
      { where: { userId: req.userId, isRead: false } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── PROFILE ─────────────────────────────────────────────────

// GET /profile — get lawyer's own profile
router.get('/profile', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, {
      attributes: ['id', 'name', 'email', 'phone', 'avatar', 'isVerified'],
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    // Отдаём расписание в каноническом формате (совместимо с редактором «Часы приёма»)
    const profileOut = user.profile
      ? { ...user.profile.toJSON(), schedule: normalizeSchedule(user.profile.schedule) }
      : null;
    res.json({ user, profile: profileOut });
  } catch (err) {
    next(err);
  }
});

// PUT /profile — update lawyer profile (all fields + optional avatar)
router.put('/profile', upload.single('avatar'), async (req, res, next) => {
  try {
    const expectedRevision = Number(req.body.profileRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return res.status(400).json({
        error: 'Укажите актуальную версию профиля',
        code: 'PROFILE_REVISION_REQUIRED',
      });
    }
    await sequelize.transaction(async (transaction) => {
    await User.findByPk(req.userId, { transaction, lock: transaction.LOCK.UPDATE });
    const profile = await LawyerProfile.findOne({
      where: { userId: req.userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!profile) {
      const error = new Error('Профиль не найден');
      error.status = 404;
      error.code = 'PROFILE_NOT_FOUND';
      throw error;
    }
    if (profile.revision !== expectedRevision) {
      const error = new Error('Профиль был изменён');
      error.status = 409;
      error.code = 'PROFILE_REVISION_CONFLICT';
      error.details = { currentProfileRevision: profile.revision };
      throw error;
    }
    const profileBefore = profileFieldSnapshot(profile);

    const {
      specialization,
      specializations,
      description,
      headline,
      greeting,
      experience,
      price,
      location,
      languages,
      education,
      certificates,
      workExperience,
      linkedinUrl,
      schedule,
    } = req.body;

    // Специализации: принимаем массив (мультивыбор) ИЛИ одиночную строку (legacy).
    // Нормализуем: обрезаем, дедуп, максимум 12; specialization = первая (совместимость).
    let specsArr;
    if (specializations !== undefined) {
      try { specsArr = typeof specializations === 'string' ? JSON.parse(specializations) : specializations; }
      catch { specsArr = [specializations]; }
    } else if (specialization !== undefined) {
      specsArr = [specialization];
    }
    if (specsArr !== undefined) {
      const clean = [...new Set(
        (Array.isArray(specsArr) ? specsArr : [specsArr])
          .map((s) => (typeof s === 'string' ? s.trim() : ''))
          .filter(Boolean),
      )].slice(0, 12);
      if (clean.length) {
        profile.specializations = clean;
        profile.specialization = clean[0]; // держим синхронно с массивом
      }
    }
    if (description !== undefined) profile.description = description;
    if (headline !== undefined) profile.headline = typeof headline === 'string' ? headline.trim().slice(0, 300) : null;
    // Автоприветствие: обрезаем до 1000 символов, пустую строку → null
    if (greeting !== undefined) {
      const g = typeof greeting === 'string' ? greeting.trim() : '';
      profile.greeting = g ? g.slice(0, 1000) : null;
    }
    if (experience !== undefined) profile.experience = parseInt(experience, 10) || 0;
    if (price !== undefined) profile.price = parseInt(price, 10) || 0;
    if (location !== undefined) profile.location = location;

    // Parse JSON fields sent as strings (from multipart form)
    if (languages !== undefined) {
      try { profile.languages = typeof languages === 'string' ? JSON.parse(languages) : languages; }
      catch { profile.languages = [languages]; }
    }
    if (education !== undefined) {
      try { profile.education = typeof education === 'string' ? JSON.parse(education) : education; }
      catch { profile.education = []; }
    }
    if (certificates !== undefined) {
      try { profile.certificates = typeof certificates === 'string' ? JSON.parse(certificates) : certificates; }
      catch { profile.certificates = []; }
    }
    if (workExperience !== undefined) {
      try { profile.workExperience = typeof workExperience === 'string' ? JSON.parse(workExperience) : workExperience; }
      catch { profile.workExperience = []; }
    }
    if (linkedinUrl !== undefined) {
      try {
        profile.linkedinUrl = linkedinUrl;
      } catch (_error) {
        const error = new Error('Invalid LinkedIn profile URL');
        error.status = 400;
        error.code = 'INVALID_LINKEDIN_URL';
        throw error;
      }
    }
    if (schedule !== undefined) {
      let parsed;
      try { parsed = typeof schedule === 'string' ? JSON.parse(schedule) : schedule; }
      catch { parsed = {}; }
      profile.schedule = normalizeSchedule(parsed); // единый формат {enabled,from,to}
    }

    // After onboarding wizard completes — make profile visible
    if (description && experience && price) {
      profile.isAvailable = true;
    }

    applyManualProfileChangePolicy(profile, profileBefore);

    const changed = profile.changed() || [];
    if (changed.length) {
      const values = Object.fromEntries(changed.map((field) => [field, profile.getDataValue(field)]));
      const [updated] = await LawyerProfile.update(values, {
        where: { id: profile.id, revision: expectedRevision },
        transaction,
      });
      if (updated !== 1) {
        const error = new Error('Профиль был изменён');
        error.status = 409;
        error.code = 'PROFILE_REVISION_CONFLICT';
        throw error;
      }
    }

    });

    if (req.file) {
      const fileId = crypto.randomUUID();
      let oldRecord;
      const updatedAvatarUser = await fileStorageService.store({
        kind: 'avatar', scopeId: req.userId, fileId,
        body: req.file.buffer, mimeType: req.file.mimetype,
        persist: async ({ transaction, metadata }) => {
          const locked = await User.findByPk(req.userId, {
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!locked) {
            const error = new Error('Пользователь не найден');
            error.status = 404;
            throw error;
          }
          oldRecord = avatarRecord(locked);
          await locked.update({
            avatar: `/api/users/${locked.id}/avatar`,
            avatarStorageProvider: metadata.storageProvider,
            avatarStorageKey: metadata.storageKey,
            avatarMimeType: metadata.mimeType,
            avatarSize: metadata.size,
            avatarSha256: metadata.sha256,
            avatarLocalPath: metadata.path,
          }, { transaction });
          return locked;
        },
      });
      if (oldRecord && oldRecord.storageKey !== updatedAvatarUser.avatarStorageKey) {
        await fileStorageService.delete({ record: oldRecord, destroy: async () => undefined });
      }
    }

    // Return updated data
    const updatedUser = await User.findByPk(req.userId, {
      attributes: ['id', 'name', 'email', 'phone', 'avatar', 'isVerified'],
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    res.json({ success: true, user: updatedUser, profile: updatedUser.profile });
  } catch (err) {
    next(err);
  }
});

// ─── STATUS ─────────────────────────────────────────────────

// PUT /status — update lawyer online/offline status
router.put('/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    const isAvailable = status === 'online';

    await LawyerProfile.update(
      { isAvailable },
      { where: { userId: req.userId } }
    );

    res.json({ success: true, status, isAvailable });
  } catch (err) {
    next(err);
  }
});

// ─── WEEKLY AVAILABILITY SLOTS ──────────────────────────────
// Формат schedule: { mon:{enabled,from,to}, tue:{...}, ..., sun:{...} }

// GET /availability — текущие недельные слоты доступности
router.get('/availability', async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    res.json({
      schedule: normalizeSchedule(profile && profile.schedule),
      isAvailable: profile ? profile.isAvailable : true,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /availability — сохранить недельные слоты
router.put('/availability', async (req, res, next) => {
  try {
    const { schedule } = req.body;
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

    profile.schedule = normalizeSchedule(schedule); // единый формат + валидация HH:mm
    await profile.save();
    res.json({ success: true, schedule: profile.schedule });
  } catch (err) {
    next(err);
  }
});

// ─── ВЕРИФИКАЦИОННЫЕ ДОКУМЕНТЫ (диплом/лицензия/удостоверение) ───
// Видны только самому юристу и админу. Не публично, не клиентам.

// GET /verification-documents — список своих документов (без пути на диске)
router.get('/verification-documents', async (req, res, next) => {
  try {
    const docs = await LawyerDocument.findAll({
      where: { userId: req.userId },
      attributes: ['id', 'type', 'name', 'mimeType', 'size', 'verificationStatus', 'approvedAt', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// POST /verification-documents — загрузить документ (multipart: file + type)
router.post('/verification-documents', docUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const type = VERIF_DOC_TYPES.includes(req.body.type) ? req.body.type : 'other';
    const id = crypto.randomUUID();
    const doc = await fileStorageService.store({
      kind: 'lawyer', scopeId: req.userId, fileId: id,
      body: req.file.buffer, mimeType: req.file.mimetype,
      persist: ({ transaction, metadata }) => LawyerDocument.create({
        id,
        userId: req.userId,
        type,
        name: req.file.originalname,
        ...metadata,
      }, { transaction }),
    });
    res.status(201).json({
      document: {
        id: doc.id, type: doc.type, name: doc.name, mimeType: doc.mimeType, size: doc.size,
        verificationStatus: doc.verificationStatus, approvedAt: doc.approvedAt, createdAt: doc.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /verification-documents/:id/download — скачать/просмотреть свой документ
router.get('/verification-documents/:id/download', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await streamFile({
      storage: fileStorageService, req, res, record: doc, filename: doc.name,
      maxBytes: FILE_LIMITS.lawyer,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /verification-documents/:id — удалить свой документ (файл + запись)
router.delete('/verification-documents/:id', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    await deleteVerificationDocument(doc);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Полнота профиля юриста для отправки на проверку. Возвращает список того, чего не хватает
// (стабильные слаги — фронт мапит в подписи). Пустой список = профиль готов к проверке.
async function computeProfileCompleteness(userId) {
  const [profile, docCount] = await Promise.all([
    LawyerProfile.findOne({ where: { userId } }),
    LawyerDocument.count({ where: { userId } }),
  ]);
  const missing = [];
  // Фото — желательно, но не блокирует (клиент видит инициалы; онбординг не требует фото).
  if (!profile || !profile.description || String(profile.description).trim().length < 50) missing.push('description');
  if (!profile || !(Number(profile.price) >= 50000)) missing.push('price');
  const specs = (Array.isArray(profile?.specializations) && profile.specializations.length)
    ? profile.specializations
    : (profile?.specialization ? [profile.specialization] : []);
  if (specs.length === 0) missing.push('specialization');
  const sched = profile && profile.schedule;
  const hasDay = sched && typeof sched === 'object' && Object.values(sched).some((d) => d && d.enabled);
  if (!hasDay) missing.push('schedule');
  if (docCount < 1) missing.push('documents');
  return { complete: missing.length === 0, missing };
}

// GET /verification/checklist — что осталось заполнить перед отправкой на проверку.
router.get('/verification/checklist', async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['verificationStatus'] });
    const { complete, missing } = await computeProfileCompleteness(req.userId);
    res.json({ complete, missing, verificationStatus: profile ? profile.verificationStatus : 'pending' });
  } catch (err) {
    next(err);
  }
});

// POST /verification/submit — отправить профиль на проверку (после регистрации/отклонения).
// Переводит статус в pending. Одобренного не трогаем (нечего пересматривать).
// ГЕЙТ ПОЛНОТЫ: нельзя отправить неполный профиль — админ получает только готовые заявки.
router.post('/verification/submit', async (req, res, next) => {
  try {
    if (!req.user.twoFactorEnabled || !req.user.twoFactorSecret) {
      return res.status(403).json({ error: 'Включите 2FA перед отправкой профиля', code: 'TWO_FACTOR_REQUIRED' });
    }
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
    if (profile.verificationStatus === 'approved') {
      return res.status(400).json({ error: 'Профиль уже одобрен' });
    }
    const { complete, missing } = await computeProfileCompleteness(req.userId);
    if (!complete) {
      return res.status(400).json({ error: 'Профиль заполнен не полностью', missing });
    }
    profile.verificationStatus = 'pending';
    profile.rejectionReason = null;
    await profile.save();

    // Уведомляем всех админов, что появился юрист на проверке (fail-safe).
    try {
      const me = await User.findByPk(req.userId, { attributes: ['name'] });
      const admins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
      await Promise.all(admins.map((a) => notificationService.createNotification(
        a.id,
        'verification_request',
        'Юрист на проверке',
        `${me?.name || 'Юрист'} отправил профиль и документы на проверку.`,
        { lawyerId: req.userId },
      )));
    } catch (e) { /* notification is best-effort */ }

    res.json({ success: true, verificationStatus: profile.verificationStatus });
  } catch (err) {
    next(err);
  }
});

return router;
}

module.exports = createLawyerPortalRouter;
