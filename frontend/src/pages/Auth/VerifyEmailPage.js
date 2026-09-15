import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Box, Button, CircularProgress, TextField, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import api from '../../services/api';
import { updateProfile } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { isAuthenticated, role, user } = useSelector((state) => state.auth);
  const legacyToken = searchParams.get('token');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState(legacyToken ? 'loading' : 'form');
  const [message, setMessage] = useState(location.state?.verificationDelivery === 'failed' ? t('authFlow.verifyDeliveryFailed') : '');
  const [messageError, setMessageError] = useState(location.state?.verificationDelivery === 'failed');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(location.state?.verificationDelivery === 'sent' ? 60 : 0);
  const verificationStarted = useRef(false);

  useEffect(() => {
    if (!legacyToken || verificationStarted.current) return;
    verificationStarted.current = true;
    api.get(`/auth/verify-email/${legacyToken}`)
      .then(async () => {
        setStatus('success');
        setMessage(t('authFlow.verifyOk'));
        if (isAuthenticated) {
          try {
            const { data } = await api.get('/auth/me');
            if (data.user) dispatch(updateProfile(data.user));
          } catch {
            // Verification succeeded; session data refreshes on the next login.
          }
        }
      })
      .catch((error) => {
        setStatus('error');
        setMessage(error.response?.data?.error || t('authFlow.verifyBad'));
      });
  }, [legacyToken, isAuthenticated, dispatch, t]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const goHome = () => navigate(isAuthenticated ? (role === 'lawyer' ? '/lawyer/dashboard' : '/dashboard') : '/login');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code) || submitting) return;
    setSubmitting(true);
    setMessage('');
    setMessageError(false);
    try {
      const { data } = await api.post('/auth/verify-email', { code });
      if (data.user) dispatch(updateProfile(data.user));
      setStatus('success');
      setMessage(t('authFlow.verifyOk'));
    } catch (error) {
      setMessageError(true);
      setMessage(error.response?.data?.error || t('authFlow.verifyBadCode'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resending || cooldown > 0) return;
    setResending(true);
    setMessage('');
    setMessageError(false);
    try {
      const { data } = await api.post('/auth/resend-verification');
      setCooldown(data.retryAfter || 60);
      setMessage(t('authFlow.verifyCodeSent'));
    } catch (error) {
      const retryAfter = Number(error.response?.data?.retryAfter || error.response?.headers?.['retry-after']);
      if (retryAfter > 0) setCooldown(retryAfter);
      setMessageError(true);
      setMessage(error.response?.data?.error || t('authFlow.verifyDeliveryFailed'));
    } finally {
      setResending(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F1EB', px: 2, py: 4 }}>
      <Box sx={{ maxWidth: 440, width: '100%', backgroundColor: '#fff', borderRadius: 3, border: '1px solid #E8E4DE', p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 300, letterSpacing: '0.15em', color: '#B8956E', mb: 4, textTransform: 'uppercase' }}>MaslaXat</Typography>

        {status === 'loading' && <><CircularProgress sx={{ color: '#B8956E', mb: 2 }} /><Typography color="text.secondary">{t('authFlow.verifyChecking')}</Typography></>}

        {status === 'form' && !isAuthenticated && (
          <>
            <ErrorOutlineIcon sx={{ fontSize: 64, color: '#B8956E', mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>{t('authFlow.verifyLoginTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>{t('authFlow.verifyLoginText')}</Typography>
            <Button variant="contained" onClick={() => navigate('/login')} sx={{ backgroundColor: '#B8956E' }}>{t('authFlow.login')}</Button>
          </>
        )}

        {status === 'form' && isAuthenticated && (
          <Box component="form" onSubmit={handleSubmit}>
            <Typography variant="h6" sx={{ mb: 1 }}>{t('authFlow.verifyCodeTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>{t('authFlow.verifyCodeText')} <strong>{user?.email}</strong></Typography>
            {message && <Alert severity={messageError ? 'error' : 'info'} sx={{ mb: 2, textAlign: 'left' }}>{message}</Alert>}
            <TextField autoFocus fullWidth label={t('authFlow.verifyCodeLabel')} value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputProps={{ inputMode: 'numeric', pattern: '[0-9]*', maxLength: 6, style: { textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.35em' } }}
              sx={{ mb: 2 }} />
            <Button type="submit" fullWidth variant="contained" disabled={submitting || code.length !== 6} sx={{ backgroundColor: '#B8956E', mb: 1.5 }}>
              {submitting ? <CircularProgress size={22} color="inherit" /> : t('authFlow.verifySubmit')}
            </Button>
            <Button type="button" fullWidth disabled={resending || cooldown > 0} onClick={handleResend}>
              {resending ? t('authFlow.sending') : cooldown > 0 ? `${t('authFlow.verifyResendIn')} ${cooldown}` : t('authFlow.verifyResend')}
            </Button>
          </Box>
        )}

        {status === 'success' && (
          <>
            <CheckCircleOutlineIcon sx={{ fontSize: 64, color: '#4CAF50', mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>{t('authFlow.verifyOkTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>{message}</Typography>
            <Button variant="contained" onClick={goHome} sx={{ backgroundColor: '#B8956E' }}>{isAuthenticated ? t('authFlow.goDashboard') : t('authFlow.login')}</Button>
          </>
        )}

        {status === 'error' && (
          <>
            <ErrorOutlineIcon sx={{ fontSize: 64, color: '#f44336', mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>{t('authFlow.verifyErrTitle')}</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>{message}</Typography>
            <Button variant="outlined" onClick={goHome} sx={{ borderColor: '#B8956E', color: '#B8956E' }}>{isAuthenticated ? t('authFlow.goHome') : t('authFlow.login')}</Button>
          </>
        )}
      </Box>
    </Box>
  );
};

export default VerifyEmailPage;
