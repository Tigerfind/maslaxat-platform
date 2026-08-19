import {
  cleanupSession,
  configureSessionRuntime,
  publishSessionEvent,
  registerSessionSocket,
  sessionRuntime,
  subscribeSessionEvents,
} from './sessionRuntime';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  configureSessionRuntime({
    getSnapshot: () => ({ token: 'test-token', user: { id: 'test-user' } }),
    unbindPush: () => Promise.resolve(),
    purgeCaches: () => Promise.resolve(),
    rebindPush: () => Promise.resolve(false),
    onUnauthorized: () => Promise.resolve(),
  });
});

test('session cleanup waits for authenticated push unbind before rotating private resources', async () => {
  const unbind = deferred();
  const events = [];
  const socket = { disconnect: jest.fn(() => events.push('rotate')) };
  const unregister = registerSessionSocket(socket);
  configureSessionRuntime({
    unbindPush: () => unbind.promise.then(() => events.push('unbind')),
    purgeCaches: async () => { events.push('purge'); },
  });

  const cleanup = cleanupSession();
  await Promise.resolve();
  expect(events).toEqual([]);

  unbind.resolve();
  await cleanup;

  expect(events).toEqual(['unbind', 'rotate', 'purge']);
  unregister();
});

test('cleanup failures settle and concurrent unauthorized calls share one teardown', async () => {
  const unbind = deferred();
  const onUnauthorized = jest.fn(() => cleanupSession());
  configureSessionRuntime({
    unbindPush: jest.fn(() => unbind.promise.then(() => { throw new Error('push failed'); })),
    purgeCaches: () => Promise.reject(new Error('cache failed')),
    onUnauthorized,
  });

  const first = sessionRuntime.onUnauthorized();
  const second = sessionRuntime.onUnauthorized();
  unbind.resolve();

  await expect(Promise.all([first, second])).resolves.toBeDefined();
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test('default cache purge removes only MaslaXat caches and notifies the active worker', async () => {
  const postMessage = jest.fn();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: { postMessage } },
  });
  const deleteCache = jest.fn().mockResolvedValue(true);
  global.caches = {
    keys: jest.fn().mockResolvedValue(['maslaxat-shell-v3', 'other-app']),
    delete: deleteCache,
  };
  configureSessionRuntime({ purgeCaches: undefined });

  await cleanupSession();

  expect(postMessage).toHaveBeenCalledWith({ type: 'PURGE_CACHES' });
  expect(deleteCache).toHaveBeenCalledTimes(1);
  expect(deleteCache).toHaveBeenCalledWith('maslaxat-shell-v3');
  delete global.caches;
});

test('logout events cross tabs without requiring token payloads', () => {
  const messages = [];
  class FakeBroadcastChannel {
    constructor() { FakeBroadcastChannel.instance = this; }
    postMessage(message) { messages.push(message); }
    close() {}
  }
  global.BroadcastChannel = FakeBroadcastChannel;
  const listener = jest.fn();
  const unsubscribe = subscribeSessionEvents(listener);

  publishSessionEvent('logout');
  FakeBroadcastChannel.instance.onmessage({ data: { type: 'logout' } });

  expect(messages).toEqual([{ type: 'logout' }]);
  expect(listener).toHaveBeenCalledWith({ type: 'logout' });
  unsubscribe();
  delete global.BroadcastChannel;
});

test('a stale cleanup owner cannot rotate resources from a newer session', async () => {
  const unbind = deferred();
  let snapshot = { token: 'token-a', user: { id: 'user-a' } };
  const socket = { disconnect: jest.fn() };
  const unregister = registerSessionSocket(socket);
  configureSessionRuntime({
    getSnapshot: () => snapshot,
    unbindPush: () => unbind.promise,
  });
  const owner = sessionRuntime.captureOwner();

  const cleanup = cleanupSession(owner);
  snapshot = { token: 'token-b', user: { id: 'user-b' } };
  unbind.resolve();
  const result = await cleanup;

  expect(result.owned).toBe(false);
  expect(socket.disconnect).not.toHaveBeenCalled();
  unregister();
});
