import api from './api';
import pushService from './pushService';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const makeSubscription = (events = []) => ({
  endpoint: 'https://push.test/subscription-1',
  toJSON: () => ({ endpoint: 'https://push.test/subscription-1', keys: { auth: 'auth', p256dh: 'key' } }),
  unsubscribe: jest.fn(async () => { events.push('local-unsubscribe'); return true; }),
});

const accountPreferenceKey = (accountId) => `maslaxatPushEnabled:${accountId}`;

const installPushBrowser = (subscription) => {
  const pushManager = {
    getSubscription: jest.fn().mockResolvedValue(subscription),
    subscribe: jest.fn().mockResolvedValue(subscription),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: jest.fn().mockResolvedValue('granted') },
  });
  return pushManager;
};

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

test('authenticated session unbind reaches the server before local unsubscribe and preserves opt-in', async () => {
  const events = [];
  const subscription = makeSubscription(events);
  installPushBrowser(subscription);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.post.mockImplementation(async () => { events.push('server-unbind'); });

  await pushService.unbindSession({ accountId: 'user-a' });

  expect(events).toEqual(['server-unbind', 'local-unsubscribe']);
  expect(api.post).toHaveBeenCalledWith(
    '/push/unsubscribe',
    { endpoint: subscription.endpoint },
    { skipSessionRevocation: true }
  );
  expect(localStorage.getItem(accountPreferenceKey('user-a'))).toBe('1');
});

test('failed server unbind cannot prevent local unsubscribe or logout cleanup', async () => {
  const subscription = makeSubscription();
  installPushBrowser(subscription);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.post.mockRejectedValue(new Error('offline'));

  await expect(pushService.unbindSession({ accountId: 'user-a' })).resolves.toBe(false);

  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(accountPreferenceKey('user-a'))).toBe('1');
});

test('explicit disable clears push preference while session unbind does not', async () => {
  const subscription = makeSubscription();
  installPushBrowser(subscription);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.post.mockResolvedValue({});

  await pushService.disable('user-a');

  expect(localStorage.getItem(accountPreferenceKey('user-a'))).toBeNull();
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
});

test('login rebinds an opted-in browser and ignores users without saved consent', async () => {
  const subscription = makeSubscription();
  const pushManager = installPushBrowser(null);
  pushManager.subscribe.mockResolvedValue(subscription);
  api.get.mockResolvedValue({ data: { enabled: true, publicKey: 'AQID' } });
  api.post.mockResolvedValue({});

  await expect(pushService.rebindSession('user-a')).resolves.toBe(false);
  expect(pushManager.subscribe).not.toHaveBeenCalled();

  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  await expect(pushService.rebindSession('user-a')).resolves.toBe(true);

  expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/push/subscribe', {
    endpoint: subscription.endpoint,
    keys: { auth: 'auth', p256dh: 'key' },
  });
});

test('unavailable service worker APIs fail safely without clearing the opt-in', async () => {
  installPushBrowser(null);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.reject(new Error('worker unavailable')) },
  });

  await expect(pushService.unbindSession({ accountId: 'user-a' })).resolves.toBe(false);

  expect(localStorage.getItem(accountPreferenceKey('user-a'))).toBe('1');
  expect(api.post).not.toHaveBeenCalled();
});

test('a failed local unsubscribe reports an incomplete unbind after the server call', async () => {
  const subscription = makeSubscription();
  subscription.unsubscribe.mockRejectedValue(new Error('browser refused'));
  installPushBrowser(subscription);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.post.mockResolvedValue({});

  await expect(pushService.unbindSession({ accountId: 'user-a' })).resolves.toBe(false);

  expect(api.post).toHaveBeenCalledTimes(1);
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
});

test('User A consent never automatically subscribes User B', async () => {
  const subscription = makeSubscription();
  const pushManager = installPushBrowser(null);
  pushManager.subscribe.mockResolvedValue(subscription);
  localStorage.setItem('maslaxatPushEnabled', '1');
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.get.mockResolvedValue({ data: { enabled: true, publicKey: 'AQID' } });

  await expect(pushService.rebindSession('user-b')).resolves.toBe(false);

  expect(pushManager.subscribe).not.toHaveBeenCalled();
  expect(api.get).not.toHaveBeenCalled();
});

test('a service worker that never becomes ready times out instead of hanging logout', async () => {
  jest.useFakeTimers();
  installPushBrowser(null);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: new Promise(() => {}) },
  });

  const unbind = pushService.unbindSession({ accountId: 'user-a' });
  jest.runOnlyPendingTimers();

  await expect(unbind).resolves.toBe(false);
  jest.useRealTimers();
});

test('failed server unbind is persisted and drained after a later session', async () => {
  const subscription = makeSubscription();
  installPushBrowser(subscription);
  localStorage.setItem(accountPreferenceKey('user-a'), '1');
  api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});

  await expect(pushService.unbindSession({ accountId: 'user-a' })).resolves.toBe(false);
  expect(localStorage.getItem('maslaxatPushPendingUnbind')).toContain(subscription.endpoint);

  await expect(pushService.drainPendingUnbind()).resolves.toBe(true);
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('maslaxatPushPendingUnbind')).toBeNull();
});
