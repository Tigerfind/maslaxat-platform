import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import axios from 'axios';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Токен верификации не найден');
      return;
    }

    axios.get(`/api/auth/verify-email/${token}`)
      .then(() => {
        setStatus('success');
        setMessage('Email успешно подтверждён!');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Недействительная или просроченная ссылка');
      });
  }, [searchParams]);

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
            <Typography color="text.secondary">Проверяем токен...</Typography>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircleOutlineIcon sx={{ fontSize: 64, color: '#4CAF50', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 400, mb: 1 }}>
              Email подтверждён
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {message}
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate('/dashboard')}
              sx={{ backgroundColor: '#B8956E', '&:hover': { backgroundColor: '#A07A5A' } }}
            >
              Перейти в личный кабинет
            </Button>
          </>
        )}

        {status === 'error' && (
          <>
            <ErrorOutlineIcon sx={{ fontSize: 64, color: '#f44336', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 400, mb: 1 }}>
              Ошибка верификации
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              {message}
            </Typography>
            <Button
              variant="outlined"
              onClick={() => navigate('/dashboard')}
              sx={{ borderColor: '#B8956E', color: '#B8956E' }}
            >
              На главную
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
};

export default VerifyEmailPage;
