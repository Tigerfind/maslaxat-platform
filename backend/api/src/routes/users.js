const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');

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

    // Update password (hook will hash it)
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Пароль успешно изменён' });
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
