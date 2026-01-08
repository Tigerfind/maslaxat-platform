const { Pool } = require('pg');

let pool;

const connectDatabase = async () => {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await pool.connect();
    console.log('Database connected successfully');
    client.release();

    return pool;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
};

const getDatabase = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDatabase first.');
  }
  return pool;
};

const closeDatabase = async () => {
  if (pool) {
    await pool.end();
    console.log('Database connection closed');
  }
};

module.exports = {
  connectDatabase,
  getDatabase,
  closeDatabase
};