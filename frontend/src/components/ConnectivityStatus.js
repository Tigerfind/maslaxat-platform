import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';

const RECONNECTED_VISIBLE_MS = 3500;

const ConnectivityStatus = ({ hasBottomNav = false }) => {
  const { t } = useTranslation();
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [reconnected, setReconnected] = useState(false);
  const previousOnline = useRef(online);

  useEffect(() => {
    let timer;
    const update = () => {
      const nextOnline = navigator.onLine !== false;
      if (nextOnline === previousOnline.current) return;
      const wasOffline = !previousOnline.current;
      previousOnline.current = nextOnline;
      setOnline(nextOnline);
      clearTimeout(timer);
      if (nextOnline && wasOffline) {
        setReconnected(true);
        timer = window.setTimeout(() => setReconnected(false), RECONNECTED_VISIBLE_MS);
      } else {
        setReconnected(false);
      }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (online && !reconnected) return null;

  return (
    <div
      className={`global-status-banner ${hasBottomNav ? 'global-status-banner--with-nav' : ''} ${online ? 'global-status-banner--online' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="connectivity-status"
    >
      <strong>{online ? t('pwa.onlineAgain') : t('pwa.offlineTitle')}</strong>
      {!online && <span>{t('pwa.offlineMessage')}</span>}
    </div>
  );
};

export default ConnectivityStatus;
