const router = require('express').Router();
const { Op } = require('sequelize');
const { User, LawyerProfile, Consultation, Review, Specialization } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

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
        date: new Date(u.createdAt).toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    });

    // Sort by date (newest first) and limit
    activity.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(activity.slice(0, parseInt(limit)));
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
    if (verified === 'true') where.isVerified = true;
    if (verified === 'false') where.isVerified = false;

    const { count, rows } = await User.findAndCountAll({
      where,
      include: [{ model: LawyerProfile, as: 'profile' }],
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
    });
    if (!user) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    user.isVerified = true;
    user.isActive = true;
    await user.save();

    res.json({ success: true, message: 'Юрист одобрен', user });
  } catch (err) {
    next(err);
  }
});

// POST /lawyers/:id/reject — reject lawyer
router.post('/lawyers/:id/reject', async (req, res, next) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
    });
    if (!user) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    user.isVerified = false;
    user.isActive = false;
    await user.save();

    res.json({ success: true, message: 'Юрист отклонён', user });
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

module.exports = router;
