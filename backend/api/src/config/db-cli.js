// Конфиг подключения для sequelize-cli (миграции). Читает те же переменные, что и приложение.
// NODE_ENV выбирает окружение: development / test / production.
require('dotenv').config();

const needSsl = process.env.DB_SSL === '1' || /sslmode=require/.test(process.env.DATABASE_URL || '');
const sslOpt = needSsl ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } } : {};

const base = {
  username: process.env.DB_USER || 'macbook',
  password: process.env.DB_PASSWORD || null,
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false,
  define: { underscored: true },
  ...sslOpt,
};

// Управляемые хостинги отдают DATABASE_URL — sequelize-cli поддерживает `url`.
// Если она есть, используем её (иначе отдельные DB_*).
const prod = process.env.DATABASE_URL
  ? { url: process.env.DATABASE_URL, dialect: 'postgres', logging: false, define: { underscored: true }, ...sslOpt }
  : { ...base, database: process.env.DB_NAME };

module.exports = {
  development: { ...base, database: process.env.DB_NAME || 'emaslaxat' },
  test: { ...base, database: process.env.TEST_DB_NAME || 'emaslaxat_test' },
  production: prod,
};
