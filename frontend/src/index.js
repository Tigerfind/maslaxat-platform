import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import './styles/glass.css';
import App from './App';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    beforeBreadcrumb: () => null,
    beforeSend(event) {
      delete event.request;
      delete event.breadcrumbs;
      delete event.extra;
      delete event.user;
      delete event.transaction;
      event.contexts = event.contexts?.react ? { react: event.contexts.react } : undefined;
      if (event.exception?.values) {
        event.exception.values = event.exception.values.map((value) => ({
          type: value.type,
          stacktrace: value.stacktrace,
          mechanism: value.mechanism ? { handled: value.mechanism.handled } : undefined,
        }));
      }
      return event;
    },
    beforeSendTransaction: () => null,
  });
}

// Suppress benign ResizeObserver loop error (known browser/MUI issue)
const origError = window.onerror;
window.onerror = (message, ...args) => {
  if (typeof message === 'string' && message.includes('ResizeObserver loop')) {
    return true;
  }
  return origError ? origError(message, ...args) : false;
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: регистрируем service worker, чтобы сайт можно было установить как приложение
if ('serviceWorker' in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
