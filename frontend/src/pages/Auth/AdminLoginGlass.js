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
  Chip,
  Card,
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

const AdminLoginGlass = () => {
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
          {/* Logo with Security Badge */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                bgcolor: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 2,
                boxShadow: '0 4px 12px rgba(220, 38, 38, 0.2)',
              }}
            >
              <Shield sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography
              variant="h4"
              fontWeight="bold"
              sx={{ color: '#0B1B2B' }}
              gutterBottom
            >
              Панель администратора
            </Typography>
            <Chip
              icon={<Security sx={{ fontSize: 16 }} />}
              label="Защищенный вход"
              sx={{
                mt: 1,
                bgcolor: '#DC2626',
                color: 'white',
                fontWeight: 'bold',
              }}
              size="small"
            />
          </Box>

          {/* Security Warning */}
          <Alert
            severity="warning"
            icon={<VerifiedUser />}
            sx={{
              mb: 3,
              borderRadius: 2,
            }}
          >
            Только для авторизованных администраторов. Все действия логируются.
          </Alert>

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
                    <Shield sx={{ color: '#6B7280' }} />
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
                to="/admin/forgot-password"
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
              sx={{
                mb: 2,
                bgcolor: '#DC2626',
                '&:hover': {
                  bgcolor: '#B91C1C',
                },
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
              sx={{ mb: 2 }}
            >
              🚀 Быстрый вход (Тест)
            </Button>
          </form>

          {/* Admin Capabilities */}
          <Box sx={{ mt: 4, pt: 4, borderTop: '1px solid #E6E9EE' }}>
            <Typography
              variant="subtitle2"
              fontWeight="bold"
              sx={{ color: '#0B1B2B' }}
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
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #E6E9EE',
                  }}
                >
                  <Security sx={{ fontSize: 20, color: '#DC2626' }} />
                  <Typography variant="body2" sx={{ color: '#0B1B2B' }}>
                    {capability}
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
        </Card>
      </Container>
    </Box>
  );
};

export default AdminLoginGlass;
