import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  Container,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  InputAdornment,
  IconButton,
  Paper,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Gavel,
  Lock,
  TrendingUp,
  AttachMoney,
  People,
  Schedule,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';

const LawyerLogin = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { loading, error } = useSelector((state) => state.auth);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleQuickLogin = async () => {
    setFormData({
      email: 'lawyer@maslaxat.uz',
      password: 'lawyer123',
    });

    dispatch(loginStart());

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const mockUser = {
        id: 2,
        name: 'Юрист Иванов',
        email: 'lawyer@maslaxat.uz',
        role: 'lawyer',
        specialization: 'Гражданское право',
        rating: 4.8,
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-lawyer',
          role: 'lawyer',
        })
      );

      navigate('/lawyer/dashboard');
    } catch (err) {
      dispatch(loginFailure(err.message || 'Ошибка входа'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    dispatch(loginStart());

    try {
      // TODO: Replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mockUser = {
        id: 1,
        name: 'Юрист Иванов',
        email: formData.email,
        role: 'lawyer',
        specialization: 'Гражданское право',
        rating: 4.8,
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-lawyer',
          role: 'lawyer',
        })
      );

      navigate('/lawyer/dashboard');
    } catch (err) {
      dispatch(loginFailure(err.message || 'Ошибка входа'));
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #a67c52 0%, #8b6442 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={8}
          sx={{
            p: 5,
            borderRadius: 4,
            background: '#ffffff',
          }}
        >
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #a67c52 0%, #c29a6e 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
              }}
            >
              <Gavel sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography variant="h4" fontWeight="bold" color="secondary" gutterBottom>
              Вход для юристов
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Управляйте своей практикой и клиентами
            </Typography>
          </Box>

          {/* Error Alert */}
          {error && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              required
              sx={{ mb: 3 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Gavel color="secondary" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Пароль"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              required
              sx={{ mb: 2 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock color="secondary" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Box sx={{ textAlign: 'right', mb: 3 }}>
              <Link
                to="/forgot-password"
                style={{
                  color: '#a67c52',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                }}
              >
                Забыли пароль?
              </Link>
            </Box>

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              color="secondary"
              sx={{
                py: 1.5,
                background: 'linear-gradient(135deg, #a67c52 0%, #c29a6e 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #8b6442 0%, #a67c52 100%)',
                },
                mb: 2,
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Войти'}
            </Button>

            <Button
              fullWidth
              variant="outlined"
              size="large"
              onClick={handleQuickLogin}
              disabled={loading}
              sx={{
                py: 1.5,
                borderWidth: 2,
                borderColor: '#a67c52',
                color: '#a67c52',
                '&:hover': {
                  borderWidth: 2,
                  bgcolor: 'rgba(166, 124, 82, 0.04)',
                },
                mb: 2,
              }}
            >
              🚀 Быстрый вход (Тест)
            </Button>

            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: '#fef3c7',
                border: '1px solid #fde68a',
                mb: 2,
              }}
            >
              <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block">
                Тестовые данные:
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Email: lawyer@maslaxat.uz
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Пароль: lawyer123
              </Typography>
            </Box>

            <Typography variant="body2" textAlign="center" color="text.secondary">
              Нет аккаунта?{' '}
              <Link
                to="/register/lawyer"
                style={{
                  color: '#a67c52',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                Стать юристом платформы
              </Link>
            </Typography>
          </form>

          {/* Benefits for Lawyers */}
          <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #e0e0e0' }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              color="text.secondary"
              textAlign="center"
              gutterBottom
            >
              Преимущества для юристов:
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
                mt: 2,
              }}
            >
              {[
                { icon: <AttachMoney />, text: 'Дополнительный доход' },
                { icon: <People />, text: 'Новые клиенты' },
                { icon: <Schedule />, text: 'Гибкий график' },
                { icon: <TrendingUp />, text: 'Рост репутации' },
              ].map((benefit, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: '#faf8f6',
                  }}
                >
                  <Box sx={{ color: '#a67c52' }}>{benefit.icon}</Box>
                  <Typography variant="caption" color="text.secondary">
                    {benefit.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Other Login Options */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Другие варианты входа:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 1, justifyContent: 'center' }}>
              <Link to="/login/client" style={{ textDecoration: 'none' }}>
                <Button variant="outlined" size="small">
                  Клиент
                </Button>
              </Link>
              <Link to="/login/admin" style={{ textDecoration: 'none' }}>
                <Button variant="outlined" size="small">
                  Админ
                </Button>
              </Link>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default LawyerLogin;
