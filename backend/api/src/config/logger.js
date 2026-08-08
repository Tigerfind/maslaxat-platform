const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// Файловые логи пишем только если папку удалось создать (в контейнере/проде
// корневая ФС read-only — тогда падать нельзя, логи идут в stdout, который
// собирает платформа: Railway/Docker/PM2).
const logsDir = path.join(__dirname, '../../logs');
let fileLoggingEnabled = false;
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  fs.accessSync(logsDir, fs.constants.W_OK);
  fileLoggingEnabled = true;
} catch (e) {
  fileLoggingEnabled = false; // нет прав на запись — обходимся stdout
}

const fileTransports = fileLoggingEnabled ? [
  new transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    maxsize: 5 * 1024 * 1024,  // 5 МБ
    maxFiles: 5,
  }),
  new transports.File({
    filename: path.join(logsDir, 'combined.log'),
    maxsize: 10 * 1024 * 1024, // 10 МБ
    maxFiles: 10,
  }),
] : [];

const logger = createLogger({
  levels: { error: 0, warn: 1, info: 2, http: 3, debug: 4 },
  level: isDev ? 'debug' : 'info',
  silent: isTest, // в тестах не шумим в консоль/файлы
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: fileTransports,
});

// В dev — красивый цветной вывод в консоль.
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

// В проде ВСЕГДА пишем JSON в stdout — контейнерная платформа (Railway/Docker)
// собирает именно stdout, и логи должны быть видны в её дашборде независимо от
// того, доступна ли запись файлов. (В dev stdout уже покрыт цветным Console выше.)
if (!isDev && !isTest) {
  logger.add(new transports.Console({
    format: format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.errors({ stack: true }),
      format.json()
    ),
  }));
}

module.exports = logger;
