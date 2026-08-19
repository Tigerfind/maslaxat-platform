import { registerServiceWorker } from './serviceWorkerRegistration';

const installBrowser = ({ controller = {}, waiting = null } = {}) => {
  const listeners = {};
  const registration = {
    waiting,
    addEventListener: jest.fn((type, handler) => { listeners[type] = handler; }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller,
      register: jest.fn().mockResolvedValue(registration),
      addEventListener: jest.fn((type, handler) => { listeners[type] = handler; }),
    },
  });
  return { listeners, registration, serviceWorker: navigator.serviceWorker };
};

beforeEach(() => {
  sessionStorage.clear();
  jest.clearAllMocks();
});

test('first install remains passive until it controls a page', async () => {
  const waiting = { postMessage: jest.fn() };
  const { listeners } = installBrowser({ controller: null, waiting });
  const reload = jest.fn();

  await registerServiceWorker({ reloadPage: reload });
  listeners.controllerchange();

  expect(waiting.postMessage).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

test('an already waiting update receives explicit activation', async () => {
  const waiting = { postMessage: jest.fn() };
  const { serviceWorker } = installBrowser({ waiting });

  await registerServiceWorker();

  expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js');
  expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});

test('a newly installed update activates only after reaching installed state', async () => {
  const workerListeners = {};
  const installing = {
    state: 'installing',
    postMessage: jest.fn(),
    addEventListener: jest.fn((type, handler) => { workerListeners[type] = handler; }),
  };
  const { listeners, registration } = installBrowser();

  await registerServiceWorker();
  registration.installing = installing;
  listeners.updatefound();
  expect(installing.postMessage).not.toHaveBeenCalled();

  installing.state = 'installed';
  workerListeners.statechange();
  expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});

test('controller change reloads at most once for an update', async () => {
  const { listeners } = installBrowser();
  const reload = jest.fn();

  await registerServiceWorker({ reloadPage: reload });
  listeners.controllerchange();
  listeners.controllerchange();

  expect(reload).toHaveBeenCalledTimes(1);
});

test('a previous page reload guard cannot suppress a later real update', async () => {
  sessionStorage.setItem('maslaxatSwReloaded', '1');
  const { listeners } = installBrowser();
  const reload = jest.fn();

  await registerServiceWorker({ reloadPage: reload });
  listeners.controllerchange();

  expect(reload).toHaveBeenCalledTimes(1);
});

test('unsupported browsers and registration failures are contained', async () => {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  await expect(registerServiceWorker()).resolves.toBeNull();

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: jest.fn().mockRejectedValue(new Error('blocked')) },
  });
  await expect(registerServiceWorker()).resolves.toBeNull();
});
