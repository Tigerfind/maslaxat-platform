import React, { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { loginSuccess } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';

const LinkedInCallbackPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const ticket = params.get('ticket');
    const mode = params.get('mode') || 'register';
    const providerError = params.get('error');
    window.history.replaceState({}, document.title, window.location.pathname);
    if (providerError || !ticket) {
      setError(t('login.social.linkedinFailed'));
      return;
    }
    const endpoint = mode === 'link' ? '/auth/linkedin/link/complete' : '/auth/linkedin/complete';
    api.post(endpoint, { ticket })
      .then(({ data }) => {
        if (mode === 'link') {
          navigate('/settings?linkedin=connected', { replace: true });
          return;
        }
        if (data.twoFactorRequired) {
          navigate('/login', {
            replace: true,
            state: { twoFactor: { tempToken: data.tempToken, email: '' } },
          });
          return;
        }
        dispatch(loginSuccess({ user: data.user, token: data.token, role: data.role }));
        navigate('/lawyer/dashboard', { replace: true });
      })
      .catch((requestError) => setError(
        requestError.response?.data?.code === 'ACCOUNT_LINK_REQUIRED'
          ? t('login.social.linkedinAccountExists')
          : t('login.social.linkedinFailed'),
      ));
  }, [dispatch, navigate, t]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--canvas)', padding: 24 }}>
      <div className="glass-card" style={{ maxWidth: 460, padding: 32, textAlign: 'center' }}>
        <h1 role="status" aria-live="polite" style={{ fontSize: 22 }}>{error ? t('login.social.linkedinErrorTitle') : t('login.social.linkedinCompleting')}</h1>
        {error && <p style={{ color: 'var(--error)' }}>{error}</p>}
        {error && <button type="button" onClick={() => navigate('/register?role=lawyer')}>{t('common.retry')}</button>}
      </div>
    </main>
  );
};

export default LinkedInCallbackPage;
