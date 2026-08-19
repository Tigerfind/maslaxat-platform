const logger = require('../config/logger');
const { sanitizeUrl } = require('../observability/sanitize');

const SAFE_ERRORS = Object.freeze({
  AUTHENTICATION_REQUIRED: { message: 'Authentication required' },
  BOOKING_TERMS_CHANGED: { message: 'Booking terms changed' },
  CONTACT_UNVERIFIED: { message: 'Contact verification required' },
  IMPORT_ALREADY_CONFIRMED: { message: 'Import already confirmed' },
  IMPORT_EXPIRED: { message: 'Import expired' },
  IMPORT_NOT_FOUND: { message: 'Import not found' },
  IMPORT_STATE_CONFLICT: { message: 'Import state conflict' },
  IMPORT_VERSION_CONFLICT: { message: 'Import version conflict', details: ['currentVersion'] },
  INCOMPATIBLE_VERIFICATION_DOCUMENT: { message: 'Incompatible verification document' },
  INSUFFICIENT_FUNDS: { message: 'Insufficient funds' },
  INVALID_ACCEPTED_PATHS: { message: 'Invalid accepted paths' },
  INVALID_ATTACHMENT: { message: 'Invalid AI attachment' },
  INVALID_AUTH_CHALLENGE: { message: 'Invalid authentication challenge' },
  INVALID_IDEMPOTENCY_KEY: { message: 'Invalid Idempotency-Key' },
  INVALID_ID: { message: 'Invalid identifier' },
  INVALID_METADATA_JSON: { message: 'Invalid file metadata' },
  INVALID_IMPORT_DRAFT: { message: 'Invalid import draft' },
  INVALID_LINKEDIN_URL: { message: 'Invalid LinkedIn profile URL' },
  INVALID_PDF_UPLOAD: { message: 'Invalid PDF upload' },
  INVALID_PROFILE_IMPORT_QUOTA: { message: 'Invalid profile import quota' },
  INVALID_SPECIALIZATION: { message: 'Invalid specialization' },
  INVALID_VERIFICATION_FIELD: { message: 'Invalid verification field' },
  LAWYER_2FA_REQUIRED: { message: 'Lawyer 2FA required' },
  PDF_IMPORT_FAILED: { message: 'PDF import failed' },
  PDF_IMPORT_UNAVAILABLE: { message: 'PDF import unavailable' },
  PROFILE_IMPORT_OBJECT_MISMATCH: { message: 'Profile import object validation failed' },
  PROFILE_IMPORT_RATE_LIMITED: { message: 'Profile import rate limit exceeded', retry: true },
  PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE: { message: 'Profile import rate limit unavailable' },
  PROFILE_IMPORT_QUOTA_RESERVATION_INVALID: { message: 'Profile import quota reservation invalid' },
  PROFILE_NOT_FOUND: { message: 'Profile not found' },
  PROFILE_REVISION_CONFLICT: { message: 'Profile revision conflict', details: ['currentProfileRevision'] },
  PROFILE_REVISION_REQUIRED: { message: 'Profile revision required' },
  SELF_BOOKING_FORBIDDEN: { message: 'Self-booking is forbidden' },
  TWO_FACTOR_REQUIRED: { message: 'Two-factor authentication required' },
  UNSAFE_LOCAL_STORAGE_PATH: { message: 'Unsafe local storage path' },
  VERIFICATION_DOCUMENT_REQUIRED: { message: 'Verification document required' },
});
const SAFE_ERROR_NAMES = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
  'EvalError', 'AggregateError', 'SequelizeValidationError', 'SequelizeUniqueConstraintError',
]);

function safeDetails(details, allowedKeys = []) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const allowlist = new Set(allowedKeys);
  const safe = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowlist.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      || (Array.isArray(value) && value.every((item) => typeof item === 'string'))) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length ? safe : undefined;
}

function safeRequestMeta(req) {
  return {
    method: req.method,
    pathname: sanitizeUrl(req.path || '/'),
    route: req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null,
    requestId: req.requestId || null,
    userId: req.userId || null,
  };
}

const errorHandler = (err, req, res, next) => {
  const suppliedStatus = err.statusCode || err.status;
  const status = Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599
    ? suppliedStatus
    : 500;
  const safeError = typeof err.code === 'string' ? SAFE_ERRORS[err.code] : undefined;

  logger.error('request_failed', {
    errorName: SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error',
    safeCode: safeError ? err.code : undefined,
    requestId: req.requestId || null,
    route: req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : null,
    status,
  });

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({ error: 'Ошибка валидации' });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'Такая запись уже существует' });
  }

  // В продакшне не отдаём stack trace клиенту
  const isProd = process.env.NODE_ENV === 'production';
  const code = safeError ? err.code : undefined;
  const retryAfter = safeError?.retry
    && Number.isInteger(err.retryAfter) && err.retryAfter >= 1 && err.retryAfter <= 86400
    ? err.retryAfter
    : undefined;
  const details = safeDetails(err.details, safeError?.details);
  if (retryAfter) res.set('Retry-After', String(retryAfter));
  res.status(status).json({
    error: safeError?.message
      || (isProd || status >= 500 ? 'Внутренняя ошибка сервера' : 'Ошибка запроса'),
    ...(code ? { code } : {}),
    ...(retryAfter ? { retryAfter } : {}),
    ...(details ? { details } : {}),
  });
};

module.exports = { errorHandler, safeDetails, safeRequestMeta, SAFE_ERRORS };
