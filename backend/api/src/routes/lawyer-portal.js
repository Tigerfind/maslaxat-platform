const router = require('express').Router();
const { Op } = require('sequelize');
const multer = require('multer');
const path = require('path');
const { Consultation, User, LawyerProfile, Review, Notification, Payment } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { completeConsultation } = require('../services/escrow');

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

    // Map to the format the frontend expects
    const requests = consultations.map((c) => ({
      id: c.id,
      client: c.client ? {
        id: c.client.id,
        name: c.client.name,
        avatar: c.client.avatar,
      } : { id: null, name: 'Клиент', avatar: null },
      question: c.question,
      description: c.description,
      consultationType: c.type,
      preferredDate: c.preferredDate,
      preferredTime: c.preferredTime,
      status: c.status,
      createdAt: c.createdAt,
      price: c.price,
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

    consultation.status = 'accepted';
    if (req.body.responseMessage) {
      consultation.notes = req.body.responseMessage;
    }
    await consultation.save();

    // Notify client
    const lawyer = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyBookingAccepted(consultation.clientId, lawyer?.name || 'Юрист', consultation);

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

    consultation.status = 'rejected';
    if (req.body.reason) {
      consultation.notes = req.body.reason;
    }
    await consultation.save();

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

    consultation.status = 'accepted';
    await consultation.save();

    // Notify client
    const lawyerConfirm = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyBookingAccepted(consultation.clientId, lawyerConfirm?.name || 'Юрист', consultation);

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

    consultation.status = 'rejected';
    if (req.body.reason) consultation.notes = req.body.reason;
    await consultation.save();

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

    consultation.status = 'in_progress';
    await consultation.save();

    // Notify client that consultation started
    const lawyerStart = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyConsultationStarted(consultation.clientId, lawyerStart?.name || 'Юрист', consultation);

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

    res.json({ user, profile: user.profile });
  } catch (err) {
    next(err);
  }
});

// PUT /profile — update lawyer profile (all fields + optional avatar)
router.put('/profile', upload.single('avatar'), async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

    const {
      specialization,
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

    // Update LawyerProfile fields
    if (specialization !== undefined) profile.specialization = specialization;
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
      try { profile.schedule = typeof schedule === 'string' ? JSON.parse(schedule) : schedule; }
      catch { profile.schedule = {}; }
    }

    // After onboarding wizard completes — make profile visible
    if (description && experience && price) {
      profile.isAvailable = true;
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
      schedule: (profile && profile.schedule) || {},
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

    // Валидация времени HH:mm для включённых дней
    const clean = {};
    const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
    if (schedule && typeof schedule === 'object') {
      for (const [day, val] of Object.entries(schedule)) {
        if (!val || typeof val !== 'object') continue;
        clean[day] = {
          enabled: Boolean(val.enabled),
          from: isTime(val.from) ? val.from : '09:00',
          to: isTime(val.to) ? val.to : '18:00',
        };
      }
    }
    profile.schedule = clean;
    await profile.save();
    res.json({ success: true, schedule: profile.schedule });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
