const { getRedis } = require('../config/redis');

const WINDOW_SECONDS = 60 * 60;
const LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;
const LIMITS = { upload: 5, parse: 3 };

function quotaError(status, code, retryAfter) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  if (retryAfter !== undefined) error.retryAfter = retryAfter;
  return error;
}

function createProfileImportRateLimit({
  getRedisClient = getRedis,
  environment = process.env.NODE_ENV,
  allowMemoryFallback = process.env.PROFILE_IMPORT_RATE_LIMIT_FALLBACK === 'memory',
  now = Date.now,
} = {}) {
  const memoryCounters = new Map();
  const reservations = new WeakMap();

  function consumeMemory(key) {
    const currentTime = now();
    const existing = memoryCounters.get(key);
    const next = existing && existing.expiresAt > currentTime ? existing.count + 1 : 1;
    memoryCounters.set(key, { count: next, expiresAt: currentTime + (WINDOW_SECONDS * 1000) });
    return next;
  }

  async function consume(kind, ownerId) {
    const limit = LIMITS[kind];
    if (!limit) throw quotaError(400, 'INVALID_PROFILE_IMPORT_QUOTA');
    if (!ownerId) throw quotaError(401, 'AUTHENTICATION_REQUIRED');

    const currentTime = now();
    const hour = Math.floor(currentTime / (WINDOW_SECONDS * 1000));
    const key = `profile_import:${kind}:${String(ownerId)}:${hour}`;
    let count;
    try {
      const redis = getRedisClient();
      if (redis) {
        const result = await redis.eval(LIMIT_SCRIPT, {
          keys: [key],
          arguments: [String(WINDOW_SECONDS)],
        });
        count = Number(result);
        if (result === null || !Number.isInteger(count) || count < 1) {
          throw new Error('Invalid rate-limit response');
        }
      } else if (['test', 'development'].includes(environment) && allowMemoryFallback) {
        count = consumeMemory(key);
      } else {
        throw quotaError(503, 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE');
      }
    } catch (error) {
      if (error.code === 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE') throw error;
      throw quotaError(503, 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE');
    }

    if (count > limit) {
      const elapsedSeconds = Math.floor(currentTime / 1000) % WINDOW_SECONDS;
      throw quotaError(429, 'PROFILE_IMPORT_RATE_LIMITED', WINDOW_SECONDS - elapsedSeconds);
    }
    return count;
  }

  async function reserve(kind, ownerId) {
    await consume(kind, ownerId);
    const token = Object.freeze(Object.create(null));
    reservations.set(token, { kind, ownerId: String(ownerId), used: false });
    return token;
  }

  function consumeReservation(token, kind, ownerId) {
    const reservation = token && typeof token === 'object' ? reservations.get(token) : null;
    if (!reservation || reservation.used
      || reservation.kind !== kind || reservation.ownerId !== String(ownerId)) {
      throw quotaError(403, 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID');
    }
    reservation.used = true;
  }

  function middleware(kind, limit, issueReservation = false) {
    return async (req, res, next) => {
      const ownerId = String(req.userId || '');
      if (!ownerId) return res.status(401).json({ code: 'AUTHENTICATION_REQUIRED' });

      try {
        // Keep the legacy middleware shape while delegating to the same worker-safe primitive.
        if (LIMITS[kind] !== limit) throw quotaError(400, 'INVALID_PROFILE_IMPORT_QUOTA');
        if (issueReservation) {
          req.profileImportQuotaReservation = await reserve(kind, ownerId);
        } else {
          await consume(kind, ownerId);
        }
        return next();
      } catch (error) {
        return res.status(error.status || 503).json({ code: error.code || 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE' });
      }
    };
  }

  return {
    consume,
    reserve,
    consumeReservation,
    limitUploads: middleware('upload', 5, true),
    limitParserStarts: middleware('parse', 3),
  };
}

const defaultRateLimits = createProfileImportRateLimit();

module.exports = {
  createProfileImportRateLimit,
  profileImportQuota: defaultRateLimits,
  limitProfileImportUploads: defaultRateLimits.limitUploads,
  limitProfileImportParserStarts: defaultRateLimits.limitParserStarts,
};
