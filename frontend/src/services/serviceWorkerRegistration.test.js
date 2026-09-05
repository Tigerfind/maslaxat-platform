import { createServiceWorkerUpdateManager } from './serviceWorkerRegistration';
import { vi } from 'vitest';

const createServiceWorkerMock = () => {
  const listeners = {};
  const registration = {
    waiting: { postMessage: vi.fn() },
    installing: null,
    addEventListener: vi.fn(),
  };
  const serviceWorker = {
    controller: {},
    register: vi.fn().mockResolvedValue(registration),
    addEventListener: vi.fn((type, listener) => { listeners[type] = listener; }),
    removeEventListener: vi.fn(),
  };
  return { listeners, registration, serviceWorker };
};

describe('service worker update lifecycle', () => {
  test('announces a waiting update without reloading', async () => {
    const { listeners, registration, serviceWorker } = createServiceWorkerMock();
    const reload = vi.fn();
    const onUpdate = vi.fn();
    const manager = createServiceWorkerUpdateManager({ serviceWorker, reload });

    await manager.register(onUpdate);
    listeners.controllerchange();

    expect(onUpdate).toHaveBeenCalledWith(registration);
    expect(reload).not.toHaveBeenCalled();
  });

  test('reloads once only after the user activates the waiting worker', async () => {
    const { listeners, registration, serviceWorker } = createServiceWorkerMock();
    const reload = vi.fn();
    const manager = createServiceWorkerUpdateManager({ serviceWorker, reload });
    await manager.register();

    expect(manager.applyUpdate()).toBe(true);
    expect(registration.waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    listeners.controllerchange();
    listeners.controllerchange();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
