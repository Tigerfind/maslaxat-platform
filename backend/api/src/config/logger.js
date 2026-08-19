const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');
const { getRequestContext } = require('../middleware/requestContext');
const { sanitizeTelemetry } = require('../observability/sanitize');

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';
const LOG_LEVELS = new Set(['error', 'warn', 'info', 'http', 'debug']);
const SAFE_LOG_EVENTS = new Set([
  'application_error',
  'application_log',
  'ai_provider_request_failed',
  'ai_rate_limit_check_failed',
  'auth_capability_mismatch',
  'auth_challenge_cleanup_failed',
  'email_change_verification_send_failed',
  'fatal_process_error',
  'google_token_verify_failed',
  'http_request',
  'notification_create_failed',
  'notification_push_delivery_failed',
  'notification_socket_delivery_failed',
  'password_reset_email_send_failed',
  'payme_webhook_failed',
  'payment_mode_configuration_rejected',
  'payment_v2_shadow',
  'production_promo_seed_skipped',
  'production_seed_startup_failed',
  'reminder_check_failed',
  'reminder_email_failed',
  'reminder_item_failed',
  'request_failed',
  'sms_delivery_failed',
  'sms_delivery_skipped',
  'socket_chat_joined',
  'socket_connected',
  'socket_event_failed',
  'socket_redis_adapter_attach_failed',
  'socket_room_joined',
  'socket_room_left',
  'verification_email_send_failed',
  'web_push_load_subscriptions_failed',
  'web_push_send_failed',
  'web_push_vapid_init_failed',
]);

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

function addRequestContext(info) {
  let suppliedLevel;
  try {
    suppliedLevel = info?.level || info?.[Symbol.for('level')];
  } catch (_error) {
    suppliedLevel = undefined;
  }
  const level = LOG_LEVELS.has(suppliedLevel) ? suppliedLevel : 'info';
  const sanitized = sanitizeTelemetry(info);
  const safe = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : Object.create(null);
  const requestId = getRequestContext().requestId;
  if (requestId && safe && typeof safe === 'object') safe.requestId = requestId;
  if (safe && typeof safe === 'object') {
    delete safe.stack;
    safe.level = level;
    if (typeof safe.message !== 'string' || !SAFE_LOG_EVENTS.has(safe.message)) {
      safe.message = level === 'error' ? 'application_error' : 'application_log';
    }
    Object.defineProperty(safe, Symbol.for('level'), { value: level, enumerable: false });
  }
  return safe;
}

const requestContextFormat = format(addRequestContext);

const logger = createLogger({
  levels: { error: 0, warn: 1, info: 2, http: 3, debug: 4 },
  level: isDev ? 'debug' : 'info',
  silent: isTest, // в тестах не шумим в консоль/файлы
  format: format.combine(
    requestContextFormat(),
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
      requestContextFormat(),
      format.errors({ stack: true }),
      format.json()
    ),
  }));
}

module.exports = logger;
module.exports.addRequestContext = addRequestContext;
module.exports.SAFE_LOG_EVENTS = SAFE_LOG_EVENTS;
