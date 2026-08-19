const CACHE_PREFIX = 'maslaxat-';
const CACHE_NAME = 'maslaxat-shell-v3';
const SHELL_URL = '/index.html';
const MAX_CACHE_ENTRIES = 40;
const SHELL_ASSETS = new Set([
  SHELL_URL,
  '/manifest.json',
  '/favicon-64.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/app-icon.svg',
]);
const VERSIONED_STATIC = /^\/static\/(?:css|js|media)\/[^/?]*\.[a-f0-9]{8,}\.[^/?]+$/i;
const PRIVATE_PATH = /^\/(?:api|socket\.io|auth|exports?|uploads?|files?)(?:\/|$)/i;
const PRIVATE_DOCUMENT_PATH = /^\/documents\//i;
const PUSH_STATE_CACHE = 'emaslaxat-push-state-v1';
const PUSH_DISABLED_KEY = '/__sw-state__/push-disabled';

const purgeMaslaxatCaches = async (keepCurrent = false) => {
  const names = await caches.keys();
  await Promise.all(names.map((name) => {
    if (!name.startsWith(CACHE_PREFIX) || (keepCurrent && name === CACHE_NAME)) return undefined;
    return caches.delete(name);
  }));
};

const trimCache = async (cache) => {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_CACHE_ENTRIES;
  if (overflow <= 0) return;
  const removable = keys.filter((key) => {
    try { return new URL(key.url, self.location.origin).pathname !== SHELL_URL; } catch (error) { return true; }
  });
  await Promise.all(removable.slice(0, overflow).map((key) => cache.delete(key)));
};

const isCacheableRequest = (request) => {
  if (request.method !== 'GET') return false;
  if (request.headers && request.headers.has && request.headers.has('Authorization')) return false;
  let url;
  try {
    url = new URL(request.url, self.location.origin);
  } catch (error) {
    return false;
  }
  if (url.origin !== self.location.origin || !['http:', 'https:'].includes(url.protocol)) return false;
  if (url.search) return false;
  if (PRIVATE_PATH.test(url.pathname)) return false;
  return SHELL_ASSETS.has(url.pathname) || VERSIONED_STATIC.test(url.pathname);
};

const isPrivateRequest = (request) => {
  try {
    const url = new URL(request.url, self.location.origin);
    return url.origin !== self.location.origin
      || !['http:', 'https:'].includes(url.protocol)
      || PRIVATE_PATH.test(url.pathname)
      || PRIVATE_DOCUMENT_PATH.test(url.pathname);
  } catch (error) {
    return true;
  }
};

const isCacheableResponse = (response) => {
  if (!response || response.status !== 200 || ['error', 'opaque', 'opaqueredirect'].includes(response.type)) return false;
  const cacheControl = response.headers && response.headers.get('cache-control');
  return !/(?:^|,)\s*(?:no-store|private)(?:\s|,|=|$)/i.test(cacheControl || '');
};

const storePublicAsset = async (request, response) => {
  if (!isCacheableRequest(request) || !isCacheableResponse(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  await trimCache(cache);
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const shellResponse = await fetch(SHELL_URL, { cache: 'no-cache' });
      if (isCacheableResponse(shellResponse)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(SHELL_URL, shellResponse.clone());
      }
    } catch (error) {
      // Installation remains usable online when shell prefetch is unavailable.
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await purgeMaslaxatCaches(true);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data && event.data.type === 'PURGE_CACHES') {
    event.waitUntil(purgeMaslaxatCaches());
  }
  if (event.data && event.data.type === 'SET_PUSH_DISABLED') {
    event.waitUntil((async () => {
      const cache = await caches.open(PUSH_STATE_CACHE);
      if (event.data.disabled) {
        await cache.put(PUSH_DISABLED_KEY, new Response('1', { headers: { 'Content-Type': 'text/plain' } }));
      } else {
        await cache.delete(PUSH_DISABLED_KEY);
      }
    })());
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    if (isPrivateRequest(event.request)) {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(SHELL_URL);
        if (shell) return shell;
        throw error;
      }
    })());
    return;
  }

  if (!isCacheableRequest(event.request)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request);
      await storePublicAsset(event.request, networkResponse);
      return networkResponse;
    } catch (error) {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});

const SAFE_PUSH_MESSAGES = {
  en: { call: 'Incoming call', consultation: 'Consultation update', document: 'Document analysis is ready', review: 'New review received', verification: 'Verification update', case: 'Case document update', default: 'New notification' },
  ru: { call: 'Входящий звонок', consultation: 'Обновление консультации', document: 'Анализ документа завершён', review: 'Получен новый отзыв', verification: 'Обновление проверки', case: 'Обновление документа по делу', default: 'Новое уведомление' },
  uz: { call: "Kiruvchi qo'ng'iroq", consultation: 'Konsultatsiya yangilandi', document: 'Hujjat tahlili tayyor', review: 'Yangi sharh olindi', verification: 'Tekshiruv yangilandi', case: 'Ish hujjati yangilandi', default: 'Yangi bildirishnoma' },
};

const safePushBody = (type, locale) => {
  const messages = SAFE_PUSH_MESSAGES[locale] || SAFE_PUSH_MESSAGES.ru;
  if (type === 'incoming_call') return messages.call;
  if (type === 'document_analyzed') return messages.document;
  if (type === 'new_review') return messages.review;
  if (type === 'verification' || type === 'verification_request') return messages.verification;
  if (type === 'case_document') return messages.case;
  if (type.startsWith('booking_') || type.startsWith('consultation_')) return messages.consultation;
  return messages.default;
};

const safeAppPath = (value) => {
  if (typeof value !== 'string') return '/';
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch (error) {
    return '/';
  }
};

const isPushDisabled = async () => {
  const cache = await caches.open(PUSH_STATE_CACHE);
  return Boolean(await cache.match(PUSH_DISABLED_KEY));
};

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  const type = typeof data.type === 'string' ? data.type : 'notification';
  const locale = typeof data.locale === 'string' ? data.locale.toLowerCase().split('-')[0] : 'ru';
  const isCall = type === 'incoming_call';
  event.waitUntil((async () => {
    if (await isPushDisabled()) return;
    // Входящий звонок: если вкладка открыта и на виду — звонок покажет in-app
    // модалка (со звуком), системное уведомление не дублируем.
    if (isCall) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.some((c) => c.visibilityState === 'visible')) return;
    }
    const requestedTarget = (data.metadata && data.metadata.url) || data.url || '/';
    const options = {
      body: safePushBody(type, locale),
      icon: '/icon-192.png',
      badge: '/favicon-64.png',
      data: { type, url: safeAppPath(requestedTarget) },
      tag: type,
      requireInteraction: isCall, // звонок висит, пока не ответишь
      renotify: isCall,
      vibrate: isCall ? [600, 400, 600, 400, 600] : undefined,
    };
    await self.registration.showNotification('MaslaXat', options);
  })());
});

// Клик по уведомлению — фокус вкладки (+ переход по адресу) или открытие новой.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = safeAppPath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) {
        await client.focus();
        if (targetUrl !== '/' && 'navigate' in client) {
          try { await client.navigate(targetUrl); } catch (e) { /* другой origin/ошибка */ }
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
