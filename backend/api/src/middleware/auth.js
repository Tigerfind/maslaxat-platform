const jwt = require('jsonwebtoken');
const { User, LawyerProfile } = require('../models');
const { passwordStateFor } = require('../services/authChallengeService');
const logger = require('../config/logger');
const { ALL_MODES, getAuthorizationSurface, resolveHttpAuthorizationSurface } = require('../config/authorizationSurfaces');
const {
  getAuthorizationMode,
  recordAuthorizationDecision,
} = require('../services/authorizationRuntime');

const VALID_MODES = ['client', 'lawyer', 'admin'];
const CAPABILITY_MODES = {
  client: 'client',
  lawyerApplicant: 'lawyer',
  lawyer: 'lawyer',
  admin: 'admin',
};

const deriveCapabilities = (user, profile, authLevel = 'primary') => {
  if (!user || !user.isActive) return [];

  if (user.accountType === 'admin') {
    return user.twoFactorEnabled && authLevel === 'mfa' ? ['admin'] : [];
  }

  if (user.accountType !== 'member') return [];

  const capabilities = ['client'];
  if (!profile) return capabilities;

  capabilities.push('lawyerApplicant');
  if (
    profile.verificationStatus === 'approved'
    && profile.operatingStatus === 'enabled'
    && user.twoFactorEnabled
    && authLevel === 'mfa'
  ) {
    capabilities.push('lawyer');
  }
  return capabilities;
};

const modesForCapabilities = (capabilities = []) => {
  const modes = [];
  if (capabilities.includes('client')) modes.push('client');
  if (capabilities.includes('lawyerApplicant') || capabilities.includes('lawyer')) modes.push('lawyer');
  if (capabilities.includes('admin')) modes.push('admin');
  return modes;
};

