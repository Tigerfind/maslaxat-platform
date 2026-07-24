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
