/** @jest-environment node */

import fs from 'fs';
import path from 'path';
import vm from 'vm';

const workerSource = fs.readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');

const response = ({ status = 200, type = 'basic', cacheControl = '', body = 'body' } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  type,
  body,
  headers: { get: (name) => (name.toLowerCase() === 'cache-control' ? cacheControl : null) },
  clone() { return response({ status, type, cacheControl, body }); },
});

const request = (pathname, overrides = {}) => ({
  url: `https://maslaxat.test${pathname}`,
  method: 'GET',
  mode: 'cors',
  destination: '',
  ...overrides,
});

function createHarness(fetchImpl = jest.fn().mockResolvedValue(response()), providedStores) {
  const handlers = {};
  const stores = providedStores || new Map();
  const skipWaiting = jest.fn().mockResolvedValue(undefined);

  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return {
      put: async (key, value) => entries.set(typeof key === 'string' ? key : key.url, value),
      match: async (key) => entries.get(typeof key === 'string' ? key : key.url),
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (key) => entries.delete(typeof key === 'string' ? key : key.url),
    };
  };

  const caches = {
    open: jest.fn(async (name) => cacheFor(name)),
    keys: jest.fn(async () => [...stores.keys()]),
    delete: jest.fn(async (name) => stores.delete(name)),
    match: jest.fn(async (key) => {
      const cacheKey = typeof key === 'string' ? key : key.url;
      for (const entries of stores.values()) {
        if (entries.has(cacheKey)) return entries.get(cacheKey);
      }
      return undefined;
    }),
  };

  const self = {
    location: { origin: 'https://maslaxat.test' },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting,
    clients: { claim: jest.fn().mockResolvedValue(undefined), matchAll: jest.fn().mockResolvedValue([]) },
    registration: { showNotification: jest.fn().mockResolvedValue(undefined) },
  };

  vm.runInNewContext(workerSource, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response: class TestResponse {
      constructor(body, options = {}) {
        this.body = body;
        this.headers = options.headers || {};
      }
      clone() { return this; }
    },
    Promise,
    Set,
    console,
  });

  const dispatch = async (type, event = {}) => {
    let lifetime;
    let responsePromise;
    handlers[type]({
      waitUntil: (promise) => { lifetime = Promise.resolve(promise); },
      respondWith: (promise) => { responsePromise = Promise.resolve(promise); },
      ...event,
    });
    if (lifetime) await lifetime;
    return responsePromise;
  };

  return { cacheFor, caches, dispatch, handlers, self, skipWaiting, stores };
}

test('never caches private routes or unsafe responses', async () => {
  const privateCases = [
    [request('/api/auth/me'), response()],
    [request('/socket.io/?transport=polling'), response()],
    [request('/documents/42/download'), response()],
    [request('/exports/cases.csv'), response()],
    [request('/private-document', { url: 'blob:https://maslaxat.test/private-document' }), response()],
    [request('/index.html?token=private'), response()],
    [request('/static/js/main.12345678.js?account=user-a'), response()],
    [request('/static/js/main.hash.js'), response({ status: 500 })],
    [request('/static/js/main.hash.js'), response({ type: 'opaque' })],
    [request('/static/js/main.hash.js'), response({ cacheControl: 'private, max-age=60' })],
    [request('/static/js/main.hash.js'), response({ cacheControl: 'no-store' })],
  ];
  let currentResponse;
  const harness = createHarness(jest.fn(async () => currentResponse));

  for (const [privateRequest, privateResponse] of privateCases) {
    currentResponse = privateResponse;
    const pending = await harness.dispatch('fetch', { request: privateRequest });
    await pending;
  }

  const cachedEntries = [...harness.stores.values()].reduce((count, entries) => count + entries.size, 0);
  expect(cachedEntries).toBe(0);
});

test('offline API failures reject even if an old cache contains a private response', async () => {
  const failure = new Error('offline');
  const harness = createHarness(jest.fn().mockRejectedValue(failure));
  await harness.cacheFor('maslaxat-runtime-v2').put('https://maslaxat.test/api/documents', response({ body: 'User A' }));

  const pending = harness.dispatch('fetch', { request: request('/api/documents') });

  await expect(pending).rejects.toBe(failure);
});

test('offline navigation falls back to the shell rather than a private route entry', async () => {
  const harness = createHarness(jest.fn().mockRejectedValue(new Error('offline')));
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response({ body: 'public shell' }));
  await harness.cacheFor('maslaxat-runtime-v2').put('https://maslaxat.test/dashboard', response({ body: 'User A dashboard' }));

  const result = await harness.dispatch('fetch', {
    request: request('/dashboard', { mode: 'navigate', destination: 'document' }),
  });

  expect(result.body).toBe('public shell');
});

