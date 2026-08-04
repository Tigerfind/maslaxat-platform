const router = require('express').Router();
const { Op } = require('sequelize');
const fs = require('fs');
const { User, LawyerProfile, Consultation, Review, Specialization, SupportTicket, Promo, LawyerDocument } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const { recomputeLawyerRating } = require('../services/ratingService');
const notifications = require('../services/notificationService');

// All routes require admin authentication
router.use(authenticate, authorize('admin'));

// ─── RECENT ACTIVITY ────────────────────────────────────────

// GET /activity/recent — recent platform activity
router.get('/activity/recent', async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    // Gather recent consultations as activity
    const recentConsultations = await Consultation.findAll({
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
    });

    const activity = recentConsultations.map((c) => {
      let type = 'consultation_completed';
      let description = '';

      if (c.status === 'pending') {
        type = 'consultation_pending';
        description = `Новый запрос на консультацию от ${c.client?.name || 'клиента'}`;
      } else if (c.status === 'accepted') {
        type = 'consultation_accepted';
        description = `Консультация принята юристом ${c.lawyer?.name || ''}`;
      } else if (c.status === 'completed') {
        type = 'consultation_completed';
        description = `Консультация завершена: ${c.client?.name || 'клиент'} — ${c.lawyer?.name || 'юрист'}`;
      } else if (c.status === 'cancelled') {
        type = 'consultation_cancelled';
        description = `Консультация отменена`;
      } else {
        description = `Консультация: ${c.client?.name || 'клиент'} — ${c.lawyer?.name || 'юрист'} (${c.status})`;
      }

      return {
        type,
        description,
        userName: c.client?.name || 'Пользователь',
        ts: new Date(c.createdAt).getTime(), // сырой timestamp для сортировки
        date: new Date(c.createdAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    });

    // Also add recent user registrations
    const recentUsers = await User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'role', 'createdAt'],
    });

    recentUsers.forEach((u) => {
      activity.push({
        type: 'user_registration',
        description: `Новый ${u.role === 'lawyer' ? 'юрист' : 'клиент'}: ${u.name}`,
        userName: u.name,
        ts: new Date(u.createdAt).getTime(),
        date: new Date(u.createdAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    });

    // Sort by raw timestamp (newest first) — раньше сортировали по локализованной строке (NaN)
    activity.sort((a, b) => b.ts - a.ts);

    // ts — служебное поле для сортировки, наружу не отдаём
    res.json(activity.slice(0, parseInt(limit)).map(({ ts, ...rest }) => rest));
  } catch (err) {
    next(err);
  }
});

// ─── USERS MANAGEMENT ───────────────────────────────────────

