export const createServiceWorkerUpdateManager = ({
  serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : null,
  reload = () => window.location.reload(),
} = {}) => {
  let updateRequested = false;
  let reloadTriggered = false;
  let registration = null;
  let onUpdateAvailable = () => {};

  const handleControllerChange = () => {
    if (!updateRequested || reloadTriggered) return;
    reloadTriggered = true;
    reload();
  };

  const watchRegistration = (nextRegistration) => {
    registration = nextRegistration;
    if (registration.waiting && serviceWorker.controller) onUpdateAvailable(registration);

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && serviceWorker.controller) {
          onUpdateAvailable(registration);
        }
      });
    });
  };

  return {
    async register(callback) {
      if (!serviceWorker) return null;
      onUpdateAvailable = callback || (() => {});
      serviceWorker.addEventListener('controllerchange', handleControllerChange);
      const nextRegistration = await serviceWorker.register('/sw.js');
      watchRegistration(nextRegistration);
      return nextRegistration;
    },
    applyUpdate(targetRegistration = registration) {
      const waiting = targetRegistration?.waiting;
      if (!waiting) return false;
      updateRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    },
    dispose() {
      serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
    },
  };
};
