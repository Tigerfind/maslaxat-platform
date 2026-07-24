// Конфиг подключения для sequelize-cli (миграции). Читает те же переменные, что и приложение.
// NODE_ENV выбирает окружение: development / test / production.
require('dotenv').config();

const base = {
  username: process.env.DB_USER || 'macbook',
  password: process.env.DB_PASSWORD || null,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false,
  define: { underscored: true },
};

module.exports = {
  development: { ...base, database: process.env.DB_NAME || 'emaslaxat' },
  test: { ...base, database: 'emaslaxat_test' },
  production: { ...base, database: process.env.DB_NAME },
};
