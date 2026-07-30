const router = require('express').Router();
const logger = require('../config/logger');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { User, LawyerProfile, PhoneOtp } = require('../models');
const { sendPasswordResetEmail, sendVerificationEmail } = require('../services/emailService');
const smsService = require('../services/smsService');

// Выделенный строгий лимит на ввод 2FA-кода — защита от перебора TOTP
// (считаем все попытки, не только неудачные).
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: { error: 'Слишком много попыток кода, попробуйте позже' },
});

// Лимитер на эндпоинты, рассылающие письма / перебираемые (register, forgot,
// resend). Считает ВСЕ попытки (не только неудачные) — общий /api/auth лимитер
// их пропускает из-за skipSuccessfulRequests → возможен email-бомбинг/enumeration.
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 15 : 200,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

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
router.post('/register', emailLimiter, async (req, res, next) => {
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

// ─── ВХОД/РЕГИСТРАЦИЯ ПО ТЕЛЕФОНУ (SMS-код) ──────────────────

// POST /api/auth/phone/request — запросить одноразовый код на номер
router.post('/phone/request', emailLimiter, async (req, res, next) => {
  try {
    const phone = smsService.normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Неверный формат номера (пример: +998901234567)' });

    const code = String(crypto.randomInt(100000, 1000000)); // 6-значный, крипто-стойкий
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);  // 5 минут

    // Один активный код на номер: перезаписываем предыдущий.
    const existing = await PhoneOtp.findOne({ where: { phone } });
    if (existing) await existing.update({ code, expiresAt, attempts: 0 });
    else await PhoneOtp.create({ phone, code, expiresAt, attempts: 0 });

    await smsService.sendSms(phone, `MaslaXat: код подтверждения ${code}. Действует 5 минут.`);

    // В dev без реального SMS-провайдера возвращаем код, чтобы можно было тестировать.
    // В проде код НИКОГДА не возвращается — только реальная SMS.
    const devReturn = process.env.NODE_ENV !== 'production' && !smsService.isConfigured();
    res.json({ success: true, message: 'Код отправлен', ...(devReturn ? { devCode: code } : {}) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/phone/verify — проверить код: вход (номер есть) или регистрация клиента
router.post('/phone/verify', twoFactorLimiter, async (req, res, next) => {
  try {
    const phone = smsService.normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!phone || !code) return res.status(400).json({ error: 'Укажите номер и код' });

    const otp = await PhoneOtp.findOne({ where: { phone } });
    if (!otp) return res.status(400).json({ error: 'Сначала запросите код' });
    if (new Date(otp.expiresAt) < new Date()) { await otp.destroy(); return res.status(400).json({ error: 'Код истёк, запросите новый' }); }
    if (otp.attempts >= 5) { await otp.destroy(); return res.status(429).json({ error: 'Слишком много попыток, запросите новый код' }); }
    if (otp.code !== code) { await otp.increment('attempts'); return res.status(400).json({ error: 'Неверный код' }); }

    // Код верный. Новому номеру нужно имя — просим его, НЕ сжигая код (повторим verify).
    let user = await User.findOne({ where: { phone } });
    if (!user && name.length < 2) {
      return res.status(400).json({ error: 'Укажите имя для регистрации', needName: true });
    }

    await otp.destroy(); // код использован

    let created = false;
    if (!user) {
      // Регистрация клиента по телефону: пароль случайный (вход по коду), телефон
      // подтверждён (isVerified). email обязателен и уникален в модели — генерируем
      // плейсхолдер по номеру; реальный email клиент сможет добавить в профиле.
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const genEmail = `${phone.replace(/\D/g, '')}@phone.maslaxat.uz`;
      user = await User.create({ name, phone, email: genEmail, role: 'client', password: randomPassword, isVerified: true, isActive: true });
      created = true;
    }

    const token = signToken(user);
    res.status(created ? 201 : 200).json({ user: user.toJSON(), token, role: user.role, created });
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
router.post('/login/2fa', twoFactorLimiter, async (req, res, next) => {
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

// ─── СОЦ-ВХОД (fail-safe: без ключей провайдеры отключены) ───
const socialAuth = require('../services/socialAuthService');

// GET /api/auth/social/config — какие провайдеры включены (для показа кнопок)
router.get('/social/config', (req, res) => {
  res.json(socialAuth.config());
});

// Общий помощник: выдать токен для найденного/созданного пользователя
function issueFor(user, res) {
  const token = signToken(user);
  res.json({ user: user.toJSON(), token, role: user.role });
}

// POST /api/auth/google — вход по Google ID-token
router.post('/google', async (req, res, next) => {
  try {
    if (!socialAuth.googleEnabled()) return res.status(503).json({ error: 'Вход через Google недоступен' });
    const data = await socialAuth.verifyGoogleToken(req.body.credential);
    if (!data) return res.status(401).json({ error: 'Не удалось подтвердить аккаунт Google' });

    let user = await User.findOne({ where: { googleId: data.googleId } });
    if (!user) user = await User.findOne({ where: { email: data.email } });
    if (!user) {
      user = await User.create({
        email: data.email,
        name: data.name,
        avatar: data.avatar,
        role: 'client',
        isVerified: true,
        googleId: data.googleId,
        password: crypto.randomBytes(24).toString('hex'),
      });
    } else if (!user.googleId) {
      user.googleId = data.googleId;
      await user.save();
    }
    issueFor(user, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/telegram — вход по данным Telegram Login Widget
router.post('/telegram', async (req, res, next) => {
  try {
    if (!socialAuth.telegramEnabled()) return res.status(503).json({ error: 'Вход через Telegram недоступен' });
    const data = socialAuth.verifyTelegramAuth(req.body);
    if (!data) return res.status(401).json({ error: 'Не удалось подтвердить аккаунт Telegram' });

    let user = await User.findOne({ where: { telegramId: data.telegramId } });
    if (!user) {
      user = await User.create({
        email: `tg${data.telegramId}@telegram.local`,
        name: data.name,
        avatar: data.avatar,
        role: 'client',
        isVerified: true,
        telegramId: data.telegramId,
        password: crypto.randomBytes(24).toString('hex'),
      });
    }
    issueFor(user, res);
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
const { authenticate } = require('../middleware/auth');
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId, {
      include: req.userRole === 'lawyer' ? [{ model: LawyerProfile, as: 'profile' }] : [],
    });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', emailLimiter, async (req, res, next) => {
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

    // Отправляем письмо fire-and-forget — не ждём, чтобы время ответа не
    // отличалось для существующего/несуществующего email (тайминг-энумерация).
    sendPasswordResetEmail(email, resetToken).catch((emailErr) => {
      logger.error('Failed to send reset email:', emailErr.message);
    });

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
    user.passwordChangedAt = new Date(); // инвалидирует ранее выданные JWT
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
router.post('/resend-verification', emailLimiter, authenticate, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
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
