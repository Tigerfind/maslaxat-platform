const router = require('express').Router();
const { Op, fn, col } = require('sequelize');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { DateTime, IANAZone } = require('luxon');
const {
  sequelize, Consultation, User, LawyerProfile, LawyerExperience, LawyerEducation,
  LawyerCertificate, LawyerProfileStatusHistory, Review, Notification, Payment,
  LawyerDocument, Message,
} = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { completeConsultation, refundConsultationEscrow } = require('../services/escrow');
const zoomMeetingService = require('../services/zoomMeetingService');
const { computeProfileCompleteness } = require('../services/lawyerProfileCompleteness');
const { scheduleMeetsMinimum } = require('../services/schedulePolicy');

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
const invalidScheduleDays = (schedule) => Object.entries(schedule)
  .filter(([, value]) => value.enabled && value.from >= value.to)
  .map(([day]) => day);

const cleanText = (value, max = 2000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const validLinkedInUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname.toLowerCase())
      || !/^\/in\/[^/]+\/?$/.test(url.pathname)) return false;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return false; }
};
const validDateRange = (start, end, current = false) => {
  const from = DateTime.fromISO(String(start || ''));
  if (!from.isValid) return false;
  if (current) return !end;
  const to = DateTime.fromISO(String(end || ''));
  return to.isValid && to >= from;
};

// Avatar upload config (reuse same setup as users.js)
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `avatar-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Поддерживаются только изображения (jpg, png, webp)'));
  },
});

// Загрузка верификационных документов (диплом/лицензия/удостоверение) — PDF + картинки.
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = `verif-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});
const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExt.includes(ext) && allowedMime.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Поддерживаются PDF и изображения (jpg, png, webp)'));
  },
});
const VERIF_DOC_TYPES = ['diploma', 'license', 'certificate', 'id', 'other'];

// All routes require lawyer authentication
router.use(authenticate, authorize('lawyer'));

// ─── CONSULTATION REQUESTS ──────────────────────────────────

// GET /consultation-requests — pending booking requests for this lawyer
router.get('/consultation-requests', async (req, res, next) => {
  try {
    const { status = 'all' } = req.query;

    const where = { lawyerId: req.userId };
    if (status !== 'all') {
      where.status = status;
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

    const wasAlreadyAccepted = consultation.status === 'accepted';
    if (!wasAlreadyAccepted) {
      const [affected] = await Consultation.update(
        { status: 'accepted', acceptedAt: new Date() },
        { where: { id: consultation.id, status: { [Op.in]: ACCEPTABLE_FROM } } }
      );
      if (affected === 0) return res.status(400).json({ error: 'Запрос нельзя принять в текущем статусе' });
      await consultation.reload();
    }

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
      if (consultation.meetingProvider === 'zoom') zoomMeetingService.maybeProvision(consultation.id).catch(() => {});
    }

    res.json({ success: true, message: 'Запрос принят', consultation });
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
        transaction: tx, actorUserId: req.userId, source: 'lawyer', reason: req.body.reason,
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

    res.json({ success: true, message: 'Запрос отклонён', consultation });
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
      meetingProvider: c.meetingProvider,
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
    const wasAlreadyAccepted = consultation.status === 'accepted';
    if (!wasAlreadyAccepted) {
      const [affected] = await Consultation.update(
        { status: 'accepted', acceptedAt: new Date() },
        { where: { id: consultation.id, status: { [Op.in]: ACCEPTABLE_FROM } } }
      );
      if (affected === 0) return res.status(400).json({ error: 'Консультацию нельзя подтвердить в текущем статусе' });
      await consultation.reload();
    }

    if (!wasAlreadyAccepted) {
      const lawyerConfirm = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyBookingAccepted(consultation.clientId, lawyerConfirm?.name || 'Юрист', consultation);
      if (consultation.meetingProvider === 'zoom') zoomMeetingService.maybeProvision(consultation.id).catch(() => {});
    }

    res.json({ success: true, message: 'Консультация подтверждена', consultation });
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
        transaction: tx, actorUserId: req.userId, source: 'lawyer', reason: req.body.reason,
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

    res.json({ success: true, message: 'Консультация отклонена', consultation });
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
      const [affected] = await Consultation.update(
        { status: 'in_progress' },
        { where: { id: consultation.id, status: { [Op.in]: STARTABLE_FROM } } }
      );
      if (affected === 0) return res.status(400).json({ error: 'Начать можно только подтверждённую консультацию' });
      await consultation.reload();
      const lawyerStart = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyConsultationStarted(consultation.clientId, lawyerStart?.name || 'Юрист', consultation);
    } else if (consultation.status !== 'in_progress') {
      return res.status(400).json({ error: 'Начать можно только подтверждённую консультацию' });
    }

    res.json({ success: true, message: 'Консультация начата', consultation });
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

    res.json({ success: true, message: 'Консультация завершена', consultation: updated });
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

    res.json(consultation);
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
    const [experiences, educations, certificates, statusHistory] = await Promise.all([
      LawyerExperience.findAll({ where: { userId: req.userId }, order: [['displayOrder', 'ASC']] }),
      LawyerEducation.findAll({ where: { userId: req.userId }, order: [['displayOrder', 'ASC']] }),
      LawyerCertificate.findAll({ where: { userId: req.userId }, order: [['displayOrder', 'ASC']] }),
      LawyerProfileStatusHistory.findAll({ where: { lawyerProfileId: user.profile?.id }, order: [['createdAt', 'DESC']], limit: 20 }),
    ]);
    res.json({ user, profile: profileOut, experiences, educations, certificates, statusHistory });
  } catch (err) {
    next(err);
  }
});

