const crypto = require('crypto');
const { getRedis } = require('../config/redis');

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

function leaseLostError(cause) {
  return Object.assign(new Error('Redis lease ownership was lost before job completion'), {
    name: 'LeaseLostError',
    code: 'LEASE_LOST',
    ...(cause ? { cause } : {}),
  });
}

async function withRedisLock(name, ttlMs, fn, options = {}) {
  if (!name || !Number.isInteger(ttlMs) || ttlMs < 10 || typeof fn !== 'function') {
    throw new TypeError('name, ttlMs >= 10, and function are required');
  }
  const redis = options.redis === undefined ? getRedis() : options.redis;
  if (!redis) return { acquired: false, reason: 'redis_unavailable' };
  const key = `jobs:lock:${name}`;
  const token = crypto.randomUUID();
  try {
    const acquired = await redis.set(key, token, { NX: true, PX: ttlMs });
    if (acquired !== 'OK') return { acquired: false, reason: 'locked' };
  } catch (_error) {
    return { acquired: false, reason: 'redis_unavailable' };
  }

  const controller = new AbortController();
  let lost = false;
  let finishing = false;
  let renewalInFlight = null;
  const renewEveryMs = options.renewEveryMs || Math.max(5, Math.floor(ttlMs / 3));
  const renew = () => {
    if (renewalInFlight || lost || finishing) return;
    const operation = (async () => {
      try {
        const renewed = await redis.eval(RENEW_SCRIPT, {
          keys: [key], arguments: [token, String(ttlMs)],
        });
        if (renewed !== 1) {
          lost = true;
          controller.abort(new Error('Redis lease lost'));
        }
      } catch (_error) {
        lost = true;
        controller.abort(new Error('Redis lease renewal failed'));
      }
    })();
    renewalInFlight = operation.finally(() => {
      if (renewalInFlight === tracked) renewalInFlight = null;
    });
    const tracked = renewalInFlight;
  };
  const renewal = setInterval(() => {
    renew();
  }, renewEveryMs);
  renewal.unref?.();

  let value;
  let callbackError;
  try {
    value = await fn({ signal: controller.signal, token });
  } catch (error) {
    callbackError = error;
  }

  finishing = true;
  clearInterval(renewal);
  if (renewalInFlight) await renewalInFlight;

  let releaseError;
  let released = 0;
  try {
    released = await redis.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
  } catch (error) {
    releaseError = error;
  }
  if (released !== 1 || releaseError) {
    lost = true;
  }
  if (lost) throw leaseLostError(releaseError || callbackError);
  if (callbackError) throw callbackError;
  return { acquired: true, value, lost: false };
}

module.exports = { withRedisLock, leaseLostError, RENEW_SCRIPT, RELEASE_SCRIPT };
