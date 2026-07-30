const logger = require('../config/logger');

/**
 * Отправка SMS. Реальный провайдер для Узбекистана (Eskiz / Play Mobile) подключается
 * ключами в Фазе 6. Без ключей НЕ падаем: логируем текст (dev), чтобы можно было
 * тестировать вход по телефону. isConfigured() → есть ли реальный провайдер.
 */
const isConfigured = () => Boolean(process.env.SMS_API_URL && process.env.SMS_API_TOKEN);

async function sendSms(phone, text) {
  if (!isConfigured()) {
    logger.info(`[SMS dev] → ${phone}: ${text}`);
    return { sent: false, dev: true };
  }
  // TODO Фаза 6: реальная отправка через провайдера (Eskiz/Play Mobile) по SMS_API_*.
  // Пока провайдер не реализован — тоже логируем, чтобы флоу не падал.
  logger.info(`[SMS] (провайдер не подключён) → ${phone}: ${text}`);
  return { sent: false, dev: false };
}

// Нормализация узбекского номера к виду +998XXXXXXXXX (12 цифр после +).
function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;                    // локальный 9-значный
  else if (d.startsWith('8') && d.length === 12) d = '998' + d.slice(1);
  if (d.length !== 12 || !d.startsWith('998')) return null;
  return '+' + d;
}

module.exports = { sendSms, isConfigured, normalizePhone };
