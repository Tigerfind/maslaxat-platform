const { createClient } = require('redis');
const logger = require('./logger');

let redisClient = null;
let lastErrorLogAt = 0;
let lastReconnectLogAt = 0;

const redisReconnectDelay = (retries) => Math.min(5000, 250 * (2 ** Math.min(retries, 5)));

const connectRedis = async () => {
  if (redisClient?.isReady) return redisClient;
  if (redisClient?.isOpen) return null;

  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: redisReconnectDelay,
      },
    });

    redisClient.on('error', (err) => {
      const now = Date.now();
      if (now - lastErrorLogAt >= 30000) {
        lastErrorLogAt = now;
        logger.warn('Redis connection error', { message: err.message });
      }
    });
    redisClient.on('ready', () => logger.info('Redis connected'));
    redisClient.on('reconnecting', () => {
      const now = Date.now();
      if (now - lastReconnectLogAt >= 30000) {
        lastReconnectLogAt = now;
        logger.warn('Redis reconnecting');
      }
    });

    const connection = redisClient.connect();
    connection.catch((error) => logger.warn('Redis background reconnect failed', { message: error.message }));
    let timeout;
    try {
      await Promise.race([
        connection,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis initial connection timeout')), 3500);
          timeout.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    return redisClient.isReady ? redisClient : null;
  } catch (error) {
    // The client remains alive and keeps reconnecting in the background.
    logger.warn('Redis unavailable, running with local fallbacks', { message: error.message });
    return null;
  }
};

const getRedis = () => (redisClient?.isReady ? redisClient : null);

module.exports = { connectRedis, getRedis, redisReconnectDelay };
