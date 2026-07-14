const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// Создаём папку logs если её нет
const logsDir = path.join(__dirname, '../../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isDev = process.env.NODE_ENV !== 'production';

const logger = createLogger({
  levels: { error: 0, warn: 1, info: 2, http: 3, debug: 4 },
  level: isDev ? 'debug' : 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    // Все ошибки → logs/error.log
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,  // 5 МБ
      maxFiles: 5,
    }),
    // Все логи → logs/combined.log
    new transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024, // 10 МБ
      maxFiles: 10,
    }),
  ],
});

// В dev-режиме — красивый вывод в консоль
if (isDev) {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.printf(({ level, message, timestamp, ...meta }) => {
        const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}]: ${message}${extra}`;
      })
    ),
  }));
}

module.exports = logger;
