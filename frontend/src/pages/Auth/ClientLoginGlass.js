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
  Card,
  CardContent,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Person,
  Lock,
  CheckCircle,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';

const ClientLoginGlass = () => {
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
      email: 'client@maslaxat.uz',
      password: 'client123',
    });

    dispatch(loginStart());

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const mockUser = {
        id: 1,
        name: 'Клиент Тестовый',
        email: 'client@maslaxat.uz',
        role: 'client',
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-client',
          role: 'client',
        })
      );

      navigate('/dashboard');
    } catch (err) {
      dispatch(loginFailure(err.message || 'Ошибка входа'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    dispatch(loginStart());

    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const mockUser = {
        id: 1,
        name: 'Клиент Тестовый',
        email: formData.email,
        role: 'client',
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-client',
          role: 'client',
        })
      );

      navigate('/dashboard');
    } catch (err) {
      dispatch(loginFailure(err.message || 'Ошибка входа'));
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#F4F6F8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Card
          sx={{
            p: { xs: 3, sm: 5 },
            boxShadow: '0 2px 6px rgba(11, 27, 43, 0.06)',
            border: '1px solid #E6E9EE',
            borderRadius: '12px',
          }}
        >
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: '#2563EB',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
              }}
            >
              <Person sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography
              variant="h4"
              fontWeight="bold"
              sx={{ color: '#0B1B2B' }}
              gutterBottom
            >
              Вход для клиентов
            </Typography>
            <Typography variant="body2" sx={{ color: '#6B7280' }}>
              Получите доступ к юридическим консультациям
            </Typography>
          </Box>

          {/* Error Alert */}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 3,
                borderRadius: 2,
              }}
            >
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
                    <Person sx={{ color: '#6B7280' }} />
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
                    <Lock sx={{ color: '#6B7280' }} />
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
                  color: '#2563EB',
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
              sx={{ mb: 2 }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Войти'}
            </Button>

            <Button
              fullWidth
              variant="outlined"
              size="large"
              onClick={handleQuickLogin}
              disabled={loading}
              sx={{ mb: 2 }}
            >
              🚀 Быстрый вход (Тест)
            </Button>

            <Typography variant="body2" textAlign="center" sx={{ color: '#6B7280' }}>
              Нет аккаунта?{' '}
              <Link
                to="/register/client"
                style={{
                  color: '#2563EB',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                Зарегистрироваться
              </Link>
            </Typography>
          </form>

          {/* Benefits */}
          <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #E6E9EE' }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              sx={{ color: '#0B1B2B' }}
              textAlign="center"
              gutterBottom
            >
              Преимущества платформы:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
              {[
                'AI-консультант 24/7',
                'Проверенные юристы',
                'Анализ документов',
                'Быстрые ответы',
              ].map((benefit, index) => (
                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircle sx={{ fontSize: 18, color: '#10B981' }} />
                  <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                    {benefit}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Other Login Options */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: '#6B7280' }}>
              Другие варианты входа:
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 1, justifyContent: 'center' }}>
              <Link to="/login/lawyer" style={{ textDecoration: 'none' }}>
                <Button variant="outlined" size="small">
                  Юрист
                </Button>
              </Link>
              <Link to="/login/admin" style={{ textDecoration: 'none' }}>
                <Button variant="outlined" size="small">
                  Админ
                </Button>
              </Link>
            </Box>
          </Box>
        </Card>
      </Container>
    </Box>
  );
};

export default ClientLoginGlass;