const resolveAccountMode = (req, res, requireExplicit = true) => {
  const rawMode = req.get('X-Maslaxat-Mode');
  const availableModes = modesForCapabilities(req.capabilities);

  if (rawMode !== undefined && !VALID_MODES.includes(rawMode)) {
    res.status(400).json({ error: 'Некорректный режим аккаунта', code: 'INVALID_MODE' });
    return false;
  }
  if (rawMode !== undefined && !availableModes.includes(rawMode)) {
    res.status(403).json({ error: 'Режим аккаунта недоступен', code: 'MODE_FORBIDDEN' });
    return false;
  }
  if (rawMode !== undefined) {
    req.accountMode = rawMode;
    return true;
  }
  if (availableModes.length === 1) {
    [req.accountMode] = availableModes;
    return true;
  }
  if (requireExplicit && availableModes.length > 1) {
    res.status(400).json({ error: 'Укажите режим аккаунта', code: 'MODE_REQUIRED' });
    return false;
  }
  return true;
};

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Промежуточный токен-вызов 2FA (twofa:'pending') НЕ является полноценным
    // токеном доступа — с ним нельзя ходить по защищённым роутам, только пройти
    // второй шаг входа (/auth/login/2fa). Иначе 2FA полностью обходится.
    if (decoded.twofa) {
      return res.status(401).json({ error: 'Требуется подтверждение 2FA' });
    }

    const user = await User.findByPk(decoded.id, {
      include: [{ model: LawyerProfile, as: 'profile', required: false }],
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }

    const currentPasswordState = passwordStateFor(user);
    if (decoded.passwordState !== undefined) {
      if (String(decoded.passwordState) !== currentPasswordState) {
        return res.status(401).json({ error: 'Сессия недействительна, войдите заново' });
      }
    } else if (user.passwordChangedAt) {
      // Legacy JWTs have second-granularity only. Preserve the conservative
      // fallback until all pre-passwordState sessions expire.
      if (
        !decoded.iat
        || decoded.iat * 1000 < new Date(user.passwordChangedAt).getTime()
      ) {
        return res.status(401).json({ error: 'Сессия недействительна, войдите заново' });
      }
    }

    req.user = user;
    req.userId = user.id;
    req.userRole = user.role;
    req.userProfile = user.profile || null;
    req.authLevel = decoded.authLevel === 'mfa' ? 'mfa' : 'primary';
    if (
      req.authLevel === 'mfa'
      && (!Number.isInteger(decoded.twoFactorVersion)
        || decoded.twoFactorVersion !== user.twoFactorVersion)
    ) {
      return res.status(401).json({ error: 'Сессия 2FA недействительна, войдите заново' });
    }
    req.capabilities = deriveCapabilities(user, req.userProfile, req.authLevel);
    if (!resolveAccountMode(req, res, false)) return;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Токен истёк' });
    }
    return res.status(401).json({ error: 'Невалидный токен' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
};

const requireCapability = (...requiredCapabilities) => {
  return (req, res, next) => {
    if (!resolveAccountMode(req, res, true)) return;
    const granted = requiredCapabilities.filter((capability) => req.capabilities.includes(capability));
    if (!granted.length) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    if (!granted.some((capability) => CAPABILITY_MODES[capability] === req.accountMode)) {
      return res.status(403).json({
        error: 'Режим аккаунта не соответствует требуемым правам',
        code: 'MODE_CAPABILITY_MISMATCH',
      });
    }
    next();
  };
};

const capabilityForRequest = (capability, req) => {
  if (typeof capability === 'function') return capability(req);
  if (capability && typeof capability === 'object') return capability[req.accountMode];
  return capability;
};

const evaluateAuthorizationDecision = async ({
  authorizationMode,
  channel,
  surface,
  mode,
  legacyAllowed,
  capabilityAllowed,
  recordDecision = recordAuthorizationDecision,
  compatibilityAuthority = 'both',
}) => {
  getAuthorizationSurface(surface, mode);
  if (!['compatibility', 'capability_only'].includes(authorizationMode)
    || !['both', 'legacy'].includes(compatibilityAuthority)) {
    throw new Error('Invalid authorization mode');
  }
  await recordDecision({ channel, surface, mode, legacyAllowed, capabilityAllowed });
  const mismatch = legacyAllowed !== capabilityAllowed;
  logger.info('auth_compatibility_decision', {
    channel, surface, mode, legacyAllowed, capabilityAllowed, mismatch,
  });
  if (mismatch) {
    logger.info('auth_capability_mismatch', {
      channel, route: surface, mode, legacyAllowed, capabilityAllowed,
    });
  }
  return {
    allowed: authorizationMode === 'capability_only'
      ? capabilityAllowed
      : compatibilityAuthority === 'legacy' ? legacyAllowed : legacyAllowed && capabilityAllowed,
    mismatch,
  };
};

const authorizeCompat = ({
  legacyRoles,
  capability,
  telemetryName,
  authorizationMode = getAuthorizationMode,
  recordDecision = recordAuthorizationDecision,
  surfaceResolver = (req) => resolveHttpAuthorizationSurface(req.method, req.originalUrl, null),
  reachableModes = ALL_MODES,
  stage = null,
}) => {
  const middleware = async (req, res, next) => {
    if (!resolveAccountMode(req, res, true)) return;

    const requiredCapability = capabilityForRequest(capability, req);
    const decisionMode = req.accountMode || CAPABILITY_MODES[requiredCapability];
    const legacyAllowed = legacyRoles.includes(req.userRole);
    const capabilityAllowed = Boolean(
      requiredCapability
      && req.capabilities.includes(requiredCapability)
      && CAPABILITY_MODES[requiredCapability] === req.accountMode
    );

    let decision;
    try {
      decision = await evaluateAuthorizationDecision({
        authorizationMode: authorizationMode(),
        channel: 'http',
        surface: surfaceResolver(req),
        mode: decisionMode,
        legacyAllowed,
        capabilityAllowed,
        recordDecision,
      });
    } catch (error) {
      if (error?.code === 'AUTHORIZATION_SURFACE_UNMOUNTED') {
        return res.status(403).json({ error: 'Недостаточно прав' });
      }
      logger.error('authorization_telemetry_unavailable', { channel: 'http', guard: telemetryName });
      return res.status(503).json({
        error: 'Сервис авторизации временно недоступен',
        code: 'AUTHORIZATION_TELEMETRY_UNAVAILABLE',
      });
    }

    if (!decision.allowed) {
      return res.status(403).json({
        error: 'Недостаточно прав',
        ...(decision.mismatch ? { code: 'AUTH_CAPABILITY_MISMATCH' } : {}),
      });
    }
    next();
  };
  middleware.authorizationGuard = {
    legacyRoles: [...legacyRoles],
    modes: [...reachableModes],
    stage,
  };
  return middleware;
};

const authorizeConsultationMode = authorizeCompat({
  legacyRoles: ['client', 'lawyer'],
  capability: { client: 'client', lawyer: 'lawyer' },
  telemetryName: 'http.consultation-participant',
});

const ownsConsultationPerspective = (req, consultation) => {
  if (req.accountMode === 'client') return consultation.clientId === req.userId;
  if (req.accountMode === 'lawyer') return consultation.lawyerId === req.userId;
  return false;
};

module.exports = {
  authenticate,
  authorize,
  authorizeCompat,
  authorizeConsultationMode,
  deriveCapabilities,
  evaluateAuthorizationDecision,
  ownsConsultationPerspective,
  requireCapability,
  modesForCapabilities,
};
