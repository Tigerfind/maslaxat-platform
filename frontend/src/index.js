import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/glass.css';
import App from './App';

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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
