const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const router = require('express').Router();
const { Op } = require('sequelize');
const { sequelize, User, LawyerProfile, LawyerOAuthAccount } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const linkedin = require('../services/linkedinOidcService');
const store = require('../services/oauthTransactionStore');

const LEGAL_VERSION = '2026-08-13';
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 30 : 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
}).filter(([key]) => key));

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const issueFor = (user) => {
  if (user.twoFactorEnabled) {
    return {
      twoFactorRequired: true,
      tempToken: jwt.sign({ id: user.id, twofa: 'pending' }, process.env.JWT_SECRET, { expiresIn: '5m' }),
    };
  }
  const sv = user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : undefined;
  return {
    user: user.toJSON(),
    token: jwt.sign({ id: user.id, role: user.role, ...(sv ? { sv } : {}) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }),
    role: user.role,
  };
};

async function begin(req, res, mode, userId = null) {
  if (!linkedin.isEnabled()) return res.status(503).json({ error: 'LinkedIn временно недоступен' });
  if (mode === 'register' && (req.body?.acceptedTerms !== true || req.body?.legalVersion !== LEGAL_VERSION)) {
    return res.status(400).json({ error: 'Примите условия использования' });
  }
  try {
    const auth = await linkedin.createAuthorization();
    const binding = crypto.randomBytes(32).toString('base64url');
    await store.put('linkedin-state', auth.state, {
      state: auth.state,
      nonce: auth.nonce,
      codeVerifier: auth.codeVerifier,
      bindingHash: store.hash(binding),
      mode,
      userId,
    }, 600);
    res.cookie('linkedin_oauth_bind', binding, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 60 * 1000,
      path: '/api/auth/linkedin',
    });
    return res.json({ authorizationUrl: auth.url });
  } catch (error) {
    return res.status(503).json({ error: 'Не удалось начать LinkedIn авторизацию' });
  }
}

router.post('/start', limiter, (req, res) => begin(req, res, 'register'));
router.get('/link/status', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const account = await LawyerOAuthAccount.findOne({
      where: { userId: req.userId, provider: 'linkedin' },
      attributes: ['providerEmail', 'lastLoginAt', 'createdAt'],
    });
    return res.json({ enabled: linkedin.isEnabled(), connected: Boolean(account), account });
  } catch (error) { return next(error); }
});

router.post('/link/start', limiter, authenticate, authorize('lawyer'), (req, res) => begin(req, res, 'link', req.userId));

router.get('/callback', limiter, async (req, res) => {
  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (req.query.error) return res.redirect(`${frontend}/oauth/linkedin#error=cancelled`);
  try {
    const transaction = await store.consume('linkedin-state', req.query.state);
    const binding = parseCookies(req.headers.cookie).linkedin_oauth_bind;
    if (!transaction || !safeEqual(transaction.bindingHash, store.hash(binding))) throw new Error('Invalid OAuth state');
    const identity = await linkedin.exchangeCallback({ code: req.query.code, state: req.query.state }, transaction);
    const ticket = crypto.randomBytes(32).toString('base64url');
    await store.put('linkedin-ticket', ticket, { identity, mode: transaction.mode, userId: transaction.userId }, 120);
    res.clearCookie('linkedin_oauth_bind', { path: '/api/auth/linkedin' });
    return res.redirect(`${frontend}/oauth/linkedin#ticket=${encodeURIComponent(ticket)}&mode=${transaction.mode}`);
  } catch (error) {
    return res.redirect(`${frontend}/oauth/linkedin#error=failed`);
  }
});

router.post('/complete', limiter, async (req, res, next) => {
  let identity;
  try {
    const ticket = await store.consume('linkedin-ticket', req.body?.ticket);
    if (!ticket || ticket.mode !== 'register') return res.status(400).json({ error: 'LinkedIn-сессия истекла' });
    identity = ticket.identity;
    let result;
    await sequelize.transaction(async (transaction) => {
      const account = await LawyerOAuthAccount.findOne({
        where: { provider: 'linkedin', providerAccountId: identity.subject },
        include: [{ model: User, as: 'user', required: true }],
        transaction,
      });
      if (account) {
        if (!account.user?.isActive) throw Object.assign(new Error('ACCOUNT_INACTIVE'), { status: 403 });
        await account.update({ lastLoginAt: new Date() }, { transaction });
        result = issueFor(account.user);
        return;
      }
      if (!identity.email || !identity.emailVerified) throw Object.assign(new Error('VERIFIED_EMAIL_REQUIRED'), { status: 400 });
      const existing = await User.findOne({ where: { email: { [Op.iLike]: identity.email } }, transaction });
      if (existing) throw Object.assign(new Error('ACCOUNT_LINK_REQUIRED'), { status: 409 });
      const name = `${identity.givenName} ${identity.familyName}`.trim() || 'Юрист';
      const user = await User.create({
        name,
        email: identity.email,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'lawyer',
        avatar: identity.picture,
        isVerified: true,
        isActive: true,
        legalAcceptedAt: new Date(),
        legalVersion: LEGAL_VERSION,
      }, { transaction });
      await LawyerProfile.create({
        userId: user.id,
        specialization: 'Не указана',
        specializations: [],
        verificationStatus: 'draft',
        isAvailable: false,
      }, { transaction });
      await LawyerOAuthAccount.create({
        userId: user.id,
        provider: 'linkedin',
        providerAccountId: identity.subject,
        providerEmail: identity.email,
        lastLoginAt: new Date(),
      }, { transaction });
      result = issueFor(user);
    });
    return res.status(result.twoFactorRequired ? 200 : 201).json(result);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' && identity?.subject) {
      const account = await LawyerOAuthAccount.findOne({
        where: { provider: 'linkedin', providerAccountId: identity.subject },
        include: [{ model: User, as: 'user', required: true }],
      });
      if (account?.user?.isActive) return res.json(issueFor(account.user));
      return res.status(409).json({ error: 'Требуется привязка существующего аккаунта', code: 'ACCOUNT_LINK_REQUIRED' });
    }
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.message });
    return next(error);
  }
});

router.post('/link/complete', limiter, authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const ticket = await store.consume('linkedin-ticket', req.body?.ticket);
    if (!ticket || ticket.mode !== 'link' || ticket.userId !== req.userId) return res.status(400).json({ error: 'LinkedIn-сессия истекла' });
    await LawyerOAuthAccount.create({
      userId: req.userId,
      provider: 'linkedin',
      providerAccountId: ticket.identity.subject,
      providerEmail: ticket.identity.email || null,
      lastLoginAt: new Date(),
    });
    return res.json({ success: true });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'LinkedIn уже привязан' });
    return next(error);
  }
});

module.exports = router;
