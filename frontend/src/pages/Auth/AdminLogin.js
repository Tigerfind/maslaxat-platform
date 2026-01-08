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
  Chip,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Shield,
  Lock,
  Security,
  VerifiedUser,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';

const AdminLogin = () => {
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
      email: 'admin@maslaxat.uz',
      password: 'admin123',
    });

    dispatch(loginStart());

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const mockUser = {
        id: 3,
        name: 'Администратор',
        email: 'admin@maslaxat.uz',
        role: 'admin',
        permissions: ['all'],
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-admin',
          role: 'admin',
        })
      );

      navigate('/admin/dashboard');
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
        name: 'Администратор',
        email: formData.email,
        role: 'admin',
        permissions: ['all'],
      };

      dispatch(
        loginSuccess({
          user: mockUser,
          token: 'mock-jwt-token-admin',
          role: 'admin',
        })
      );

      navigate('/admin/dashboard');
    } catch (err) {
      dispatch(loginFailure(err.message || 'Ошибка входа'));
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
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
            border: '2px solid #ef4444',
          }}
        >
          {/* Logo with Security Badge */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
                boxShadow: '0 8px 24px rgba(239, 68, 68, 0.3)',
              }}
            >
              <Shield sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography variant="h4" fontWeight="bold" sx={{ color: '#ef4444' }} gutterBottom>
              Панель администратора
            </Typography>
            <Chip
              icon={<Security />}
              label="Защищенный вход"
              color="error"
              size="small"
              sx={{ mt: 1 }}
            />
          </Box>

          {/* Security Warning */}
          <Alert severity="warning" icon={<VerifiedUser />} sx={{ mb: 3, borderRadius: 2 }}>
            Только для авторизованных администраторов. Все действия логируются.
          </Alert>

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
              label="Email администратора"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              required
              sx={{ mb: 3 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Shield sx={{ color: '#ef4444' }} />
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
                    <Lock sx={{ color: '#ef4444' }} />
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
                to="/admin/forgot-password"
                style={{
                  color: '#ef4444',
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
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                },
                mb: 2,
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : 'Войти в систему'}
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
                borderColor: '#ef4444',
                color: '#ef4444',
                '&:hover': {
                  borderWidth: 2,
                  bgcolor: 'rgba(239, 68, 68, 0.04)',
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
                bgcolor: '#fef2f2',
                border: '1px solid #fecaca',
                mb: 2,
              }}
            >
              <Typography variant="caption" fontWeight="bold" color="text.secondary" display="block">
                Тестовые данные:
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Email: admin@maslaxat.uz
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">
                Пароль: admin123
              </Typography>
            </Box>
          </form>

          {/* Admin Capabilities */}
          <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #e0e0e0' }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              color="text.secondary"
              textAlign="center"
              gutterBottom
            >
              Возможности администратора:
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: 1.5,
                mt: 2,
              }}
            >
              {[
                'Управление пользователями и юристами',
                'Мониторинг всех транзакций',
                'Модерация контента и документов',
                'Аналитика и отчеты',
                'Настройка системы и тарифов',
              ].map((capability, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: '#fef2f2',
                    border: '1px solid #fee2e2',
                  }}
                >
                  <Security sx={{ fontSize: 20, color: '#ef4444' }} />
                  <Typography variant="body2" color="text.secondary">
                    {capability}
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
              <Link to="/login/lawyer" style={{ textDecoration: 'none' }}>
                <Button variant="outlined" size="small">
                  Юрист
                </Button>
              </Link>
            </Box>
          </Box>
        </Paper>
      </Container>
    </Box>
  );
};

export default AdminLogin;