// PATCH /profile/draft — server-backed autosave for the professional profile wizard.
router.patch('/profile/draft', async (req, res, next) => {
  try {
    const body = req.body || {};
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

    const experienceYears = Number(body.experience);
    const price = Number(body.price);
    const step = Number(body.step);
    if (body.experience !== undefined && (!Number.isInteger(experienceYears) || experienceYears < 0 || experienceYears > 80)) {
      return res.status(400).json({ error: 'Некорректный общий стаж' });
    }
    if (body.price !== undefined && (!Number.isInteger(price) || price < 0 || price > 10000000)) {
      return res.status(400).json({ error: 'Некорректная стоимость консультации' });
    }
    if (body.timezone !== undefined && !IANAZone.isValidZone(body.timezone)) {
      return res.status(400).json({ error: 'Некорректный часовой пояс' });
    }
    const linkedIn = body.linkedinUrl !== undefined ? validLinkedInUrl(body.linkedinUrl) : undefined;
    if (linkedIn === false) return res.status(400).json({ error: 'Укажите ссылку вида https://www.linkedin.com/in/...' });
    if (body.phone !== undefined && !/^\+998\d{9}$/.test(String(body.phone).replace(/\s/g, ''))) {
      return res.status(400).json({ error: 'Телефон должен быть в формате +998XXXXXXXXX' });
    }
    const formats = body.consultationFormats;
    if (formats !== undefined && (!Array.isArray(formats)
      || formats.some((format) => !['chat', 'audio', 'webrtc', 'zoom'].includes(format)))) {
      return res.status(400).json({ error: 'Некорректные форматы консультации' });
    }
    const durations = body.consultationDurations;
    if (durations !== undefined && (!Array.isArray(durations)
      || durations.some((duration) => ![30, 60, 90].includes(Number(duration))))) {
      return res.status(400).json({ error: 'Допустимая длительность: 30, 60 или 90 минут' });
    }
    const experiences = body.experiences;
    if (experiences !== undefined && (!Array.isArray(experiences) || experiences.some((item) => (
      !cleanText(item.organization, 255) || !cleanText(item.position, 255)
      || !validDateRange(item.startDate, item.endDate, item.isCurrent)
    )))) return res.status(400).json({ error: 'Проверьте даты и обязательные поля опыта работы' });
    const educations = body.educations;
    const currentYear = new Date().getFullYear() + 10;
    if (educations !== undefined && (!Array.isArray(educations) || educations.some((item) => (
      !cleanText(item.university, 255) || !cleanText(item.specialty, 255)
      || (item.startYear && (item.startYear < 1900 || item.startYear > currentYear))
      || (item.endYear && (item.endYear < Number(item.startYear || 1900) || item.endYear > currentYear))
    )))) return res.status(400).json({ error: 'Проверьте данные образования' });
    const certificates = body.certificates;
    if (certificates !== undefined && (!Array.isArray(certificates) || certificates.length > 30 || certificates.some((item) => (
      !cleanText(item.title, 255) || (item.credentialUrl && (() => {
        try { return new URL(item.credentialUrl).protocol !== 'https:'; } catch { return true; }
      })())
    )))) {
      return res.status(400).json({ error: 'Название сертификата обязательно' });
    }
    if (experiences?.length > 30 || educations?.length > 20) return res.status(400).json({ error: 'Слишком много записей в резюме' });
    if (body.languages !== undefined && (!Array.isArray(body.languages) || body.languages.length > 10)) {
      return res.status(400).json({ error: 'Некорректный список языков' });
    }
    const normalizedSchedule = body.schedule !== undefined ? normalizeSchedule(body.schedule) : undefined;
    if (normalizedSchedule && invalidScheduleDays(normalizedSchedule).length) {
      return res.status(400).json({ error: 'Время окончания приёма должно быть позже времени начала' });
    }

    await sequelize.transaction(async (transaction) => {
      const lockedProfile = await LawyerProfile.findByPk(profile.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (body.name !== undefined || body.phone !== undefined) {
        await User.update({
          ...(body.name !== undefined ? { name: cleanText(body.name, 180) } : {}),
          ...(body.phone !== undefined ? { phone: String(body.phone).replace(/\s/g, '') } : {}),
        }, { where: { id: req.userId }, transaction });
      }
      const fields = {
        professionalTitle: body.professionalTitle,
        description: body.description,
        location: body.location,
        region: body.region,
        linkedinUrl: linkedIn,
        licenseNumber: body.licenseNumber,
        licenseIssuer: body.licenseIssuer,
        licenseIssuedAt: Object.prototype.hasOwnProperty.call(body, 'licenseIssuedAt') ? (body.licenseIssuedAt || null) : undefined,
        licenseExpiresAt: Object.prototype.hasOwnProperty.call(body, 'licenseExpiresAt') ? (body.licenseExpiresAt || null) : undefined,
        timezone: body.timezone,
        consultationFormats: formats,
        consultationDurations: durations?.map(Number),
        experience: body.experience !== undefined ? experienceYears : undefined,
        price: body.price !== undefined ? price : undefined,
        languages: body.languages,
        schedule: normalizedSchedule,
        onboardingStep: Number.isInteger(step) ? Math.max(0, Math.min(5, step)) : undefined,
      };
      if (body.specializations !== undefined) {
        const specializations = [...new Set((Array.isArray(body.specializations) ? body.specializations : [])
          .map((value) => cleanText(value, 120)).filter(Boolean))].slice(0, 12);
        fields.specializations = specializations;
        fields.specialization = specializations[0] || 'Не указана';
      }
      if (educations !== undefined) lockedProfile.education = educations.map((item) => ({
        university: cleanText(item.university, 255), specialty: cleanText(item.specialty, 255),
        degree: cleanText(item.degree, 120), startYear: item.startYear || null, endYear: item.endYear || null,
      }));
      if (certificates !== undefined) lockedProfile.certificates = certificates.map((item) => ({
        title: cleanText(item.title, 255), organization: cleanText(item.organization, 255), issuedAt: item.issuedAt || null,
      }));
      Object.entries(fields).forEach(([key, value]) => { if (value !== undefined) lockedProfile[key] = value; });
      if (lockedProfile.verificationStatus !== 'draft') {
        const fromStatus = lockedProfile.verificationStatus;
        lockedProfile.verificationStatus = 'draft';
        lockedProfile.verificationSubmittedAt = null;
        lockedProfile.isAvailable = false;
        await LawyerProfileStatusHistory.create({
          lawyerProfileId: lockedProfile.id, actorUserId: req.userId, fromStatus, toStatus: 'draft',
          metadata: { source: 'profile_edit' },
        }, { transaction });
      }
      await lockedProfile.save({ transaction });

      const replaceRows = async (Model, rows, mapper) => {
        if (rows === undefined) return;
        await Model.destroy({ where: { userId: req.userId }, transaction });
        if (rows.length) await Model.bulkCreate(rows.map((row, index) => ({ userId: req.userId, displayOrder: index, ...mapper(row) })), { transaction });
      };
      await replaceRows(LawyerExperience, experiences, (item) => ({
        organization: cleanText(item.organization, 255), position: cleanText(item.position, 255),
        startDate: item.startDate, endDate: item.isCurrent ? null : item.endDate,
        isCurrent: Boolean(item.isCurrent), description: cleanText(item.description, 3000),
      }));
      await replaceRows(LawyerEducation, educations, (item) => ({
        university: cleanText(item.university, 255), faculty: cleanText(item.faculty, 255),
        specialty: cleanText(item.specialty, 255), degree: cleanText(item.degree, 120),
        startYear: item.startYear || null, endYear: item.endYear || null,
        country: cleanText(item.country, 120), city: cleanText(item.city, 120),
      }));
      await replaceRows(LawyerCertificate, certificates, (item) => ({
        title: cleanText(item.title, 255), organization: cleanText(item.organization, 255),
        issuedAt: item.issuedAt || null, credentialUrl: cleanText(item.credentialUrl, 1000) || null,
      }));
    });

    const updated = await LawyerProfile.findOne({ where: { userId: req.userId } });
    return res.json({ success: true, savedAt: new Date().toISOString(), profile: updated });
  } catch (err) {
    return next(err);
  }
});

router.get('/profile/preview', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, {
      attributes: ['id', 'name', 'avatar'],
      include: [
        { model: LawyerProfile, as: 'profile' },
        { model: LawyerExperience, as: 'lawyerExperiences', separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerEducation, as: 'lawyerEducations', separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerCertificate, as: 'lawyerCertificates', separate: true, order: [['displayOrder', 'ASC']] },
      ],
    });
    if (!user) return res.status(404).json({ error: 'Профиль не найден' });
    return res.json({ lawyer: user });
  } catch (error) {
    return next(error);
  }
});

