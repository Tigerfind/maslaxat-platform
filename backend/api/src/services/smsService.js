const logger = require('../config/logger');

/**
 * Отправка SMS для Узбекистана. Поддерживаются два провайдера:
 *   - Eskiz.uz     (SMS_PROVIDER=eskiz)     — REST + JWT-токен (логин e-mail/пароль, TTL ~30д)
 *   - Play Mobile  (SMS_PROVIDER=playmobile) — REST Basic-auth (send.smsxabar.uz)
 *
 * Провайдер выбирается через SMS_PROVIDER; если не задан — определяется автоматически
 * по наличию ключей. Без ключей НЕ падаем: логируем текст (dev), чтобы вход по телефону
 * работал локально. isConfigured() → есть ли настоящий провайдер.
 *
 * Все сетевые ошибки проглатываются (лог + { sent:false, error }); sendSms НИКОГДА не
 * бросает — вызывающий флоу (phone/request) не должен падать из-за провайдера.
 */

// ── выбор провайдера ────────────────────────────────────────────────────────
function detectProvider() {
  const p = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (p) return p;
  if (process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD) return 'eskiz';
  if (process.env.PLAYMOBILE_URL && process.env.PLAYMOBILE_LOGIN) return 'playmobile';
  return '';
}

function isConfigured() {
  const p = detectProvider();
  if (p === 'eskiz') return Boolean(process.env.ESKIZ_EMAIL && process.env.ESKIZ_PASSWORD);
  if (p === 'playmobile') {
    return Boolean(process.env.PLAYMOBILE_URL && process.env.PLAYMOBILE_LOGIN && process.env.PLAYMOBILE_PASSWORD);
  }
  return false;
}

// digits-only для API (без «+»): 998XXXXXXXXX
function digits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// ── Eskiz.uz ────────────────────────────────────────────────────────────────
// Токен кэшируем в памяти; при 401 логинимся заново. TTL берём с запасом (25 дней),
// реальную инвалидность ловим по 401 от send.
let eskizToken = null;
let eskizTokenExp = 0;

function eskizBase() {
  return (process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz/api').replace(/\/$/, '');
}

async function eskizLogin() {
  const form = new URLSearchParams();
  form.set('email', process.env.ESKIZ_EMAIL);
  form.set('password', process.env.ESKIZ_PASSWORD);
  const res = await fetch(`${eskizBase()}/auth/login`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  const token = data && data.data && data.data.token;
  if (!res.ok || !token) {
    throw new Error(`Eskiz login failed (${res.status}): ${data && data.message ? data.message : 'no token'}`);
  }
  eskizToken = token;
  eskizTokenExp = Date.now() + 25 * 24 * 60 * 60 * 1000; // 25 дней
  return token;
}

async function eskizEnsureToken() {
  if (eskizToken && Date.now() < eskizTokenExp) return eskizToken;
  return eskizLogin();
}

async function eskizSendOnce(token, phone, text) {
  const form = new URLSearchParams();
  form.set('mobile_phone', digits(phone));
  form.set('message', text);
  form.set('from', process.env.ESKIZ_FROM || '4546'); // 4546 — тестовый отправитель Eskiz
  const res = await fetch(`${eskizBase()}/message/sms/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function sendViaEskiz(phone, text) {
  let token = await eskizEnsureToken();
  let { res, data } = await eskizSendOnce(token, phone, text);
  if (res.status === 401) {
    // токен протух — один повтор после свежего логина
    eskizToken = null;
    token = await eskizLogin();
    ({ res, data } = await eskizSendOnce(token, phone, text));
  }
  if (!res.ok) {
    throw new Error(`Eskiz send failed (${res.status}): ${data && data.message ? data.message : 'unknown'}`);
  }
  return { sent: true, provider: 'eskiz', id: data && (data.id || (data.data && data.data.id)) };
}

// ── Play Mobile (send.smsxabar.uz) ──────────────────────────────────────────
// Basic-auth REST: POST {url}  { messages: [{ recipient, message-id, sms:{ originator, content:{ text } } }] }
async function sendViaPlayMobile(phone, text) {
  const url = process.env.PLAYMOBILE_URL;
  const auth = Buffer.from(`${process.env.PLAYMOBILE_LOGIN}:${process.env.PLAYMOBILE_PASSWORD}`).toString('base64');
  const body = {
    messages: [
      {
        recipient: digits(phone),
        'message-id': `m${Date.now()}${Math.floor(Math.random() * 1000)}`,
        sms: {
          originator: process.env.PLAYMOBILE_FROM || '3700',
          content: { text },
        },
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Play Mobile send failed (${res.status}): ${t.slice(0, 200)}`);
  }
  return { sent: true, provider: 'playmobile' };
}

// ── публичный API ───────────────────────────────────────────────────────────
async function sendSms(phone, text) {
  if (!isConfigured()) {
    if (process.env.NODE_ENV !== 'production') logger.info(`[SMS dev] → ${phone}: ${text}`);
    else logger.warn('[SMS] провайдер не настроен — сообщение не отправлено');
    return { sent: false, dev: true };
  }
  const provider = detectProvider();
  try {
    if (provider === 'eskiz') return await sendViaEskiz(phone, text);
    if (provider === 'playmobile') return await sendViaPlayMobile(phone, text);
    logger.warn(`[SMS] неизвестный провайдер "${provider}" → не отправлено`);
    return { sent: false, error: 'unknown provider' };
  } catch (e) {
    logger.error(`[SMS] отправка не удалась (${provider}): ${e.message}`);
    return { sent: false, error: e.message };
  }
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
