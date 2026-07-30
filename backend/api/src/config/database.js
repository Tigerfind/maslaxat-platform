const { Sequelize } = require('sequelize');

const commonOptions = {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
  define: {
    timestamps: true,
    underscored: true,
  },
};

// Управляемые хостинги (Railway/Render/Heroku) отдают одну строку подключения DATABASE_URL.
// Если она есть — используем её; иначе собираем из отдельных DB_* (локально/Docker).
// DB_SSL=1 или sslmode=require в URL включает TLS для внешних управляемых БД.
const needSsl = process.env.DB_SSL === '1' || /sslmode=require/.test(process.env.DATABASE_URL || '');
if (needSsl) {
  commonOptions.dialectOptions = { ssl: { require: true, rejectUnauthorized: false } };
}

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, commonOptions)
  : new Sequelize(
      process.env.DB_NAME || 'emaslaxat',
      process.env.DB_USER || 'emaslaxat_user',
      process.env.DB_PASSWORD || 'password',
      {
        ...commonOptions,
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
      }
    );

module.exports = sequelize;
