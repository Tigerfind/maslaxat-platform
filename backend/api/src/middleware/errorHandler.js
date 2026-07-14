const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || err.status || 500;

  // Логируем с контекстом запроса
  logger.error(err.message, {
    status,
    method: req.method,
    url: req.originalUrl,
    userId: req.userId || null,
    stack: err.stack,
  });

  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Ошибка валидации',
      details: err.errors.map((e) => e.message),
    });
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'Такая запись уже существует' });
  }

  // В продакшне не отдаём stack trace клиенту
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({
    error: isProd && status === 500 ? 'Внутренняя ошибка сервера' : (err.message || 'Внутренняя ошибка сервера'),
    ...(isProd ? {} : { stack: err.stack }),
  });
};

module.exports = { errorHandler };
