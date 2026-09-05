import React, { useEffect, useRef, useState } from 'react';
import { CloseOutlined, DownloadOutlined, IosShareOutlined } from '@mui/icons-material';
import { useTranslation } from '../i18n';
import {
  dismissInstallPrompt,
  getInstallEnvironment,
  INSTALL_PROMPT_EVENT,
  wasInstallPromptDismissed,
} from '../utils/pwaInstall';

const PWAInstallPrompt = ({ hasBottomNav = false }) => {
  const { t } = useTranslation();
  const deferredPrompt = useRef(null);
  const environment = getInstallEnvironment();
  const [mode, setMode] = useState(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (environment.installed) return undefined;
    const dismissed = wasInstallPromptDismissed();
    const showIos = () => {
      if (environment.iosSafari) setMode('ios');
    };
    const handleBeforeInstall = (event) => {
      event.preventDefault();
      deferredPrompt.current = event;
      if (!dismissed) setMode('native');
    };
    const handleRequest = () => {
      if (deferredPrompt.current) setMode('native');
      else if (environment.iosSafari) setMode('ios');
      else setMode('unavailable');
    };
    const handleInstalled = () => {
      deferredPrompt.current = null;
      setMode('installed');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener(INSTALL_PROMPT_EVENT, handleRequest);
    if (!dismissed) showIos();
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener(INSTALL_PROMPT_EVENT, handleRequest);
    };
  }, [environment.installed, environment.iosSafari]);

  const close = () => {
    dismissInstallPrompt();
    setMode(null);
  };

  const install = async () => {
    const prompt = deferredPrompt.current;
    if (!prompt) return;
    await prompt.prompt();
    const result = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredPrompt.current = null;
    if (result.outcome !== 'accepted') dismissInstallPrompt();
    setMode(null);
  };

  if (!mode || !online) return null;
  const ios = mode === 'ios';
  const installed = mode === 'installed';
  const unavailable = mode === 'unavailable';

  return (
    <section className={`pwa-install-prompt ${hasBottomNav ? 'pwa-install-prompt--with-nav' : ''}`} aria-label={t('pwa.installTitle')} data-testid="install-prompt">
      <div className="pwa-install-prompt__icon" aria-hidden="true">
        {ios ? <IosShareOutlined /> : <DownloadOutlined />}
      </div>
      <div className="pwa-install-prompt__copy">
        <strong>{installed ? t('pwa.installedTitle') : t('pwa.installTitle')}</strong>
        <span>{installed ? t('pwa.installedMessage') : ios ? t('pwa.iosInstructions') : unavailable ? t('pwa.installUnavailable') : t('pwa.installMessage')}</span>
      </div>
      {!ios && !installed && !unavailable && <button type="button" className="pwa-install-prompt__action" onClick={install}>{t('pwa.installAction')}</button>}
      <button type="button" className="pwa-install-prompt__close" onClick={close} aria-label={t('pwa.dismissInstall')}><CloseOutlined /></button>
    </section>
  );
};

export default PWAInstallPrompt;
