const redis = require('redis');

let client;

const connectRedis = async () => {
  try {
    client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('Redis connected successfully');
    });

    await client.connect();
    return client;
  } catch (error) {
    console.error('Redis connection failed:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!client) {
    throw new Error('Redis client not initialized. Call connectRedis first.');
  }
  return client;
};

const closeRedis = async () => {
  if (client) {
    await client.quit();
    console.log('Redis connection closed');
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  closeRedis
};