// GET /users — list all users
router.get('/users', async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (role) where.role = role;
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'isVerified', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      users: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /users/:id — user details
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PUT /users/:id/status — toggle active/blocked
router.put('/users/:id/status', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    user.isActive = req.body.status === 'active';
    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// ─── LAWYERS MANAGEMENT ─────────────────────────────────────

// GET /lawyers — list all lawyers with profiles
router.get('/lawyers', async (req, res, next) => {
  try {
    const { verified, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = { role: 'lawyer' };
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
    }
    // Фильтр по статусу модерации (на профиле). verified=true → одобренные,
    // verified=false → на проверке (очередь для админа).
    const profileWhere = {};
    if (verified === 'true') profileWhere.verificationStatus = 'approved';
    if (verified === 'false') profileWhere.verificationStatus = 'pending';

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [{
        model: LawyerProfile,
        as: 'profile',
        where: Object.keys(profileWhere).length ? profileWhere : undefined,
        required: Object.keys(profileWhere).length > 0,
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      lawyers: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /lawyers/:id/approve — approve lawyer verification
router.post('/lawyers/:id/approve', async (req, res, next) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    if (!user || !user.profile) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    // Модерация — на профиле; user.isActive держим true (isActive = блокировка).
    user.profile.verificationStatus = 'approved';
    user.profile.rejectionReason = null;
    await user.profile.save();
    if (!user.isActive) { user.isActive = true; await user.save(); }

    // Уведомляем юриста об одобрении (fail-safe: ошибка уведомления не валит запрос)
    try {
      await notifications.createNotification(
        user.id,
        'verification',
        'Профиль одобрен',
        'Поздравляем! Ваш профиль прошёл проверку — теперь вы видны клиентам в каталоге.',
      );
    } catch (e) { /* notification is best-effort */ }

    res.json({ success: true, message: 'Юрист одобрен', user });
  } catch (err) {
    next(err);
  }
});

// POST /lawyers/:id/reject — reject lawyer (с причиной)
router.post('/lawyers/:id/reject', async (req, res, next) => {
  try {
    const reason = (req.body && typeof req.body.reason === 'string') ? req.body.reason.trim().slice(0, 500) : '';
    const user = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });
    if (!user || !user.profile) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    // Отклонение убирает из каталога, но НЕ блокирует аккаунт — юрист может
    // исправить документы и подать снова (isActive трогаем только при блокировке).
    user.profile.verificationStatus = 'rejected';
    user.profile.rejectionReason = reason || null;
    await user.profile.save();

    try {
      await notifications.createNotification(
        user.id,
        'verification',
        'Профиль отклонён',
        reason
          ? `Профиль не прошёл проверку: ${reason}. Исправьте и подайте снова.`
          : 'Профиль не прошёл проверку. Проверьте данные и документы и подайте снова.',
      );
    } catch (e) { /* notification is best-effort */ }

    res.json({ success: true, message: 'Юрист отклонён', user });
  } catch (err) {
    next(err);
  }
});

// GET /lawyers/:id/verification-documents — верификационные документы юриста (для проверки)
router.get('/lawyers/:id/verification-documents', async (req, res, next) => {
  try {
    const docs = await LawyerDocument.findAll({
      where: { userId: req.params.id },
      attributes: ['id', 'type', 'name', 'mimeType', 'size', 'createdAt'],
      order: [['createdAt', 'DESC']],
    });
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

// GET /lawyers/:id/verification-documents/:docId/download — скачать файл документа (только админ)
router.get('/lawyers/:id/verification-documents/:docId/download', async (req, res, next) => {
  try {
    const doc = await LawyerDocument.findOne({
      where: { id: req.params.docId, userId: req.params.id },
    });
    if (!doc || !doc.path || !fs.existsSync(doc.path)) {
      return res.status(404).json({ error: 'Документ не найден' });
    }
    res.download(doc.path, doc.name);
  } catch (err) {
    next(err);
  }
});

// ─── SPECIALIZATIONS ────────────────────────────────────────

// GET /specializations — list all
router.get('/specializations', async (req, res, next) => {
  try {
    const specializations = await Specialization.findAll({
      order: [['name', 'ASC']],
    });
    res.json(specializations);
  } catch (err) {
    next(err);
  }
});

// POST /specializations — create
router.post('/specializations', async (req, res, next) => {
  try {
    const { name, nameUz, nameEn, icon } = req.body;
    const specialization = await Specialization.create({
      name,
      nameUz: nameUz || null,
      nameEn: nameEn || null,
      icon: icon || 'Gavel',
    });
    res.status(201).json(specialization);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Специализация с таким названием уже существует' });
    }
    next(err);
  }
});

// PUT /specializations/:id — update
router.put('/specializations/:id', async (req, res, next) => {
  try {
    const specialization = await Specialization.findByPk(req.params.id);
    if (!specialization) {
      return res.status(404).json({ error: 'Специализация не найдена' });
    }

    const { name, nameUz, nameEn, icon, isActive } = req.body;
    if (name !== undefined) specialization.name = name;
    if (nameUz !== undefined) specialization.nameUz = nameUz;
    if (nameEn !== undefined) specialization.nameEn = nameEn;
    if (icon !== undefined) specialization.icon = icon;
    if (isActive !== undefined) specialization.isActive = isActive;
    await specialization.save();

    res.json(specialization);
  } catch (err) {
    next(err);
  }
});

// DELETE /specializations/:id — delete
router.delete('/specializations/:id', async (req, res, next) => {
  try {
    const specialization = await Specialization.findByPk(req.params.id);
    if (!specialization) {
      return res.status(404).json({ error: 'Специализация не найдена' });
    }

    await specialization.destroy();
    res.json({ success: true, message: 'Специализация удалена' });
  } catch (err) {
    next(err);
  }
});

// ─── CONSULTATIONS MONITORING ───────────────────────────────

// GET /consultations — all consultations
router.get('/consultations', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status && status !== 'all') where.status = status;

    const { count, rows } = await Consultation.findAndCountAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'email'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'email'],
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

// ─── SUPPORT TICKETS (управление) ───────────────────────────
// GET /admin/support — список обращений
router.get('/support', async (req, res, next) => {
  try {
    const tickets = await SupportTicket.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    res.json(tickets);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/support/:id — сменить статус и/или ответить автору обращения
router.patch('/support/:id', async (req, res, next) => {
  try {
    const { status, response } = req.body;
    if (status !== undefined && !['open', 'in_progress', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }
    if (status === undefined && !(typeof response === 'string' && response.trim())) {
      return res.status(400).json({ error: 'Укажите статус или ответ' });
    }
    const ticket = await SupportTicket.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });

    let responded = false;
    if (typeof response === 'string' && response.trim()) {
      ticket.response = response.trim();
      ticket.respondedAt = new Date();
      if (status === undefined) ticket.status = 'closed'; // ответ по умолчанию закрывает тикет
      responded = true;
    }
    if (status !== undefined) ticket.status = status;
    await ticket.save();

    // Уведомляем автора обращения, что поддержка ответила (in-app + web-push)
    if (responded && ticket.userId) {
      const notificationService = require('../services/notificationService');
      notificationService.createNotification(
        ticket.userId,
        'support_reply',
        'Ответ поддержки',
        ticket.response.slice(0, 140),
        { ticketId: ticket.id }
      ).catch(() => {});
    }

    res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
});

// ─── REVIEWS (модерация) ────────────────────────────────────
// GET /admin/reviews — все отзывы (с автором и юристом)
router.get('/reviews', async (req, res, next) => {
  try {
    const reviews = await Review.findAll({
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/reviews/:id — скрыть/показать отзыв (+ пересчёт рейтинга юриста)
router.patch('/reviews/:id', async (req, res, next) => {
  try {
    const review = await Review.findByPk(req.params.id);
    if (!review) return res.status(404).json({ error: 'Отзыв не найден' });
    review.isHidden = Boolean(req.body.isHidden);
    await review.save();
    // Скрытые отзывы не влияют на рейтинг — пересчитываем
    await recomputeLawyerRating(review.lawyerId);
    res.json({ success: true, review });
  } catch (err) {
    next(err);
  }
});

// ─── PROMO CODES (CRUD) ─────────────────────────────────────
// GET /admin/promos — список промокодов
router.get('/promos', async (req, res, next) => {
  try {
    const promos = await Promo.findAll({ order: [['createdAt', 'DESC']] });
    res.json(promos);
  } catch (err) {
    next(err);
  }
});

// POST /admin/promos — создать промокод
router.post('/promos', async (req, res, next) => {
  try {
    const { code, discountPercent, minAmount, usageLimit, expiresAt, isActive } = req.body;
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'Укажите код' });
    const pct = Number(discountPercent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return res.status(400).json({ error: 'Скидка должна быть от 1 до 100%' });
    }
    const [promo, created] = await Promo.findOrCreate({
      where: { code: String(code).trim().toUpperCase() },
      defaults: {
        code: String(code).trim().toUpperCase(),
        discountPercent: pct,
        minAmount: Number(minAmount) || 0,
        usageLimit: usageLimit != null && usageLimit !== '' ? Number(usageLimit) : null,
        expiresAt: expiresAt || null,
        isActive: isActive !== false,
      },
    });
    if (!created) return res.status(409).json({ error: 'Такой промокод уже существует' });
    res.status(201).json(promo);
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/promos/:id — изменить (в т.ч. включить/выключить)
router.patch('/promos/:id', async (req, res, next) => {
  try {
    const promo = await Promo.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    const { discountPercent, minAmount, usageLimit, expiresAt, isActive } = req.body;
    if (discountPercent != null) {
      const pct = Number(discountPercent);
      if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
        return res.status(400).json({ error: 'Скидка должна быть от 1 до 100%' });
      }
      promo.discountPercent = pct;
    }
    if (minAmount != null) promo.minAmount = Number(minAmount) || 0;
    if (usageLimit !== undefined) promo.usageLimit = usageLimit === '' || usageLimit === null ? null : Number(usageLimit);
    if (expiresAt !== undefined) promo.expiresAt = expiresAt || null;
    if (isActive != null) promo.isActive = Boolean(isActive);
    await promo.save();
    res.json(promo);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/promos/:id — удалить
router.delete('/promos/:id', async (req, res, next) => {
  try {
    const promo = await Promo.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    await promo.destroy();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
