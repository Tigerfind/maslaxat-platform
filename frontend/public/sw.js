// Only public app-shell files belong in Cache Storage. Authenticated API and
// uploaded document responses are always left to the network/browser.
const CACHE = 'maslaxat-shell-v6';
const PRECACHE_FILES = [
  '/offline.html', '/manifest.json', '/favicon-64.png', '/app-icon.svg',
  '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
];
const STATIC_FILES = new Set(PRECACHE_FILES);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_FILES)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('maslaxat-') && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  const isNavigation = event.request.mode === 'navigate';
  const isStatic = STATIC_FILES.has(url.pathname);
  if (!isNavigation && !isStatic) return;
  event.respondWith(
    fetch(event.request)
      .then(async (response) => {
        // Не кэшируем 404/500: старый HTML или отсутствующий lazy chunk иначе
        // продолжит ломать приложение даже после успешного деплоя.
        const cacheControl = response.headers.get('Cache-Control') || '';
        const contentType = response.headers.get('Content-Type') || '';
        const safeToCache = response.ok && !response.redirected
          && !/private|no-store/i.test(cacheControl)
          && !response.headers.has('Set-Cookie')
          && (!isNavigation || contentType.includes('text/html'));
        if (safeToCache) {
          const copy = response.clone();
          const cache = await caches.open(CACHE);
          await cache.put(isNavigation ? '/index.html' : event.request, copy);
        }
        return response;
      })
      .catch(async () => {
        if (!isNavigation) return caches.match(event.request);
        // A cached shell may reference a route chunk that was never visited.
        // Prefer the guaranteed fallback over a partially cached application.
        return caches.match('/offline.html');
      })
  );
});

// ─── Web-push ───────────────────────────────────────────────
// Показываем уведомление, когда сервер шлёт push (даже если вкладка закрыта).
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'MaslaXat', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'MaslaXat';
  const isCall = data.type === 'incoming_call';
  let notificationUrl = '/';
  try {
    const candidate = new URL(data.metadata?.url || '/', self.location.origin);
    if (candidate.origin === self.location.origin
      && !candidate.pathname.startsWith('/api/')
      && !candidate.pathname.startsWith('/uploads/')) {
      notificationUrl = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    }
  } catch (e) { /* оставляем безопасный корень */ }
  event.waitUntil((async () => {
    // Входящий звонок: если вкладка открыта и на виду — звонок покажет in-app
    // модалка (со звуком), системное уведомление не дублируем.
    if (isCall) {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.some((c) => c.visibilityState === 'visible')) return;
    }
    const options = {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon-64.png',
      data: { url: notificationUrl, type: data.type || null },
      tag: [data.type, data.metadata?.consultationId, data.metadata?.messageId || data.metadata?.id]
        .filter(Boolean).join(':') || undefined,
      requireInteraction: isCall, // звонок висит, пока не ответишь
      renotify: isCall,
      vibrate: isCall ? [600, 400, 600, 400, 600] : undefined,
    };
    await self.registration.showNotification(title, options);
  })());
});

// Клик по уведомлению — фокус вкладки (+ переход по адресу) или открытие новой.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let targetUrl = '/';
  try {
    const candidate = new URL(event.notification.data?.url || '/', self.location.origin);
    if (candidate.origin === self.location.origin
      && !candidate.pathname.startsWith('/api/')
      && !candidate.pathname.startsWith('/uploads/')) {
      targetUrl = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    }
  } catch (e) { /* оставляем безопасный корень */ }
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
