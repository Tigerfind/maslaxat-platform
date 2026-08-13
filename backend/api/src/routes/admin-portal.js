const router = require('express').Router();
const { Op } = require('sequelize');
const fs = require('fs');
const { User, LawyerProfile, Consultation, Review, Specialization, SupportTicket, Promo, LawyerDocument, Withdrawal, Payment, FinancialEvent } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const { recomputeLawyerRating } = require('../services/ratingService');
const { withLawyerCounts } = require('../services/specializationStats');
const notifications = require('../services/notificationService');
const { computeProfileCompleteness } = require('../services/lawyerProfileCompleteness');

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

    // Текст и дату собирает фронт по текущему языку: раньше бэкенд отдавал готовые
    // русские строки и дату 'ru-RU', и админ с UZ/EN интерфейсом всё равно видел
    // «Новый юрист: …» и «12 авг.». Отсюда — только данные.
    const STATUS_TO_TYPE = {
      pending: 'consultation_pending',
      accepted: 'consultation_accepted',
      completed: 'consultation_completed',
      cancelled: 'consultation_cancelled',
    };

    const activity = recentConsultations.map((c) => ({
      type: STATUS_TO_TYPE[c.status] || 'consultation_other',
      status: c.status,
      clientName: c.client?.name || null,
      lawyerName: c.lawyer?.name || null,
      userName: c.client?.name || null,
      createdAt: c.createdAt,
      ts: new Date(c.createdAt).getTime(), // сырой timestamp для сортировки
    }));

    // Also add recent user registrations
    const recentUsers = await User.findAll({
      order: [['createdAt', 'DESC']],
      limit: 5,
      attributes: ['id', 'name', 'role', 'createdAt'],
    });

    recentUsers.forEach((u) => {
      activity.push({
        type: 'user_registration',
        role: u.role,
        userName: u.name,
        createdAt: u.createdAt,
        ts: new Date(u.createdAt).getTime(),
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

    // Счётчики считаем по ВСЕЙ таблице, а не по выданной странице: KPI-карточки
    // на фронте раньше брались из users.length и при limit=50 показывали «Всего: 50».
    const [{ count, rows }, all, clients, lawyers, blocked] = await Promise.all([
      User.findAndCountAll({
        where,
        attributes: ['id', 'name', 'email', 'role', 'isActive', 'isVerified', 'createdAt'],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      User.count(),
      User.count({ where: { role: 'client' } }),
      User.count({ where: { role: 'lawyer' } }),
      User.count({ where: { isActive: false } }),
    ]);

    res.json({
      users: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, clients, lawyers, blocked },
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
    const { verified, status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const where = { role: 'lawyer' };
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }
    // Фильтр по статусу модерации (на профиле). status — основной параметр
    // (pending/approved/rejected); verified=true/false оставлен для совместимости.
    const profileWhere = {};
    if (['pending', 'approved', 'rejected'].includes(status)) {
      profileWhere.verificationStatus = status;
    } else if (verified === 'true') {
      profileWhere.verificationStatus = 'approved';
    } else if (verified === 'false') {
      profileWhere.verificationStatus = 'pending';
    }

    // Счётчики очереди модерации — по всей таблице, а не по текущей странице.
    const [{ count, rows }, all, approved, pending, rejected] = await Promise.all([
      User.findAndCountAll({
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
      }),
      User.count({ where: { role: 'lawyer' } }),
      LawyerProfile.count({ where: { verificationStatus: 'approved' } }),
      LawyerProfile.count({ where: { verificationStatus: 'pending' } }),
      LawyerProfile.count({ where: { verificationStatus: 'rejected' } }),
    ]);

    const lawyers = await Promise.all(rows.map(async (lawyer) => ({
      ...lawyer.toJSON(),
      profileCompleteness: await computeProfileCompleteness(lawyer.id),
    })));

    res.json({
      lawyers,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, approved, pending, rejected },
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

    const completeness = await computeProfileCompleteness(user.id);
    if (!completeness.complete) {
      return res.status(400).json({
        error: 'Профиль юриста заполнен не полностью',
        missing: completeness.missing,
      });
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
    // lawyerCount из колонки — стухший литерал из сида (у всех «1»). Считаем реально,
    // тем же способом, что и публичный каталог.
    res.json(await withLawyerCounts(specializations));
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
    const oldName = specialization.name;
    const renaming = name !== undefined && name !== oldName;

    if (name !== undefined) specialization.name = name;
    if (nameUz !== undefined) specialization.nameUz = nameUz;
    if (nameEn !== undefined) specialization.nameEn = nameEn;
    if (icon !== undefined) specialization.icon = icon;
    if (isActive !== undefined) specialization.isActive = isActive;

    // Специализации хранятся у юристов строками без FK: простое переименование
    // молча осиротило бы все профили со старым названием (юрист выпадал из
    // фильтра каталога). Переносим их в одной транзакции с самим переименованием.
    let migratedProfiles = 0;
    await Specialization.sequelize.transaction(async (t) => {
      await specialization.save({ transaction: t });
      if (renaming) {
        const [affected] = await LawyerProfile.update(
          { specialization: name },
          { where: { specialization: oldName }, transaction: t }
        );
        migratedProfiles = affected;
        // Массив specializations — тот же перенос по элементу массива
        await LawyerProfile.sequelize.query(
          `UPDATE lawyer_profiles
             SET specializations = array_replace(specializations, :oldName, :newName)
           WHERE :oldName = ANY(specializations)`,
          { replacements: { oldName, newName: name }, transaction: t }
        );
      }
    });

    res.json({ ...specialization.toJSON(), migratedProfiles });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Специализация с таким названием уже существует' });
    }
    next(err);
  }
});

// DELETE /specializations/:id — delete
// Удаление используемой специализации осиротило бы профили юристов (FK нет),
// поэтому по умолчанию блокируем и сообщаем, скольких это затронет.
router.delete('/specializations/:id', async (req, res, next) => {
  try {
    const specialization = await Specialization.findByPk(req.params.id);
    if (!specialization) {
      return res.status(404).json({ error: 'Специализация не найдена' });
    }

    const inUse = await LawyerProfile.count({ where: { specialization: specialization.name } });
    if (inUse > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: `Специализация используется у ${inUse} юрист(ов). Переименуйте её или отключите вместо удаления.`,
        inUse,
      });
    }

    await specialization.destroy();
    res.json({ success: true, message: 'Специализация удалена', inUse });
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
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    // Раньше отдавались первые 100 без пагинации и фильтра: открытые обращения
    // тонули среди закрытых, а всё после 100-го было недостижимо.
    const where = {};
    if (['open', 'in_progress', 'closed'].includes(status)) where.status = status;

    const [{ count, rows }, all, open, inProgress, closed] = await Promise.all([
      SupportTicket.findAndCountAll({
        where,
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      SupportTicket.count(),
      SupportTicket.count({ where: { status: 'open' } }),
      SupportTicket.count({ where: { status: 'in_progress' } }),
      SupportTicket.count({ where: { status: 'closed' } }),
    ]);

    res.json({
      tickets: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, open, in_progress: inProgress, closed },
    });
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
    const { visibility, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    // Пагинация вместо жёсткого limit=100: после сотого отзыва модерация была слепа.
    const where = {};
    if (visibility === 'hidden') where.isHidden = true;
    if (visibility === 'visible') where.isHidden = false;

    const [{ count, rows }, all, hidden] = await Promise.all([
      Review.findAndCountAll({
        where,
        include: [
          { model: User, as: 'client', attributes: ['id', 'name'] },
          { model: User, as: 'lawyer', attributes: ['id', 'name'] },
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      Review.count(),
      Review.count({ where: { isHidden: true } }),
    ]);

    res.json({
      reviews: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, hidden, visible: all - hidden },
    });
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
    // Дата в прошлом молча создавала мёртвый код: promoService всегда отклонял бы его.
    if (expiresAt && new Date(expiresAt) < new Date(new Date().toDateString())) {
      return res.status(400).json({ error: 'Дата окончания не может быть в прошлом' });
    }
    if (minAmount != null && Number(minAmount) < 0) {
      return res.status(400).json({ error: 'Минимальная сумма не может быть отрицательной' });
    }
    if (usageLimit != null && usageLimit !== '' && Number(usageLimit) < 1) {
      return res.status(400).json({ error: 'Лимит использований должен быть не меньше 1' });
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
    if (minAmount != null) {
      if (Number(minAmount) < 0) return res.status(400).json({ error: 'Минимальная сумма не может быть отрицательной' });
      promo.minAmount = Number(minAmount) || 0;
    }
    if (usageLimit !== undefined) {
      const lim = usageLimit === '' || usageLimit === null ? null : Number(usageLimit);
      // Лимит ниже уже использованного количества сделал бы код мёртвым «задним числом».
      if (lim != null && lim < (promo.usedCount || 0)) {
        return res.status(400).json({ error: `Лимит нельзя опустить ниже уже использованных (${promo.usedCount})` });
      }
      promo.usageLimit = lim;
    }
    if (expiresAt !== undefined) {
      if (expiresAt && new Date(expiresAt) < new Date(new Date().toDateString())) {
        return res.status(400).json({ error: 'Дата окончания не может быть в прошлом' });
      }
      promo.expiresAt = expiresAt || null;
    }
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

// ─── ФИНАНСЫ: ЗАЯВКИ НА ВЫВОД ───────────────────────────────
//
// POST /payments/withdraw уже списывал баланс юриста и создавал Withdrawal со
// статусом pending, но обработать заявку было некому: ни эндпоинта, ни UI не
// существовало. Деньги списаны, заявка висит вечно. Ниже — недостающая половина.

// GET /admin/withdrawals — очередь выплат (фильтр по статусу, пагинация)
router.get('/withdrawals', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (['pending', 'processing', 'paid', 'failed', 'cancelled'].includes(status)) where.status = status;

    const [{ count, rows }, all, pending, processing, paid, pendingSum] = await Promise.all([
      Withdrawal.findAndCountAll({
        where,
        include: [{
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'email'],
          include: [{ model: LawyerProfile, as: 'profile', attributes: ['balance', 'pendingBalance'] }],
        }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      Withdrawal.count(),
      Withdrawal.count({ where: { status: 'pending' } }),
      Withdrawal.count({ where: { status: 'processing' } }),
      Withdrawal.count({ where: { status: 'paid' } }),
      // Сколько денег сейчас «заморожено» в необработанных заявках — главная
      // цифра для админа: столько он должен перевести.
      Withdrawal.sum('amount', { where: { status: { [Op.in]: ['pending', 'processing'] } } }),
    ]);

    res.json({
      withdrawals: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, pending, processing, paid, pendingAmount: Number(pendingSum) || 0 },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/withdrawals/:id — обработать заявку
//   paid                → деньги переведены вручную, баланс НЕ трогаем (он уже списан)
//   cancelled / failed  → возвращаем сумму на баланс юриста
router.patch('/withdrawals/:id', async (req, res, next) => {
  try {
    const { status, note, provider, providerTransactionId, providerReference, failureCode } = req.body;
    if (!['processing', 'paid', 'cancelled', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'Недопустимый статус заявки' });
    }

    const withdrawal = await Withdrawal.findByPk(req.params.id);
    if (!withdrawal) return res.status(404).json({ error: 'Заявка не найдена' });
    const allowedFrom = { processing: 'pending', cancelled: 'pending', paid: 'processing', failed: 'processing' };
    if (withdrawal.status !== allowedFrom[status]) return res.status(409).json({ error: `Недопустимый переход ${withdrawal.status} → ${status}` });
    if (['cancelled', 'failed'].includes(status) && !String(note || '').trim()) {
      return res.status(400).json({ error: 'Укажите причину отказа' });
    }
    if (status === 'paid' && (!String(providerTransactionId || '').trim() || !String(providerReference || '').trim())) {
      return res.status(400).json({ error: 'Для выплаты обязательны transaction ID и банковский reference' });
    }

    const amount = Number(withdrawal.amount) || 0;
    const refund = ['cancelled', 'failed'].includes(status);

    await Withdrawal.sequelize.transaction(async (t) => {
      const patch = {
        status,
        note: note ? String(note).slice(0, 500) : withdrawal.note,
        processedBy: req.userId,
      };
      if (status === 'processing') patch.processingAt = new Date();
      if (['paid', 'failed', 'cancelled'].includes(status)) patch.processedAt = new Date();
      if (status === 'paid') {
        patch.provider = String(provider || 'manual').slice(0, 30);
        patch.providerTransactionId = String(providerTransactionId).trim().slice(0, 150);
        patch.providerReference = String(providerReference).trim().slice(0, 150);
      }
      if (status === 'failed') {
        patch.failureCode = String(failureCode || 'manual_failure').slice(0, 80);
        patch.failureMessage = String(note).slice(0, 500);
      }

      // Условный UPDATE по ожидаемому статусу — защита от гонки двух админов.
      // второй получит affected=0 и не выполнит второй возврат.
      const [affected] = await Withdrawal.update(
        patch,
        { where: { id: withdrawal.id, status: allowedFrom[status] }, transaction: t }
      );
      if (affected === 0) {
        const err = new Error('ALREADY_PROCESSED');
        err.code = 'ALREADY_PROCESSED';
        throw err;
      }
      if (refund) {
        const [profileAffected] = await LawyerProfile.update(
          { balance: LawyerProfile.sequelize.literal(`balance + ${amount}`) },
          { where: { userId: withdrawal.lawyerId }, transaction: t }
        );
        if (profileAffected !== 1) throw new Error('Lawyer profile missing during withdrawal refund');
      }
      await FinancialEvent.create({
        withdrawalId: withdrawal.id,
        actorUserId: req.userId,
        source: 'admin',
        type: `withdrawal_${status}`,
        amount,
        idempotencyKey: `withdrawal_${status}:${withdrawal.id}`,
        metadata: { note: note || null, provider: provider || null, providerReference: providerReference || null },
      }, { transaction: t });
    }).catch((e) => {
      if (e.code === 'ALREADY_PROCESSED') {
        const err = new Error('Заявка уже обработана');
        err.status = 409;
        throw err;
      }
      throw e;
    });

    // Уведомляем юриста об исходе (best-effort — сбой уведомления не должен
    // откатывать уже проведённую операцию с деньгами).
    try {
      await notifications.createNotification(
        withdrawal.lawyerId,
        'withdrawal',
        status === 'paid' ? 'Выплата отправлена' : status === 'processing' ? 'Выплата обрабатывается' : 'Заявка на вывод отклонена',
        status === 'paid'
          ? `Выплата ${amount.toLocaleString('ru-RU')} сум отправлена.`
          : status === 'processing'
            ? `Заявка на ${amount.toLocaleString('ru-RU')} сум взята в обработку.`
          : `Заявка на ${amount.toLocaleString('ru-RU')} сум отклонена, сумма возвращена на баланс.${note ? ` Причина: ${note}` : ''}`,
        { withdrawalId: withdrawal.id, status },
      );
    } catch (e) { /* уведомление — не критично */ }

    const updated = await Withdrawal.findByPk(withdrawal.id);
    res.json({ success: true, withdrawal: updated, refunded: refund });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Такой ID банковской операции уже использован' });
    }
    next(err);
  }
});

// GET /admin/payments — журнал платежей (админ видел только сумму выручки)
router.get('/payments', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 25 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (['pending', 'paid', 'failed', 'refunded'].includes(status)) where.status = status;

    const [{ count, rows }, all, paidCount, paidSum] = await Promise.all([
      Payment.findAndCountAll({
        where,
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset,
      }),
      Payment.count(),
      Payment.count({ where: { status: 'paid', refundStatus: 'none' } }),
      Payment.sum('amount', { where: { status: 'paid', refundStatus: 'none' } }),
    ]);

    res.json({
      payments: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
      counts: { all, paid: paidCount, paidAmount: Number(paidSum) || 0 },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
