const router = require('express').Router();
const logger = require('../config/logger');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { Op } = require('sequelize');
const { User, LawyerProfile } = require('../models');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../services/emailService');

const signToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Короткоживущий токен-вызов между «пароль верный» и «код 2FA верный»
const signTwoFactorChallenge = (user) => {
  return jwt.sign(
    { id: user.id, twofa: 'pending' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
};

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      name: Joi.string().min(2).required(),
      phone: Joi.string().optional(),
      role: Joi.string().valid('client', 'lawyer').default('client'),
      specialization: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const exists = await User.findOne({ where: { email: value.email } });
    if (exists) {
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const { specialization, ...userData } = value;
    const user = await User.create({ ...userData, verificationToken });

    if (value.role === 'lawyer') {
      await LawyerProfile.create({
        userId: user.id,
        specialization: specialization || 'Общее право',
        price: 200000,
        isAvailable: false, // скрыт до завершения онбординга
      });
    }

    // Отправляем письмо верификации (не блокируем регистрацию при ошибке)
    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (emailErr) {
      logger.error('Failed to send verification email:', emailErr.message);
    }

    const token = signToken(user);

    res.status(201).json({
      user: user.toJSON(),
      token,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const user = await User.findOne({ where: { email: value.email } });
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const isValid = await user.comparePassword(value.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    // Если включена 2FA — не выдаём полный токен, требуем код вторым шагом
    if (user.twoFactorEnabled) {
      return res.json({
        twoFactorRequired: true,
        tempToken: signTwoFactorChallenge(user),
      });
    }

    const token = signToken(user);

    res.json({
      user: user.toJSON(),
      token,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login/2fa — второй шаг входа: проверка кода TOTP или резервного
router.post('/login/2fa', async (req, res, next) => {
  try {
    const { tempToken, code } = req.body || {};
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Требуется код' });
    }

    let payload;
    try {
      payload = jwt.verify(tempToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: 'Сессия входа истекла, войдите заново' });
    }
    if (payload.twofa !== 'pending') {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    const user = await User.findByPk(payload.id);
    if (!user || !user.twoFactorEnabled) {
      return res.status(401).json({ error: 'Недействительный токен' });
    }

    const twoFactor = require('../services/twoFactorService');
    const okTotp = twoFactor.verifyToken(user.twoFactorSecret, code);
    const remaining = twoFactor.consumeBackupCode(user.twoFactorBackupCodes, code);
    if (!okTotp && !remaining) {
      return res.status(400).json({ error: 'Неверный код' });
    }
    // Резервный код одноразовый — списываем
    if (!okTotp && remaining) {
      user.twoFactorBackupCodes = remaining;
      await user.save();
    }

    const token = signToken(user);
    res.json({ user: user.toJSON(), token, role: user.role });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
const { authenticate } = require('../middleware/auth');
router.get('/me', authenticate, async (req, res) => {
  const user = await User.findByPk(req.userId, {
    include: req.userRole === 'lawyer' ? [{ model: LawyerProfile, as: 'profile' }] : [],
  });
  res.json({ user });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email обязателен' });
    }

    const user = await User.findOne({ where: { email } });

    // Always return success to avoid leaking user existence
    if (!user) {
      return res.json({ message: 'Если аккаунт существует, вы получите письмо для сброса пароля' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send email
    try {
      await sendPasswordResetEmail(email, resetToken);
    } catch (emailErr) {
      logger.error('Failed to send reset email:', emailErr.message);
    }

    res.json({ message: 'Если аккаунт существует, вы получите письмо для сброса пароля' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const schema = Joi.object({
      token: Joi.string().required(),
      password: Joi.string().min(6).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const user = await User.findOne({
      where: {
        resetToken: value.token,
        resetTokenExpiry: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Недействительная или просроченная ссылка для сброса' });
    }

    user.password = value.password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Пароль успешно изменён' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/verify-email/:token
router.get('/verify-email/:token', async (req, res, next) => {
  try {
    const user = await User.findOne({ where: { verificationToken: req.params.token } });

    if (!user) {
      return res.status(400).json({ error: 'Недействительная ссылка подтверждения' });
    }

    user.isVerified = true;
    user.verificationToken = null;
    await user.save();

    res.json({ message: 'Email успешно подтверждён' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);

    if (user.isVerified) {
      return res.status(400).json({ error: 'Email уже подтверждён' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    await user.save();

    await sendVerificationEmail(user.email, verificationToken);

    res.json({ message: 'Письмо отправлено повторно' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
