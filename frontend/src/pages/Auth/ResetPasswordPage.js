import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Typography, TextField, Button, Container, Alert } from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import api from '../../services/api';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Пароль должен быть минимум 6 символов');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, display: 'flex', alignItems: 'center' }}>
        <Container maxWidth="sm">
          <Box sx={{ bgcolor: axelionColors.bgLight, borderRadius: '8px', border: `1px solid ${axelionColors.borderLight}`, p: 5, textAlign: 'center' }}>
            <Typography sx={{ color: axelionColors.error, mb: 2 }}>
              Недействительная ссылка для сброса пароля
            </Typography>
            <Button onClick={() => navigate('/forgot-password')} sx={{ color: axelionColors.gold, textTransform: 'none' }}>
              Запросить новую ссылку
            </Button>
          </Box>
        </Container>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, display: 'flex', alignItems: 'center' }}>
      <Container maxWidth="sm">
        <Box sx={{ bgcolor: axelionColors.bgLight, borderRadius: '8px', border: `1px solid ${axelionColors.borderLight}`, p: { xs: 3, md: 5 } }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography sx={{ fontWeight: 300, fontSize: '1.5rem', letterSpacing: '0.2em', color: axelionColors.gold, textTransform: 'uppercase', mb: 1 }}>
              MaslaXat
            </Typography>
            <Typography sx={{ fontWeight: 300, fontSize: '1.1rem', letterSpacing: '0.1em', color: axelionColors.textDark, textTransform: 'uppercase' }}>
              Новый пароль
            </Typography>
          </Box>

          {success ? (
            <Box sx={{ textAlign: 'center' }}>
              <CheckCircle sx={{ fontSize: 64, color: axelionColors.success, mb: 2 }} />
              <Typography sx={{ color: axelionColors.textDark, mb: 1, fontWeight: 500 }}>
                Пароль изменён
              </Typography>
              <Typography sx={{ color: axelionColors.textMuted, mb: 3, fontSize: '0.9rem' }}>
                Вы можете войти с новым паролем.
              </Typography>
              <Button
                variant="contained"
                onClick={() => navigate('/login')}
                sx={{
                  bgcolor: axelionColors.gold,
                  color: 'white',
                  px: 4,
                  borderRadius: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  boxShadow: 'none',
                  '&:hover': { bgcolor: axelionColors.goldDark, boxShadow: 'none' },
                }}
              >
                Войти
              </Button>
            </Box>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>{error}</Alert>}

              <TextField
                fullWidth
                label="Новый пароль"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Подтвердите пароль"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                sx={{ mb: 3 }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={loading}
                sx={{
                  bgcolor: axelionColors.gold,
                  color: 'white',
                  py: 1.5,
                  borderRadius: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                  boxShadow: 'none',
                  '&:hover': { bgcolor: axelionColors.goldDark, boxShadow: 'none' },
                }}
              >
                {loading ? 'Сохранение...' : 'Сохранить пароль'}
              </Button>
            </form>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default ResetPasswordPage;
