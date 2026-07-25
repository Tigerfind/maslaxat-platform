import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import api from '../../services/api';
import { updateProfile } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { isAuthenticated } = useSelector((state) => state.auth);
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage(t('authFlow.verifyNoToken'));
      return;
    }

    api.get(`/auth/verify-email/${token}`)
      .then(() => {
        setStatus('success');
        setMessage(t('authFlow.verifyOk'));
        // Обновляем redux/localStorage, чтобы баннер «подтвердите email» исчез сразу
        if (isAuthenticated) dispatch(updateProfile({ isVerified: true }));
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || t('authFlow.verifyBad'));
      });
  }, [searchParams, isAuthenticated, dispatch]);

  // Куда вести после успеха: залогинен → кабинет, иначе → вход
  const goHome = () => navigate(isAuthenticated ? '/dashboard' : '/login');

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F5F1EB',
        px: 3,
      }}
    >
      <Box
        sx={{
          maxWidth: 440,
          width: '100%',
          backgroundColor: '#fff',
          borderRadius: 3,
          border: '1px solid #E8E4DE',
          p: 5,
          textAlign: 'center',
        }}
      >
        <Typography
          variant="h5"
          sx={{ fontWeight: 300, letterSpacing: '0.15em', color: '#B8956E', mb: 4, textTransform: 'uppercase' }}
        >
          MaslaXat
        </Typography>

        {status === 'loading' && (
          <>
            <CircularProgress sx={{ color: '#B8956E', mb: 2 }} />
            <Typography color="text.secondary">{t('authFlow.verifyChecking')}</Typography>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircleOutlineIcon sx={{ fontSize: 64, color: '#4CAF50', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 400, mb: 1 }}>
              {t('authFlow.verifyOkTitle')}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {message}
            </Typography>
            <Button
              variant="contained"
              onClick={goHome}
              sx={{ backgroundColor: '#B8956E', '&:hover': { backgroundColor: '#A07A5A' } }}
            >
              {isAuthenticated ? t('authFlow.goDashboard') : t('authFlow.login')}
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <ErrorOutlineIcon sx={{ fontSize: 64, color: '#f44336', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 400, mb: 1 }}>
              {t('authFlow.verifyErrTitle')}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {message}
            </Typography>
            <Button
              variant="outlined"
              onClick={goHome}
              sx={{ borderColor: '#B8956E', color: '#B8956E' }}
            >
              {isAuthenticated ? t('authFlow.goHome') : t('authFlow.login')}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
};

export default VerifyEmailPage;
