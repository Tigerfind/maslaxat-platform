const crypto = require('crypto');
const { getRedis } = require('../config/redis');

const memory = new Map();
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function backend() {
  const redis = getRedis();
  if (redis) return redis;
  if (process.env.NODE_ENV === 'test') return null;
  throw new Error('OAuth transaction store unavailable');
}

async function put(prefix, id, value, ttlSeconds) {
  const key = `oauth:${prefix}:${hash(id)}`;
  const redis = backend();
  if (redis) {
    const result = await redis.set(key, JSON.stringify(value), { EX: ttlSeconds, NX: true });
    if (result !== 'OK') throw new Error('OAuth transaction collision');
  } else {
    memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

async function consume(prefix, id) {
  const key = `oauth:${prefix}:${hash(id)}`;
  const redis = backend();
  let raw;
  if (redis) raw = await redis.getDel(key);
  else {
    const record = memory.get(key);
    memory.delete(key);
    if (record && record.expiresAt > Date.now()) raw = JSON.stringify(record.value);
  }
  return raw ? JSON.parse(raw) : null;
}

function resetForTests() {
  memory.clear();
}

module.exports = { put, consume, hash, resetForTests };