test('offline frontend documents navigation receives the shell', async () => {
  const harness = createHarness(jest.fn().mockRejectedValue(new Error('offline')));
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response({ body: 'public shell' }));

  const result = await harness.dispatch('fetch', {
    request: request('/documents', { mode: 'navigate', destination: 'document' }),
  });

  expect(result.body).toBe('public shell');
});

test('document download navigation stays network-only while offline', async () => {
  const failure = new Error('offline');
  const harness = createHarness(jest.fn().mockRejectedValue(failure));
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response({ body: 'public shell' }));

  const pending = harness.dispatch('fetch', {
    request: request('/documents/42/download', { mode: 'navigate', destination: 'document' }),
  });

  await expect(pending).rejects.toBe(failure);
});

test('navigation-shaped private requests reject offline instead of receiving the shell', async () => {
  const failure = new Error('offline');
  const harness = createHarness(jest.fn().mockRejectedValue(failure));
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response({ body: 'public shell' }));

  const pending = harness.dispatch('fetch', {
    request: request('/api/auth/me', { mode: 'navigate', destination: 'document' }),
  });

  await expect(pending).rejects.toBe(failure);
});

test('static runtime cache stays bounded', async () => {
  const harness = createHarness();

  for (let index = 0; index < 45; index += 1) {
    await harness.dispatch('fetch', {
      request: request(`/static/js/chunk.${String(index).padStart(8, 'a')}.js`, { destination: 'script' }),
    });
  }

  const staticEntries = [...harness.stores.values()].reduce((count, entries) => count + entries.size, 0);
  expect(staticEntries).toBeLessThanOrEqual(40);
});

test('bounded trimming never evicts the offline index shell', async () => {
  const harness = createHarness();
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response({ body: 'public shell' }));

  for (let index = 0; index < 45; index += 1) {
    await harness.dispatch('fetch', {
      request: request(`/static/js/chunk.${String(index).padStart(8, 'b')}.js`, { destination: 'script' }),
    });
  }

  const shellCache = harness.stores.get('maslaxat-shell-v3');
  expect(shellCache.get('/index.html').body).toBe('public shell');
  expect(shellCache.size).toBeLessThanOrEqual(40);
});

test('activation removes legacy MaslaXat caches but leaves unrelated origins alone', async () => {
  const harness = createHarness();
  await harness.cacheFor('maslaxat-runtime-v2').put('/index.html', response());
  await harness.cacheFor('maslaxat-static-v1').put('/index.html', response());
  await harness.cacheFor('unrelated-cache').put('/keep', response());

  await harness.dispatch('activate');

  expect([...harness.stores.keys()]).toEqual(['unrelated-cache']);
  expect(harness.self.clients.claim).toHaveBeenCalledTimes(1);
});

test('an installed update waits for explicit activation', async () => {
  const harness = createHarness();

  await harness.dispatch('install');

  expect(harness.skipWaiting).not.toHaveBeenCalled();
});

test('explicit update and logout messages activate the worker and purge all MaslaXat caches', async () => {
  const harness = createHarness();
  await harness.cacheFor('maslaxat-shell-v3').put('/index.html', response());
  await harness.cacheFor('maslaxat-runtime-v2').put('/api/private', response());
  await harness.cacheFor('unrelated-cache').put('/keep', response());

  await harness.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  await harness.dispatch('message', { data: { type: 'PURGE_CACHES' } });

  expect(harness.skipWaiting).toHaveBeenCalledTimes(1);
  expect([...harness.stores.keys()]).toEqual(['unrelated-cache']);
});

test('push strips private backend text and constrains notification targets to same-origin paths', async () => {
  const harness = createHarness();
  await harness.dispatch('push', {
    data: { json: () => ({
      type: 'document_analyzed',
      locale: 'en',
      title: 'Analysis of private-contract.pdf',
      body: 'Client admitted liability',
      metadata: { url: 'https://evil.example/private', notes: 'Client admitted liability' },
    }) },
  });

  expect(harness.self.registration.showNotification).toHaveBeenCalledWith('MaslaXat', expect.objectContaining({
    body: 'Document analysis is ready',
    data: { type: 'document_analyzed', url: '/' },
  }));
  expect(JSON.stringify(harness.self.registration.showNotification.mock.calls)).not.toMatch(/private-contract|admitted liability/);
});

test('durable push-disabled state suppresses notifications across worker restarts', async () => {
  const firstWorker = createHarness();
  await firstWorker.dispatch('message', { data: { type: 'SET_PUSH_DISABLED', disabled: true } });
  const restartedWorker = createHarness(undefined, firstWorker.stores);
  await restartedWorker.dispatch('push', { data: { json: () => ({ type: 'booking_new' }) } });

  expect(restartedWorker.self.registration.showNotification).not.toHaveBeenCalled();
});
