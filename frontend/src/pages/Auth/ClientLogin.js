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
  Person,
  Lock,
  CheckCircle,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';

const ClientLogin = () => {
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
      // TODO: Replace with actual API call
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Mock response
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
        background: 'linear-gradient(135deg, #3d5a52 0%, #5a7d72 100%)',
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
                background: 'linear-gradient(135deg, #3d5a52 0%, #a67c52 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
              }}
            >
              <Person sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography variant="h4" fontWeight="bold" color="primary" gutterBottom>
              Вход для клиентов
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Получите доступ к юридическим консультациям
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
                    <Person color="primary" />
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
                    <Lock color="primary" />
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
                  color: '#3d5a52',
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
              sx={{
                py: 1.5,
                background: 'linear-gradient(135deg, #3d5a52 0%, #5a7d72 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #2a403a 0%, #3d5a52 100%)',
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
                borderColor: '#3d5a52',
                color: '#3d5a52',
                '&:hover': {
                  borderWidth: 2,
                  bgcolor: 'rgba(61, 90, 82, 0.04)',
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
                bgcolor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                mb: 2,
              }}
            >
              <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block">
                Тестовые данные:
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Email: client@maslaxat.uz
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Пароль: client123
              </Typography>
            </Box>

            <Typography variant="body2" textAlign="center" color="text.secondary">
              Нет аккаунта?{' '}
              <Link
                to="/register/client"
                style={{
                  color: '#3d5a52',
                  textDecoration: 'none',
                  fontWeight: 'bold',
                }}
              >
                Зарегистрироваться
              </Link>
            </Typography>
          </form>

          {/* Benefits */}
          <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #e0e0e0' }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              color="text.secondary"
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
                <Box
                  key={index}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <CheckCircle sx={{ fontSize: 18, color: '#10b981' }} />
                  <Typography variant="body2" color="text.secondary">
                    {benefit}
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
        </Paper>
      </Container>
    </Box>
  );
};

export default ClientLogin;
