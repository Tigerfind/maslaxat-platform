const express = require('express');
const jwt = require('jsonwebtoken');
const { passwordStateFor } = require('../services/authChallengeService');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const { sendVerificationEmail } = require('../services/emailService');
const logger = require('../config/logger');
const { createMemoryUpload } = require('../middleware/fileUpload');
const { getFileStorageService } = require('../services/fileStorageRuntime');
const { streamFile } = require('../services/fileHttpService');
const { FILE_LIMITS, uploadLimitFor } = require('../config/fileLimits');
const { registerUuidParams } = require('../middleware/uuidParams');
const { reportCaughtException } = require('../instrument');

const upload = createMemoryUpload({
  types: ['jpeg', 'png', 'webp'],
  maxBytes: uploadLimitFor('avatar'),
});

function avatarRecord(user) {
  if (!user.avatarStorageKey) return null;
  return {
    storageProvider: user.avatarStorageProvider,
    storageKey: user.avatarStorageKey,
    mimeType: user.avatarMimeType,
    size: user.avatarSize,
    sha256: user.avatarSha256,
    path: user.avatarLocalPath || null,
  };
}

function applyProfileFields(user, { name, phone, address, preferredMode }) {
  if (name && name.trim()) user.name = name.trim();
  if (phone !== undefined) user.phone = phone;
  if (address !== undefined) user.address = address;
  if (preferredMode !== undefined) user.preferredMode = preferredMode;
}

function serializeUser(user) {
  const value = user.get({ plain: true });
  const fields = [
    'id', 'name', 'email', 'phone', 'address', 'settings', 'role', 'accountType',
    'preferredMode', 'avatar', 'isVerified', 'isActive', 'twoFactorEnabled',
    'twoFactorVersion', 'createdAt', 'updatedAt',
  ];
  return Object.fromEntries(fields.filter((field) => value[field] !== undefined)
    .map((field) => [field, value[field]]));
}

function createUsersRouter({ fileStorageService = getFileStorageService() } = {}) {
const router = express.Router();
registerUuidParams(router, 'id');

router.get('/:id/avatar', async (req, res, next) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: [
        'id', 'avatarStorageProvider', 'avatarStorageKey', 'avatarMimeType',
        'avatarSize', 'avatarSha256', 'avatarLocalPath',
      ],
    });
    const record = avatarRecord(user || {});
    if (!record) return res.status(404).json({ error: 'Аватар не найден' });
    const etag = `"${record.sha256}"`;
    if (req.get('if-none-match') === etag) {
      res.set('Cache-Control', 'public, max-age=300');
      res.set('ETag', etag);
      res.set('X-Content-Type-Options', 'nosniff');
      return res.status(304).end();
    }
    await streamFile({
      storage: fileStorageService, req, res, record, publicCache: true,
      maxBytes: FILE_LIMITS.avatar,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/users/profile — update user profile
router.put('/profile', authenticate, upload.single('avatar'), async (req, res, next) => {
  try {
    const { name, phone, address, preferredMode } = req.body;
    if (preferredMode !== undefined && !['client', 'lawyer'].includes(preferredMode)) {
      return res.status(400).json({ error: 'Недопустимый режим аккаунта' });
    }
    let user;
    if (req.file) {
      const fileId = crypto.randomUUID();
      let oldRecord;
      user = await fileStorageService.store({
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
          applyProfileFields(locked, { name, phone, address, preferredMode });
          locked.avatar = `/api/users/${locked.id}/avatar`;
          locked.avatarStorageProvider = metadata.storageProvider;
          locked.avatarStorageKey = metadata.storageKey;
          locked.avatarMimeType = metadata.mimeType;
          locked.avatarSize = metadata.size;
          locked.avatarSha256 = metadata.sha256;
          locked.avatarLocalPath = metadata.path;
          await locked.save({ transaction });
          return locked;
        },
      });
      if (oldRecord && oldRecord.storageKey !== user.avatarStorageKey) {
        await fileStorageService.delete({ record: oldRecord, destroy: async () => undefined });
      }
    } else {
      user = await User.findByPk(req.userId);
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      applyProfileFields(user, { name, phone, address, preferredMode });
      await user.save();
    }

    res.json({ user: serializeUser(user) });
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

    // Update password (hook will hash it) + инвалидируем ранее выданные токены:
    // Exact password state invalidates every prior session even when the old and
    // replacement JWT share the same second-granularity iat.
    user.password = newPassword;
    user.passwordChangedAt = new Date(Date.now());
    await user.save();

    // Свежий токен для текущей сессии (как signToken при логине). Клиент должен его
    // сохранить вместо старого — иначе следующий запрос со старым токеном получит 401.
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        authLevel: req.authLevel,
        passwordState: passwordStateFor(user),
        ...(req.authLevel === 'mfa' ? { twoFactorVersion: user.twoFactorVersion } : {}),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

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
      return res.json({ success: true, user: serializeUser(user) });
    }
    const exists = await User.findOne({ where: { email, id: { [Op.ne]: user.id } } });
    if (exists) return res.status(409).json({ error: 'Этот email уже используется' });

    user.email = email;
    // Новый email нужно подтвердить — не блокируем аккаунт, но шлём письмо.
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    user.isVerified = false;
    await user.save();

    try {
      await sendVerificationEmail(email, verificationToken);
    } catch (e) {
      reportCaughtException(e, { operation: 'email_change_verification_send', userId: user.id });
      logger.error('email_change_verification_send_failed', { userId: user.id });
    }

    res.json({ success: true, user: serializeUser(user), message: 'Email обновлён. Подтвердите по ссылке в письме.' });
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

return router;
}

module.exports = createUsersRouter;
