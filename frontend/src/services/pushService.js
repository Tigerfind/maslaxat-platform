import api from './api';

// Web-push на фронте: подписка устройства через Service Worker + Push API.
// Всё keyless — публичный VAPID-ключ берётся с бэкенда.

function isSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

// VAPID public key (base64url) → Uint8Array для applicationServerKey
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration() {
  // SW уже регистрируется в index.js; дожидаемся готовности
  return navigator.serviceWorker.ready;
}

// Текущий статус: поддержка, разрешение, есть ли активная подписка, включён ли push на сервере
async function getStatus() {
  if (!isSupported()) return { supported: false, permission: 'unsupported', subscribed: false, enabledOnServer: false };
  let enabledOnServer = false;
  try {
    const { data } = await api.get('/push/vapid-public-key');
    enabledOnServer = !!data.enabled;
  } catch (e) { /* сервер недоступен — оставляем false */ }
  let subscribed = false;
  try {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch (e) { /* нет SW */ }
  return { supported: true, permission: Notification.permission, subscribed, enabledOnServer };
}

// Включить push: запросить разрешение, подписаться, отправить подписку на сервер
async function enable() {
  if (!isSupported()) throw new Error('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');

  const { data } = await api.get('/push/vapid-public-key');
  if (!data.enabled || !data.publicKey) throw new Error('server-disabled');

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }
  const json = sub.toJSON();
  await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  return true;
}

// Отключить push: снять подписку локально и на сервере
async function disable() {
  if (!isSupported()) return;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await api.post('/push/unsubscribe', { endpoint }).catch(() => {});
  }
}

export default { isSupported, getStatus, enable, disable };
