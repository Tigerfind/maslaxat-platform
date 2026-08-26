const router = require('express').Router();
const logger = require('../config/logger');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { sequelize, User, LawyerProfile, PhoneOtp } = require('../models');
const { isEmailConfigured, sendPasswordResetEmail, sendVerificationEmail } = require('../services/emailService');
const smsService = require('../services/smsService');
const { distributedRateLimit } = require('../middleware/distributedRateLimit');
const LEGAL_VERSION = '2026-08-13';
const productionMax = (value) => process.env.NODE_ENV === 'production' ? value : 1000;
const normalizedEmailKey = (req) => String(req.body?.email || '').trim().toLowerCase() || req.ip;
const normalizedPhoneKey = (req) => smsService.normalizePhone(req.body?.phone) || req.ip;
const loginAccountLimiter = distributedRateLimit({ prefix: 'login-account', windowSeconds: 15 * 60, max: productionMax(20), keyGenerator: normalizedEmailKey });
const phoneRequestLimiter = distributedRateLimit({ prefix: 'phone-request', windowSeconds: 60 * 60, max: productionMax(5), keyGenerator: normalizedPhoneKey });
const phoneVerifyLimiter = distributedRateLimit({ prefix: 'phone-verify', windowSeconds: 15 * 60, max: productionMax(10), keyGenerator: normalizedPhoneKey });
const forgotAccountLimiter = distributedRateLimit({ prefix: 'forgot-account', windowSeconds: 60 * 60, max: productionMax(5), keyGenerator: normalizedEmailKey });
const resetTokenLimiter = distributedRateLimit({ prefix: 'reset-token', windowSeconds: 60 * 60, max: productionMax(10), keyGenerator: (req) => req.body?.token || req.ip });
const resendUserLimiter = distributedRateLimit({ prefix: 'resend-user', windowSeconds: 60 * 60, max: productionMax(5), keyGenerator: (req) => req.userId || req.ip });
const twoFactorChallengeLimiter = distributedRateLimit({ prefix: 'twofa-challenge', windowSeconds: 15 * 60, max: productionMax(10), keyGenerator: (req) => req.body?.tempToken || req.ip });
router.use('/linkedin', require('./linkedin-auth'));

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
  const sessionVersion = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : undefined;
  return jwt.sign(
    { id: user.id, role: user.role, ...(sessionVersion ? { sv: sessionVersion } : {}) },
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

const consumePhoneOtp = (phone, code, onValid) => sequelize.transaction(async (transaction) => {
  const otp = await PhoneOtp.findOne({ where: { phone }, transaction, lock: transaction.LOCK.UPDATE });
  if (!otp) return { status: 400, error: 'Сначала запросите код' };
  if (new Date(otp.expiresAt) < new Date()) {
    await otp.destroy({ transaction });
    return { status: 400, error: 'Код истёк, запросите новый' };
  }
  if (otp.attempts >= 5) {
    await otp.destroy({ transaction });
    return { status: 429, error: 'Слишком много попыток, запросите новый код' };
  }
  if (otp.code !== code) {
    otp.attempts += 1;
    if (otp.attempts >= 5) {
      await otp.destroy({ transaction });
      return { status: 429, error: 'Слишком много попыток, запросите новый код' };
    }
    await otp.save({ transaction });
    return { status: 400, error: 'Неверный код' };
  }
  const result = await onValid(transaction);
  if (result?.error) return result;
  await otp.destroy({ transaction });
  return { status: 200, result };
});

// POST /api/auth/register
router.post('/register', emailLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(8).required(),
      name: Joi.string().min(2).required(),
      phone: Joi.string().optional(),
      role: Joi.string().valid('client', 'lawyer').default('client'),
      specialization: Joi.string().optional(),
      specializations: Joi.array().items(Joi.string()).optional(),
      acceptedTerms: Joi.boolean().valid(true).required(),
      legalVersion: Joi.string().valid(LEGAL_VERSION).required(),
    });
    // Пароль ≥8 — усиление против подбора (было 6).

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Email — канонично в нижнем регистре, чтобы User@x и user@x не стали двумя
    // аккаунтами. Проверка занятости — регистронезависимая (iLike ловит и старые).
    value.email = String(value.email).trim().toLowerCase();
    const exists = await User.findOne({ where: { email: { [Op.iLike]: value.email } } });
    if (exists) {
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    // Дедуп по телефону: один номер — один аккаунт (иначе обход лимитов free/AI).
    // Нормализуем к единому виду (+998…), проверяем занятость.
    let phone;
    if (value.phone) {
      phone = smsService.normalizePhone(value.phone);
      if (!phone) return res.status(400).json({ error: 'Неверный формат номера (пример: +998901234567)' });
      const phoneUsed = await User.findOne({ where: { phone } });
      if (phoneUsed) return res.status(409).json({ error: 'Этот номер телефона уже используется' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const { specialization, specializations, phone: _rawPhone, acceptedTerms: _acceptedTerms, legalVersion, ...userData } = value;
    const user = await User.create({ ...userData, phone: phone || null, verificationToken, legalAcceptedAt: new Date(), legalVersion });

    if (value.role === 'lawyer') {
      // Мультиспециализация: принимаем массив ИЛИ одиночную строку (legacy). Дедуп,
      // максимум 12; основная specialization = первая (совместимость каталога/карточки).
      const raw = Array.isArray(specializations) && specializations.length
        ? specializations
        : (specialization ? [specialization] : []);
      const specs = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))].slice(0, 12);
      const primary = specs[0] || 'Не указана';
      await LawyerProfile.create({
        userId: user.id,
        specialization: primary,
        specializations: specs,
        price: 0,
        isAvailable: false, // скрыт до завершения онбординга
        verificationStatus: 'draft',
      });
    }

    // Отправляем письмо верификации в фоне — НЕ блокируем ответ регистрации.
    // Без SMTP (или при медленном/недоступном почтовом сервере) ответ клиенту
    // не должен ждать сеть: письмо уходит асинхронно, ошибки только логируем.
    Promise.resolve()
      .then(() => sendVerificationEmail(user.email, verificationToken))
      .catch((emailErr) => logger.error('Failed to send verification email:', emailErr.message));

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
router.post('/phone/request', emailLimiter, phoneRequestLimiter, async (req, res, next) => {
  try {
    const phone = smsService.normalizePhone(req.body.phone);
    if (!phone) return res.status(400).json({ error: 'Неверный формат номера (пример: +998901234567)' });

    const code = String(crypto.randomInt(100000, 1000000)); // 6-значный, крипто-стойкий
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);  // 5 минут

    // Один активный код на номер: перезаписываем предыдущий.
    const existing = await PhoneOtp.findOne({ where: { phone } });
    if (existing) await existing.update({ code, expiresAt, attempts: 0 });
    else await PhoneOtp.create({ phone, code, expiresAt, attempts: 0 });

    const result = await smsService.sendSms(phone, `MaslaXat: код подтверждения ${code}. Действует 5 минут.`);

    // Если провайдер подключён, но отправка не удалась — не врём «отправлено».
    // Пусть клиент повторит (код уже сохранён; повтор перезапишет его).
    if (!result.sent && (process.env.NODE_ENV === 'production' || smsService.isConfigured())) {
      await PhoneOtp.destroy({ where: { phone, code } });
      return res.status(502).json({ error: 'Не удалось отправить SMS. Попробуйте ещё раз через минуту.' });
    }

    // В dev без реального SMS-провайдера возвращаем код, чтобы можно было тестировать.
    // В проде код НИКОГДА не возвращается — только реальная SMS.
    const devReturn = process.env.NODE_ENV !== 'production' && !smsService.isConfigured();
    res.json({ success: true, message: 'Код отправлен', ...(devReturn ? { devCode: code } : {}) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/phone/verify — проверить код: вход (номер есть) или регистрация клиента
router.post('/phone/verify', twoFactorLimiter, phoneVerifyLimiter, async (req, res, next) => {
  try {
    const phone = smsService.normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!phone || !code) return res.status(400).json({ error: 'Укажите номер и код' });

    let user;
    const consumed = await consumePhoneOtp(phone, code, async (transaction) => {
      user = await User.findOne({ where: { phone }, transaction, lock: transaction.LOCK.UPDATE });
      if (user) return { user, created: false };
      // Код уже проверен под блокировкой, но не сжигаем его, пока клиент не
      // передал обязательные поля регистрации.
      if (name.length < 2) return { status: 400, error: 'Укажите имя для регистрации', needName: true };
      if (req.body.acceptedTerms !== true || req.body.legalVersion !== LEGAL_VERSION) {
        return { status: 400, error: 'Примите условия использования', needLegal: true };
      }
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const genEmail = `${phone.replace(/\D/g, '')}@phone.maslaxat.uz`;
      user = await User.create({ name, phone, email: genEmail, role: 'client', password: randomPassword, isVerified: true, isActive: true, legalAcceptedAt: new Date(), legalVersion: LEGAL_VERSION }, { transaction });
      return { user, created: true };
    });
    if (consumed.error) {
      const { status, ...body } = consumed;
      return res.status(status).json(body);
    }
    const { created } = consumed.result;

    return issueFor(user, res, created ? 201 : 200, { created });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', loginAccountLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    // Вход — регистронезависимо по email (iLike), чтобы регистр не мешал входу.
    const user = await User.findOne({ where: { email: { [Op.iLike]: String(value.email).trim() } } });
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const isValid = await user.comparePassword(value.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    return issueFor(user, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login/2fa — второй шаг входа: проверка кода TOTP или резервного
router.post('/login/2fa', twoFactorLimiter, twoFactorChallengeLimiter, async (req, res, next) => {
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
function issueFor(user, res, status = 200, extra = {}) {
  if (!user.isActive) {
    return res.status(403).json({ error: 'Аккаунт заблокирован' });
  }
  if (user.twoFactorEnabled) {
    return res.status(status).json({
      twoFactorRequired: true,
      tempToken: signTwoFactorChallenge(user),
      ...extra,
    });
  }
  const token = signToken(user);
  return res.status(status).json({ user: user.toJSON(), token, role: user.role, ...extra });
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
      if (req.body.acceptedTerms !== true || req.body.legalVersion !== LEGAL_VERSION) {
        return res.status(400).json({ error: 'Примите условия использования', needLegal: true });
      }
      user = await User.create({
        email: data.email,
        name: data.name,
        avatar: data.avatar,
        role: 'client',
        isVerified: true,
        googleId: data.googleId,
        password: crypto.randomBytes(24).toString('hex'),
        legalAcceptedAt: new Date(),
        legalVersion: LEGAL_VERSION,
      });
    } else if (!user.googleId) {
      user.googleId = data.googleId;
      await user.save();
    }
    return issueFor(user, res);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/telegram — вход по данным Telegram Login Widget
router.post('/telegram', async (req, res, next) => {
  try {
    if (!socialAuth.telegramEnabled()) return res.status(503).json({ error: 'Вход через Telegram недоступен' });
    const { acceptedTerms, legalVersion, ...telegramPayload } = req.body;
    const data = socialAuth.verifyTelegramAuth(telegramPayload);
    if (!data) return res.status(401).json({ error: 'Не удалось подтвердить аккаунт Telegram' });

    let user = await User.findOne({ where: { telegramId: data.telegramId } });
    if (!user) {
      if (acceptedTerms !== true || legalVersion !== LEGAL_VERSION) {
        return res.status(400).json({ error: 'Примите условия использования', needLegal: true });
      }
      user = await User.create({
        email: `tg${data.telegramId}@telegram.local`,
        name: data.name,
        avatar: data.avatar,
        role: 'client',
        isVerified: true,
        telegramId: data.telegramId,
        password: crypto.randomBytes(24).toString('hex'),
        legalAcceptedAt: new Date(),
        legalVersion: LEGAL_VERSION,
      });
    }
    return issueFor(user, res);
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

// POST /api/auth/phone/confirm — подтвердить телефон ЗАЛОГИНЕННОМУ пользователю
// (в отличие от /phone/verify, который логинит/регистрирует). Привязывает номер к
// текущему аккаунту и ставит isVerified=true. Дедуп: номер не должен быть у другого.
router.post('/phone/confirm', authenticate, phoneVerifyLimiter, async (req, res, next) => {
  try {
    const phone = smsService.normalizePhone(req.body.phone);
    const code = String(req.body.code || '').trim();
    if (!phone || !code) return res.status(400).json({ error: 'Укажите номер и код' });

    let user;
    const consumed = await consumePhoneOtp(phone, code, async (transaction) => {
      const taken = await User.findOne({ where: { phone }, transaction, lock: transaction.LOCK.UPDATE });
      if (taken && taken.id !== req.userId) return { status: 409, error: 'Этот номер уже используется другим аккаунтом' };
      user = await User.findByPk(req.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) return { status: 404, error: 'Пользователь не найден' };
      user.phone = phone;
      user.isVerified = true;
      await user.save({ transaction });
      return { user };
    });
    if (consumed.error) return res.status(consumed.status).json({ error: consumed.error });

    res.json({ success: true, user: user.toJSON() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', emailLimiter, forgotAccountLimiter, async (req, res, next) => {
  try {
    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Отправка email временно недоступна. Обратитесь в поддержку.', code: 'EMAIL_UNAVAILABLE' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email обязателен' });
    }

    const user = await User.findOne({ where: { email: { [Op.iLike]: String(email).trim() } } });

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
router.post('/reset-password', resetTokenLimiter, async (req, res, next) => {
  try {
    const schema = Joi.object({
      token: Joi.string().required(),
      password: Joi.string().min(8).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const changed = await sequelize.transaction(async (transaction) => {
      const user = await User.findOne({
        where: { resetToken: value.token, resetTokenExpiry: { [Op.gt]: new Date() } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!user) return false;
      user.password = value.password;
      user.resetToken = null;
      user.resetTokenExpiry = null;
      user.passwordChangedAt = new Date();
      await user.save({ transaction });
      return true;
    });
    if (!changed) return res.status(400).json({ error: 'Недействительная или просроченная ссылка для сброса' });

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
router.post('/resend-verification', emailLimiter, authenticate, resendUserLimiter, async (req, res, next) => {
  try {
    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (user.isVerified) {
      return res.status(400).json({ error: 'Email уже подтверждён' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const delivery = await sendVerificationEmail(user.email, verificationToken);
    if (delivery?.skipped) return res.status(503).json({ error: 'Отправка email временно недоступна' });
    user.verificationToken = verificationToken;
    await user.save();

    res.json({ message: 'Письмо отправлено повторно' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
