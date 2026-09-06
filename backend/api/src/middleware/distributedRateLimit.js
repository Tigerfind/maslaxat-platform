const crypto = require('crypto');
const { getRedis } = require('../config/redis');
const logger = require('../config/logger');

const localCounters = new Map();
let localOperations = 0;

const digest = (value) => crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex');

const localIncrement = (key, windowSeconds) => {
  const now = Date.now();
  localOperations += 1;
  if (localOperations % 100 === 0 || localCounters.size > 10000) {
    for (const [storedKey, value] of localCounters) {
      if (value.expiresAt <= now) localCounters.delete(storedKey);
    }
    while (localCounters.size > 10000) localCounters.delete(localCounters.keys().next().value);
  }
  const current = localCounters.get(key);
  if (!current || current.expiresAt <= now) {
    const next = { count: 1, expiresAt: now + windowSeconds * 1000 };
    localCounters.set(key, next);
    return next;
  }
  current.count += 1;
  return current;
};

const distributedRateLimit = ({ prefix, windowSeconds, max, keyGenerator }) => async (req, res, next) => {
  const rawKey = keyGenerator(req);
  const key = `rate:${prefix}:${digest(rawKey)}`;
  try {
    const redis = getRedis();
    let count;
    let retryAfter = windowSeconds;
    if (redis) {
      const result = await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('TTL',KEYS[1])}",
        { keys: [key], arguments: [String(windowSeconds)] },
      );
      count = Number(result[0]);
      if (Number(result[1]) > 0) retryAfter = Number(result[1]);
    } else {
      const local = localIncrement(key, windowSeconds);
      count = local.count;
      retryAfter = Math.max(1, Math.ceil((local.expiresAt - Date.now()) / 1000));
    }
    if (count > max) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Слишком много запросов, попробуйте позже' });
    }
    next();
  } catch (error) {
    logger.warn('Distributed rate limiter fallback', { prefix, message: error.message });
    const local = localIncrement(key, windowSeconds);
    if (local.count > max) return res.status(429).json({ error: 'Слишком много запросов, попробуйте позже' });
    next();
  }
};

module.exports = { distributedRateLimit };