// PUT /profile — update lawyer profile (all fields + optional avatar)
router.put('/profile', upload.single('avatar'), async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

    const {
      specialization,
      specializations,
      description,
      greeting,
      experience,
      price,
      location,
      languages,
      education,
      certificates,
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
    if (schedule !== undefined) {
      let parsed;
      try { parsed = typeof schedule === 'string' ? JSON.parse(schedule) : schedule; }
      catch { parsed = {}; }
      profile.schedule = normalizeSchedule(parsed); // единый формат {enabled,from,to}
    }

    if (profile.verificationStatus !== 'draft') {
      const fromStatus = profile.verificationStatus;
      profile.verificationStatus = 'draft';
      profile.verificationSubmittedAt = null;
      profile.isAvailable = false;
      await LawyerProfileStatusHistory.create({
        lawyerProfileId: profile.id,
        actorUserId: req.userId,
        fromStatus,
        toStatus: 'draft',
        metadata: { source: 'legacy_profile_edit' },
      });
    }

    await profile.save();

    // Update avatar on User model if file uploaded
    if (req.file) {
      const avatarUrl = `/uploads/${req.file.filename}`;
      await User.update({ avatar: avatarUrl }, { where: { id: req.userId } });
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

    const normalized = normalizeSchedule(schedule);
    if (invalidScheduleDays(normalized).length) return res.status(400).json({ error: 'Время окончания приёма должно быть позже времени начала' });
    if (profile.verificationStatus === 'approved' && profile.schedulePolicyAcceptedAt && !scheduleMeetsMinimum(normalized)) {
      return res.status(400).json({ error: 'Для одобренного профиля требуется минимум 3 получасовых слота в неделю', code: 'SCHEDULE_MINIMUM_REQUIRED' });
    }
    profile.schedule = normalized;
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
      attributes: ['id', 'type', 'name', 'mimeType', 'size', 'createdAt'],
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
    const doc = await LawyerDocument.create({
      userId: req.userId,
      type,
      name: req.file.originalname,
      path: req.file.path,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
    res.status(201).json({
      document: { id: doc.id, type: doc.type, name: doc.name, mimeType: doc.mimeType, size: doc.size, createdAt: doc.createdAt },
    });
  } catch (err) {
    next(err);
  }
});

// GET /verification-documents/:id/download — скачать/просмотреть свой документ
router.get('/verification-documents/:id/download', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!doc || !doc.path || !fs.existsSync(doc.path)) {
      return res.status(404).json({ error: 'Документ не найден' });
    }
    res.download(doc.path, doc.name);
  } catch (err) {
    next(err);
  }
});

