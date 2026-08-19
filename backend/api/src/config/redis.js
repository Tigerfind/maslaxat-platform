const { createClient } = require('redis');

let redisClient = null;

const connectRedis = async () => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: false,
      },
    });

    redisClient.on('error', (err) => {
      console.warn('Redis error:', err.message);
    });

    await redisClient.connect();
    console.log('Redis connected');
    return redisClient;
  } catch (error) {
    console.warn('Redis unavailable, running without cache');
    redisClient = null;
    return null;
  }
};

const getRedis = () => redisClient;

const closeRedis = async () => {
  const client = redisClient;
  redisClient = null;
  if (!client?.isOpen) return;
  await client.quit();
};

module.exports = { connectRedis, getRedis, closeRedis };
