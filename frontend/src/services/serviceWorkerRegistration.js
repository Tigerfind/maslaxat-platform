let registrationPromise;
let registrationOwner;
let reloadInProgress = false;

const requestActivation = (worker) => {
  worker?.postMessage({ type: 'SKIP_WAITING' });
};

export const registerServiceWorker = async ({ reloadPage = () => window.location.reload() } = {}) => {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.register) return null;
  if (registrationPromise && registrationOwner === navigator.serviceWorker) return registrationPromise;
  registrationOwner = navigator.serviceWorker;
  reloadInProgress = false;
  const hadController = Boolean(navigator.serviceWorker.controller);

  registrationPromise = navigator.serviceWorker.register('/sw.js')
    .then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        requestActivation(registration.waiting);
      }

      registration.addEventListener?.('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            requestActivation(worker);
          }
        });
      });

      navigator.serviceWorker.addEventListener?.('controllerchange', () => {
        if (!hadController || reloadInProgress) return;
        reloadInProgress = true;
        reloadPage();
      });
      return registration;
    })
    .catch(() => {
      registrationPromise = undefined;
      registrationOwner = undefined;
      reloadInProgress = false;
      return null;
    });

  return registrationPromise;
};
