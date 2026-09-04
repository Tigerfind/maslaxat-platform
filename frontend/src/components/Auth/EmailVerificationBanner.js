import React, { useState } from 'react';
import { Alert, Button, Collapse } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import { updateProfile } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';

const EmailVerificationBanner = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { t } = useTranslation();
  const { user } = useSelector((state) => state.auth);
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const hiddenRoute = /^\/consultations\/(video|zoom)\//.test(location.pathname) || location.pathname === '/verify-email';
  if (!user || user.isVerified || dismissed || hiddenRoute) return null;

  const handleResend = async () => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await api.post('/auth/resend-verification');
      setSent(true);
    } catch (requestError) {
      if (requestError.response?.status === 400) {
        try {
          const { data } = await api.get('/auth/me');
          if (data.user?.isVerified) dispatch(updateProfile(data.user));
          else setError(requestError.response?.data?.error || t('emailBanner.error'));
        } catch {
          setError(requestError.response?.data?.error || t('emailBanner.error'));
        }
      } else {
        setError(requestError.response?.data?.error || t('emailBanner.error'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Collapse in>
      <Alert
        severity={error ? 'error' : 'warning'}
        onClose={() => setDismissed(true)}
        action={!sent ? (
          <Button size="small" disabled={sending} onClick={handleResend} sx={{ color: '#8A6848', fontWeight: 600 }}>
            {sending ? t('emailBanner.sending') : t('emailBanner.resend')}
          </Button>
        ) : null}
        sx={{ borderRadius: 0 }}
      >
        {error || (sent ? t('emailBanner.sent') : t('emailBanner.prompt'))}
      </Alert>
    </Collapse>
  );
};

export default EmailVerificationBanner;
