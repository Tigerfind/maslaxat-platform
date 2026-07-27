// MaslaXat — минимальный service worker (нужен, чтобы браузер считал сайт
// устанавливаемым приложением). Стратегия: сеть в приоритете, кэш как запасной
// вариант при отсутствии сети. Ничего заранее не кэшируем — чтобы в разработке
// не показывались устаревшие версии.
const CACHE = 'maslaxat-runtime-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // складываем успешные ответы в кэш на случай оффлайна
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
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
      data: { url: (data.metadata && data.metadata.url) || '/', ...data },
      tag: data.type || undefined,
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
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
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
