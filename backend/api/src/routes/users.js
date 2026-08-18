const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const { Op } = require('sequelize');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailService');
const logger = require('../config/logger');
const { disconnectUserSockets } = require('../socket/io');

// Avatar upload config
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
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Поддерживаются только изображения (jpg, png, webp)'));
    }
  },
});

// PUT /api/users/profile — update user profile
router.put('/profile', authenticate, upload.single('avatar'), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Update allowed fields
    const { name, phone, address } = req.body;
    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) user.phone = phone;
    if (address !== undefined) user.address = address;

    // Avatar upload
    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
    }

    await user.save();

    res.json({ user: user.toJSON() });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/password — change password
router.put('/password', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }

    // Verify old password
    const isValid = await user.comparePassword(oldPassword);
    if (!isValid) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }

    // Update password (hook will hash it) + инвалидируем ранее выданные токены.
    user.password = newPassword;
    user.passwordChangedAt = new Date();
    await user.save();

    // Свежий токен для текущей сессии (как signToken при логине). Клиент должен его
    // сохранить вместо старого — иначе следующий запрос со старым токеном получит 401.
    const token = jwt.sign(
      { id: user.id, role: user.role, sv: user.passwordChangedAt.getTime() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    disconnectUserSockets(user.id);

    res.json({ success: true, message: 'Пароль успешно изменён', token });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/email — привязать/сменить настоящий email (в т.ч. для телефон-аккаунтов
// с плейсхолдером @phone.maslaxat.uz). Проверяем формат + уникальность; новый email
// требует подтверждения (isVerified→false + письмо).
router.put('/email', authenticate, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Неверный формат email' });
    }
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (email === user.email) {
      return res.json({ success: true, user: user.toJSON() });
    }
    const exists = await User.findOne({ where: { email, id: { [Op.ne]: user.id } } });
    if (exists) return res.status(409).json({ error: 'Этот email уже используется' });

    const verificationToken = crypto.randomBytes(32).toString('hex');
    try {
      const delivery = await sendVerificationEmail(email, verificationToken);
      if (delivery?.skipped) return res.status(503).json({ error: 'Отправка email временно недоступна' });
    } catch (e) {
      logger.error('Failed to send verification email (email change):', e.message);
      return res.status(502).json({ error: 'Не удалось отправить письмо подтверждения' });
    }

    user.email = email;
    user.verificationToken = verificationToken;
    user.isVerified = false;
    await user.save();

    res.json({ success: true, user: user.toJSON(), message: 'Email обновлён. Подтвердите по ссылке в письме.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/users/settings — get user preferences
router.get('/settings', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, { attributes: ['settings'] });
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ settings: user.settings || {} });
  } catch (err) {
    next(err);
  }
});

// PUT /api/users/settings — save user preferences
router.put('/settings', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    // Мержим только известные ключи настроек (whitelist) — чтобы в JSONB не
    // попадал произвольный мусор из тела запроса.
    const ALLOWED = [
      'emailNotifications', 'pushNotifications', 'profileVisibility',
      'dataSharing', 'showEmail', 'showPhone', 'fontSize', 'compactMode', 'language', 'theme',
    ];
    const incoming = req.body.settings || req.body || {};
    const clean = {};
    for (const key of ALLOWED) {
      if (incoming[key] !== undefined) clean[key] = incoming[key];
    }
    user.settings = { ...(user.settings || {}), ...clean };
    await user.save();
    res.json({ success: true, settings: user.settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
