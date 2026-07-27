const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const logger = require('../config/logger');

// Соц-вход. Всё fail-safe: без ключей провайдер просто отключён (enabled=false),
// фронт прячет кнопки. Ключи — только через .env / секреты платформы.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function config() {
  return {
    google: { enabled: !!GOOGLE_CLIENT_ID, clientId: GOOGLE_CLIENT_ID || null },
    telegram: { enabled: !!TELEGRAM_BOT_TOKEN, botUsername: TELEGRAM_BOT_USERNAME || null },
  };
}

function googleEnabled() { return !!googleClient; }
function telegramEnabled() { return !!TELEGRAM_BOT_TOKEN; }

// Проверяет Google ID-token, возвращает { googleId, email, name, avatar } или null
async function verifyGoogleToken(credential) {
  if (!googleClient || !credential) return null;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || !p.email) return null;
    // Требуем подтверждённый Google email — иначе нельзя связывать по email с
    // существующим аккаунтом (иначе возможен захват чужого аккаунта).
    if (p.email_verified !== true) return null;
    return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name || p.email.split('@')[0], avatar: p.picture || null };
  } catch (err) {
    logger.error('Google token verify failed:', err.message);
    return null;
  }
}

// Проверяет подпись Telegram Login Widget (HMAC-SHA256, ключ = SHA256(bot_token)).
// data — объект полей от виджета (id, first_name, username, auth_date, hash, ...).
function verifyTelegramAuth(data) {
  if (!TELEGRAM_BOT_TOKEN || !data || !data.hash) return null;
  const { hash, ...fields } = data;
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  // Constant-time сравнение (одинаковой длины) вместо !==
  const a = Buffer.from(hmac, 'hex');
  const b = Buffer.from(String(hash), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // Защита от повторного использования старых данных (24 часа)
  const authDate = parseInt(fields.auth_date, 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  const name = [fields.first_name, fields.last_name].filter(Boolean).join(' ') || fields.username || 'Пользователь Telegram';
  return { telegramId: String(fields.id), name, username: fields.username || null, avatar: fields.photo_url || null };
}

module.exports = { config, googleEnabled, telegramEnabled, verifyGoogleToken, verifyTelegramAuth };
