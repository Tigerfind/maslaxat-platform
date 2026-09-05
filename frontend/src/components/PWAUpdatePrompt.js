import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Snackbar } from '@mui/material';
import { useTranslation } from '../i18n';
import { createServiceWorkerUpdateManager } from '../services/serviceWorkerRegistration';

const PWAUpdatePrompt = () => {
  const { t } = useTranslation();
  const managerRef = useRef(null);
  const [registration, setRegistration] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const manager = createServiceWorkerUpdateManager();
    managerRef.current = manager;
    const register = () => manager.register(setRegistration).catch(() => {});

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      window.removeEventListener('load', register);
      manager.dispose();
      managerRef.current = null;
    };
  }, []);

  const applyUpdate = () => {
    if (managerRef.current?.applyUpdate(registration)) setRegistration(null);
  };

  return (
    <Snackbar
      open={Boolean(registration)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      sx={{ top: 'max(8px, env(safe-area-inset-top)) !important', maxWidth: 'calc(100vw - 16px)' }}
    >
      <Alert
        severity="info"
        variant="filled"
        sx={{ width: '100%', bgcolor: 'var(--text)', color: 'var(--canvas)' }}
        action={(
          <Button color="inherit" size="small" onClick={applyUpdate}>
            {t('pwa.updateAction')}
          </Button>
        )}
      >
        {t('pwa.updateAvailable')}
      </Alert>
    </Snackbar>
  );
};

export default PWAUpdatePrompt;
