import React, { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import { axelionColors } from '../../theme/axelionTheme';

/*
  Соц-вход (Google / Telegram). Кнопки показываются только если провайдер
  включён на сервере (заданы ключи). Без ключей компонент ничего не рендерит.
  Внешние скрипты провайдеров загружаются лениво и только при необходимости.
*/

let gisPromise = null;
function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return gisPromise;
}

const SocialLogin = ({ onSuccess, onError }) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState(null);
  const googleBtnRef = useRef(null);
  const tgRef = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/auth/social/config')
      .then(({ data }) => { if (alive) setConfig(data); })
      .catch(() => { if (alive) setConfig(null); });
    return () => { alive = false; };
  }, []);

  // ── Google Identity Services ──
  useEffect(() => {
    if (!config || !config.google || !config.google.enabled || !googleBtnRef.current) return undefined;
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !window.google || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: config.google.clientId,
        callback: async (resp) => {
          try {
            const { data } = await api.post('/auth/google', { credential: resp.credential });
            onSuccess(data);
          } catch (e) { if (onError) onError(e); }
        },
      });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', width: 300, text: 'continue_with', shape: 'rectangular',
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Telegram Login Widget ──
  useEffect(() => {
    if (!config || !config.telegram || !config.telegram.enabled || !tgRef.current) return undefined;
    // Виджет вызывает глобальную функцию по имени из data-onauth
    window.__maslaxatTelegramAuth = async (user) => {
      try {
        const { data } = await api.post('/auth/telegram', user);
        onSuccess(data);
      } catch (e) { if (onError) onError(e); }
    };
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', config.telegram.botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '10');
    s.setAttribute('data-onauth', '__maslaxatTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    tgRef.current.innerHTML = '';
    tgRef.current.appendChild(s);
    return () => {};
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const googleOn = config && config.google && config.google.enabled;
  const telegramOn = config && config.telegram && config.telegram.enabled;
  if (!googleOn && !telegramOn) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1, height: 1, background: axelionColors.borderLight }} />
        <span style={{ fontSize: 12, color: axelionColors.textMuted, letterSpacing: '0.05em' }}>{t('login.social.or')}</span>
        <div style={{ flex: 1, height: 1, background: axelionColors.borderLight }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {googleOn && <div ref={googleBtnRef} />}
        {telegramOn && <div ref={tgRef} />}
      </div>
    </div>
  );
};

export default SocialLogin;
