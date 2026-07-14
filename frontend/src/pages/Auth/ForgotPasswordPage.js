import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, TextField, Button, Container, Alert } from '@mui/material';
import { ArrowBack, Email } from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import api from '../../services/api';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: axelionColors.bgCream, display: 'flex', alignItems: 'center' }}>
      <Container maxWidth="sm">
        <Box sx={{ bgcolor: axelionColors.bgLight, borderRadius: '8px', border: `1px solid ${axelionColors.borderLight}`, p: { xs: 3, md: 5 } }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography sx={{ fontWeight: 300, fontSize: '1.5rem', letterSpacing: '0.2em', color: axelionColors.gold, textTransform: 'uppercase', mb: 1 }}>
              MaslaXat
            </Typography>
            <Typography sx={{ fontWeight: 300, fontSize: '1.1rem', letterSpacing: '0.1em', color: axelionColors.textDark, textTransform: 'uppercase' }}>
              Сброс пароля
            </Typography>
          </Box>

          {sent ? (
            <Box sx={{ textAlign: 'center' }}>
              <Email sx={{ fontSize: 64, color: axelionColors.gold, mb: 2, opacity: 0.6 }} />
              <Typography sx={{ color: axelionColors.textDark, mb: 1, fontWeight: 500 }}>
                Письмо отправлено
              </Typography>
              <Typography sx={{ color: axelionColors.textMuted, mb: 3, fontSize: '0.9rem' }}>
                Если аккаунт с email <strong>{email}</strong> существует, вы получите ссылку для сброса пароля.
              </Typography>
              <Button
                onClick={() => navigate('/login')}
                sx={{ color: axelionColors.gold, textTransform: 'none' }}
              >
                Вернуться к входу
              </Button>
            </Box>
          ) : (
            <form onSubmit={handleSubmit}>
              <Typography sx={{ color: axelionColors.textMuted, mb: 3, fontSize: '0.9rem' }}>
                Введите email, указанный при регистрации. Мы отправим ссылку для сброса пароля.
              </Typography>

              {error && <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>{error}</Alert>}

              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                sx={{ mb: 3 }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={loading || !email.trim()}
                sx={{
                  bgcolor: axelionColors.gold,
                  color: 'white',
                  py: 1.5,
                  borderRadius: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                  boxShadow: 'none',
                  mb: 2,
                  '&:hover': { bgcolor: axelionColors.goldDark, boxShadow: 'none' },
                }}
              >
                {loading ? 'Отправка...' : 'Отправить ссылку'}
              </Button>

              <Button
                startIcon={<ArrowBack />}
                onClick={() => navigate('/login')}
                fullWidth
                sx={{ color: axelionColors.textMuted, textTransform: 'none' }}
              >
                Вернуться к входу
              </Button>
            </form>
          )}
        </Box>
      </Container>
    </Box>
  );
};

export default ForgotPasswordPage;
