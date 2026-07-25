const webpush = require('web-push');
const logger = require('../config/logger');
const { PushSubscription } = require('../models');

// VAPID-ключи самогенерируемые (без сторонних сервисов). Если не заданы —
// web-push просто отключён (fail-safe): подписка/отправка становятся no-op,
// остальные уведомления (в БД + socket) работают как прежде.
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@maslaxat.uz';

let enabled = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    enabled = true;
  } catch (err) {
    logger.error('Web-push VAPID init failed:', err.message);
  }
}

function isEnabled() {
  return enabled;
}

function getPublicKey() {
  return enabled ? PUBLIC_KEY : null;
}

// Отправляет push всем устройствам пользователя. Устаревшие подписки
// (404/410 от push-сервиса) удаляются. Никогда не бросает наружу.
async function sendToUser(userId, payload) {
  if (!enabled) return;
  let subs;
  try {
    subs = await PushSubscription.findAll({ where: { userId } });
  } catch (err) {
    logger.error('Web-push: load subscriptions failed:', err.message);
    return;
  }
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
    } catch (err) {
      // 404/410 — подписка мертва, удаляем
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sub.destroy().catch(() => {});
      } else {
        logger.error('Web-push send failed:', err.statusCode || err.message);
      }
    }
  }));
}

module.exports = { isEnabled, getPublicKey, sendToUser };
