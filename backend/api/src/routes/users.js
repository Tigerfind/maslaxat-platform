const router = require('express').Router();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { Op, UniqueConstraintError } = require('sequelize');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailService');
const logger = require('../config/logger');
const { disconnectUserSockets } = require('../socket/io');
const { AVATAR_EXTENSIONS, fileFilterFor, validateUploadSignatures, cleanupUploadedFiles } = require('../services/uploadSecurity');
const { distributedRateLimit } = require('../middleware/distributedRateLimit');
const smsService = require('../services/smsService');
const { createVerificationCode } = require('../services/emailVerificationService');

const emailChangeLimiter = distributedRateLimit({
  prefix: 'email-change-user', windowSeconds: 60 * 60,
  max: process.env.NODE_ENV === 'production' ? 5 : 1000,
  keyGenerator: (req) => req.userId,
});

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
  fileFilter: fileFilterFor(AVATAR_EXTENSIONS),
});

// PUT /api/users/profile — update user profile
router.put('/profile', authenticate, upload.single('avatar'), validateUploadSignatures(AVATAR_EXTENSIONS), async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Update allowed fields
    const { name, phone, address } = req.body;
    if (name && name.trim()) user.name = name.trim();
    if (phone !== undefined) {
      const normalizedPhone = phone ? smsService.normalizePhone(phone) : null;
      if (normalizedPhone !== user.phone) {
        cleanupUploadedFiles(req);
        return res.status(400).json({
          error: 'Измените телефон через подтверждение кодом из SMS',
          code: 'PHONE_VERIFICATION_REQUIRED',
        });
      }
    }
    if (address !== undefined) user.address = address;

    // Avatar upload
    const previousAvatar = user.avatar;
    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
    }

    await user.save();

    if (req.file && previousAvatar?.startsWith('/uploads/avatar-')) {
      const previousPath = path.join(uploadDir, path.basename(previousAvatar));
      if (previousPath !== req.file.path) require('fs').promises.unlink(previousPath).catch(() => {});
    }

    res.json({ user: user.toJSON() });
  } catch (err) {
    cleanupUploadedFiles(req);
    if (err instanceof UniqueConstraintError) {
      return res.status(409).json({ error: 'Этот номер телефона уже используется' });
    }
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
router.put('/email', authenticate, emailChangeLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Неверный формат email' });
    }
    const user = await User.findByPk(req.userId);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (email === user.email) {
      return res.json({ success: true, user: user.toJSON() });
    }
    const exists = await User.findOne({ where: { email: { [Op.iLike]: email }, id: { [Op.ne]: user.id } } });
    if (exists) return res.status(409).json({ error: 'Этот email уже используется' });

    const previousEmail = user.email;
    const previousToken = user.verificationToken;
    const previousExpiry = user.verificationTokenExpiry;
    const previousAttempts = user.verificationAttempts;
    const previousSentAt = user.verificationSentAt;
    const previousVerified = user.isVerified;
    const verification = createVerificationCode(user.id, email);
    user.email = email;
    user.set(verification);
    user.isVerified = false;
    await user.save();

    try {
      const delivery = await sendVerificationEmail(email, verification.code);
      if (delivery?.skipped) throw new Error('EMAIL_UNAVAILABLE');
    } catch (e) {
      await User.update({
        email: previousEmail,
        verificationToken: previousToken,
        verificationTokenExpiry: previousExpiry,
        verificationAttempts: previousAttempts,
        verificationSentAt: previousSentAt,
        isVerified: previousVerified,
      }, { where: { id: user.id, verificationToken: verification.verificationToken } });
      if (e.message !== 'EMAIL_UNAVAILABLE') logger.error('Failed to send verification email (email change):', e.message);
      return res.status(503).json({ error: 'Не удалось отправить письмо подтверждения' });
    }

    res.json({ success: true, user: user.toJSON(), message: 'Email обновлён. Введите код из письма.' });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      return res.status(409).json({ error: 'Этот email уже используется' });
    }
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
