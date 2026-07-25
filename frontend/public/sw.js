// MaslaXat — минимальный service worker (нужен, чтобы браузер считал сайт
// устанавливаемым приложением). Стратегия: сеть в приоритете, кэш как запасной
// вариант при отсутствии сети. Ничего заранее не кэшируем — чтобы в разработке
// не показывались устаревшие версии.
const CACHE = 'maslaxat-runtime-v1';

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
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon-64.png',
    data: { url: (data.metadata && data.metadata.url) || '/', ...data },
    tag: data.type || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Клик по уведомлению — фокус на открытой вкладке или открытие новой.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