// DELETE /verification-documents/:id — удалить свой документ (файл + запись)
router.delete('/verification-documents/:id', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!doc) return res.status(404).json({ error: 'Документ не найден' });
    // Удаляем файл с диска (не валим запрос, если файла уже нет)
    if (doc.path) { try { fs.unlinkSync(doc.path); } catch (e) { /* файл мог быть удалён */ } }
    await doc.destroy();
    const [remaining, verifiedRemaining] = await Promise.all([
      LawyerDocument.count({ where: { userId: req.userId } }),
      LawyerDocument.count({ where: { userId: req.userId, verifiedAt: { [Op.ne]: null } } }),
    ]);
    if (remaining === 0 || (doc.verifiedAt && verifiedRemaining === 0)) {
      await sequelize.transaction(async (transaction) => {
        const profile = await LawyerProfile.findOne({ where: { userId: req.userId }, transaction, lock: transaction.LOCK.UPDATE });
        if (profile && ['pending_review', 'approved'].includes(profile.verificationStatus)) {
          const fromStatus = profile.verificationStatus;
          await profile.update({ verificationStatus: 'draft', verificationSubmittedAt: null, isAvailable: false }, { transaction });
          await LawyerProfileStatusHistory.create({
            lawyerProfileId: profile.id, actorUserId: req.userId, fromStatus, toStatus: 'draft',
            metadata: { source: 'verification_document_removed' },
          }, { transaction });
        }
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /verification/checklist — что осталось заполнить перед отправкой на проверку.
router.get('/verification/checklist', async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['verificationStatus'] });
    const completeness = await computeProfileCompleteness(req.userId);
    res.json({ ...completeness, verificationStatus: profile ? profile.verificationStatus : 'draft' });
  } catch (err) {
    next(err);
  }
});

