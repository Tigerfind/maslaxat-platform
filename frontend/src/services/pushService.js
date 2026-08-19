import api from './api';

// Web-push на фронте: подписка устройства через Service Worker + Push API.
// Всё keyless — публичный VAPID-ключ берётся с бэкенда.
const PUSH_PREFERENCE_PREFIX = 'maslaxatPushEnabled:';
const PENDING_UNBIND_KEY = 'maslaxatPushPendingUnbind';
const SERVICE_WORKER_READY_TIMEOUT_MS = 3000;

const preferenceKey = (accountId) => (
  accountId === null || accountId === undefined || String(accountId).trim() === ''
    ? null
    : `${PUSH_PREFERENCE_PREFIX}${String(accountId)}`
);

const pushPreference = {
  enabled(accountId) {
    const key = preferenceKey(accountId);
    if (!key) return false;
    try { return window.localStorage.getItem(key) === '1'; } catch (error) { return false; }
  },
  set(accountId, enabled) {
    const key = preferenceKey(accountId);
    if (!key) return;
    try {
      if (enabled) window.localStorage.setItem(key, '1');
      else window.localStorage.removeItem(key);
    } catch (error) { /* storage can be unavailable in private browsing */ }
  },
};

function isSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

const readPendingUnbind = () => {
  try {
    const pending = JSON.parse(window.localStorage.getItem(PENDING_UNBIND_KEY));
    return pending?.endpoint ? pending : null;
  } catch (error) {
    return null;
  }
};

const persistPendingUnbind = (endpoint, accountId) => {
  try {
    window.localStorage.setItem(PENDING_UNBIND_KEY, JSON.stringify({
      endpoint,
      accountId: accountId == null ? null : String(accountId),
    }));
  } catch (error) { /* logout remains failure-tolerant when storage is unavailable */ }
};

const clearPendingUnbind = (endpoint) => {
  try {
    if (readPendingUnbind()?.endpoint === endpoint) window.localStorage.removeItem(PENDING_UNBIND_KEY);
  } catch (error) { /* cleanup can retry later */ }
};

async function drainPendingUnbind() {
  const pending = readPendingUnbind();
  if (!pending) return true;
  try {
    await api.post('/push/unsubscribe', { endpoint: pending.endpoint }, { skipSessionRevocation: true });
    clearPendingUnbind(pending.endpoint);
    return true;
  } catch (error) {
    return false;
  }
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
  let timeoutId;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('service-worker-ready-timeout')), SERVICE_WORKER_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function setPushDisabled(disabled, registration) {
  try {
    const reg = registration || await getRegistration();
    const worker = reg.active || navigator.serviceWorker.controller;
    if (!worker?.postMessage) return false;
    worker.postMessage({ type: 'SET_PUSH_DISABLED', disabled: Boolean(disabled) });
    return true;
  } catch (error) {
    return false;
  }
}

// Текущий статус: поддержка, разрешение, есть ли активная подписка, включён ли push на сервере
async function getStatus(accountId) {
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
    subscribed = !!sub && pushPreference.enabled(accountId);
  } catch (e) { /* нет SW */ }
  return { supported: true, permission: Notification.permission, subscribed, enabledOnServer };
}

// Включить push: запросить разрешение, подписаться, отправить подписку на сервер
async function enable(accountId) {
  if (!isSupported()) throw new Error('unsupported');
  if (!preferenceKey(accountId)) throw new Error('account-required');
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
  pushPreference.set(accountId, true);
  await setPushDisabled(false, reg);
  return true;
}

async function unbindSession({ accountId, preservePreference = true } = {}) {
  if (!preservePreference) pushPreference.set(accountId, false);
  if (!isSupported()) return true;
  let sub;
  try {
    const reg = await getRegistration();
    await setPushDisabled(true, reg);
    sub = await reg.pushManager.getSubscription();
  } catch (error) {
    return false;
  }
  if (!sub) return true;

  persistPendingUnbind(sub.endpoint, accountId);
  let serverUnbound = true;
  try {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }, { skipSessionRevocation: true });
  } catch (error) {
    serverUnbound = false;
  }
  if (serverUnbound) clearPendingUnbind(sub.endpoint);
  let localUnbound = false;
  try {
    localUnbound = await sub.unsubscribe() !== false;
  } catch (error) {
    localUnbound = false;
  }
  return serverUnbound && localUnbound;
}

// Отключить push по явному выбору пользователя.
async function disable(accountId) {
  pushPreference.set(accountId, false);
  return unbindSession({ accountId, preservePreference: false });
}

async function rebindSession(accountId) {
  if (!pushPreference.enabled(accountId) || !isSupported() || Notification.permission !== 'granted') return false;
  try {
    await drainPendingUnbind();
    const { data } = await api.get('/push/vapid-public-key');
    if (!data.enabled || !data.publicKey) return false;
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
    await setPushDisabled(false, reg);
    return true;
  } catch (error) {
    return false;
  }
}

const pushService = {
  isSupported, getStatus, enable, disable, unbindSession, rebindSession, drainPendingUnbind, setPushDisabled,
};
export default pushService;