// POST /verification/submit — отправить профиль на проверку (после регистрации/отклонения).
// Переводит статус в pending. Одобренного не трогаем (нечего пересматривать).
// ГЕЙТ ПОЛНОТЫ: нельзя отправить неполный профиль — админ получает только готовые заявки.
router.post('/verification/submit', async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
    if (profile.verificationStatus === 'approved') return res.status(400).json({ error: 'Профиль уже одобрен' });
    if (profile.verificationStatus === 'pending_review') return res.status(409).json({ error: 'Профиль уже ожидает проверки' });
    if (profile.verificationStatus === 'suspended') return res.status(403).json({ error: 'Профиль приостановлен администратором' });
    const { complete, missing, scheduleSlots, requiredScheduleSlots } = await computeProfileCompleteness(req.userId);
    if (!complete) {
      return res.status(400).json({ error: 'Профиль заполнен не полностью', missing, scheduleSlots, requiredScheduleSlots });
    }
    const fromStatus = profile.verificationStatus;
    await sequelize.transaction(async (transaction) => {
      profile.verificationStatus = 'pending_review';
      profile.verificationSubmittedAt = new Date();
      profile.rejectionReason = null;
      await profile.save({ transaction });
      await LawyerProfileStatusHistory.create({
        lawyerProfileId: profile.id,
        actorUserId: req.userId,
        fromStatus,
        toStatus: 'pending_review',
        metadata: { source: 'lawyer_submission' },
      }, { transaction });
    });

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

module.exports = router;
