import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Tabs,
  Tab,
  Divider,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Person,
  Lock,
  Gavel,
  AdminPanelSettings,
  CheckCircle,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';
import api from '../../services/api';
import { axelionColors } from '../../theme/axelionTheme';
import LanguageSwitcher from '../../components/LanguageSwitcher';

/**
 * MaslaXat Unified Login Page
 * Single elegant login form for all user types with demo access
 */
const LoginPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { loading, error } = useSelector((state) => state.auth);

  const [activeTab, setActiveTab] = useState(0);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const userTypes = [
    {
      label: 'Клиент',
      icon: <Person sx={{ fontSize: 20 }} />,
      role: 'client',
      dashboard: '/dashboard',
      demoEmail: 'client@maslaxat.uz',
      demoPassword: 'client123',
      mockUser: {
        id: 1,
        name: 'Клиент Тестовый',
        email: 'client@maslaxat.uz',
        role: 'client',
      },
    },
    {
      label: 'Юрист',
      icon: <Gavel sx={{ fontSize: 20 }} />,
      role: 'lawyer',
      dashboard: '/lawyer/dashboard',
      demoEmail: 'ivanov@maslaxat.uz',
      demoPassword: 'lawyer123',
      mockUser: {
        id: 10,
        name: 'Иванов Иван Иванович',
        email: 'ivanov@maslaxat.uz',
        role: 'lawyer',
        specializations: ['Гражданское право', 'Семейное право'],
      },
    },
    {
      label: 'Админ',
      icon: <AdminPanelSettings sx={{ fontSize: 20 }} />,
      role: 'admin',
      dashboard: '/admin/dashboard',
      demoEmail: 'admin@maslaxat.uz',
      demoPassword: 'admin123',
      mockUser: {
        id: 3,
        name: 'Администратор',
        email: 'admin@maslaxat.uz',
        role: 'admin',
      },
    },
  ];

  const currentUserType = userTypes[activeTab];

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const performLogin = async (email, password) => {
    dispatch(loginStart());
    try {
      const response = await api.post('/auth/login', { email, password });
      const { user, token, role } = response.data;

      dispatch(loginSuccess({ user, token, role }));

      const dashboardMap = { client: '/dashboard', lawyer: '/lawyer/dashboard', admin: '/admin/dashboard' };
      navigate(dashboardMap[role] || '/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Ошибка входа';
      dispatch(loginFailure(message));
    }
  };

  const handleDemoLogin = () => {
    performLogin(currentUserType.demoEmail, currentUserType.demoPassword);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    performLogin(formData.email, formData.password);
  };

  const inputStyles = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: axelionColors.bgLight,
      borderRadius: '8px',
      '& fieldset': {
        borderColor: axelionColors.borderLight,
      },
      '&:hover fieldset': {
        borderColor: axelionColors.gold,
      },
      '&.Mui-focused fieldset': {
        borderColor: axelionColors.gold,
        borderWidth: 1,
      },
    },
    '& .MuiInputLabel-root.Mui-focused': {
      color: axelionColors.gold,
    },
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: axelionColors.bgCream,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 4,
        position: 'relative',
      }}
    >
      {/* Language Switcher */}
      <Box sx={{ position: 'fixed', top: 20, right: 20, zIndex: 10 }}>
        <LanguageSwitcher variant="buttons" />
      </Box>

      {/* Decorative elements */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '200px',
          height: '200px',
          borderTop: `1px solid ${axelionColors.gold}15`,
          borderLeft: `1px solid ${axelionColors.gold}15`,
        }}
      />
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          right: 0,
          width: '200px',
          height: '200px',
          borderBottom: `1px solid ${axelionColors.gold}15`,
          borderRight: `1px solid ${axelionColors.gold}15`,
        }}
      />

      <Container maxWidth="sm">
        <Card
          sx={{
            p: { xs: 3, sm: 5 },
            boxShadow: '0 8px 40px rgba(26, 26, 26, 0.08)',
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            backgroundColor: axelionColors.bgLight,
          }}
        >
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography
              sx={{
                fontWeight: 300,
                fontSize: '2.5rem',
                letterSpacing: '0.3em',
                color: axelionColors.gold,
                mb: 0.5,
              }}
            >
              M
            </Typography>
            <Typography
              sx={{
                fontWeight: 300,
                fontSize: '1.25rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: axelionColors.textDark,
              }}
            >
              MaslaXat
            </Typography>
            <Box
              sx={{
                width: '50px',
                height: '1px',
                backgroundColor: axelionColors.gold,
                margin: '12px auto',
              }}
            />
            <Typography
              sx={{
                color: axelionColors.textMuted,
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
              }}
            >
              Legal Platform
            </Typography>
          </Box>

          {/* User Type Tabs */}
          <Tabs
            value={activeTab}
            onChange={(e, val) => setActiveTab(val)}
            variant="fullWidth"
            sx={{
              mb: 4,
              '& .MuiTabs-indicator': {
                backgroundColor: axelionColors.gold,
                height: '2px',
              },
              '& .MuiTab-root': {
                color: axelionColors.textMuted,
                fontWeight: 500,
                fontSize: '0.85rem',
                textTransform: 'none',
                letterSpacing: '0.05em',
                minHeight: 48,
                '&.Mui-selected': {
                  color: axelionColors.gold,
                },
              },
            }}
          >
            {userTypes.map((type, index) => (
              <Tab
                key={index}
                icon={type.icon}
                label={type.label}
                iconPosition="start"
                sx={{ gap: 1 }}
              />
            ))}
          </Tabs>

          {/* Error Alert */}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 3,
                borderRadius: '8px',
                backgroundColor: axelionColors.errorLight,
                border: `1px solid ${axelionColors.error}20`,
                '& .MuiAlert-icon': {
                  color: axelionColors.error,
                },
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
              placeholder={currentUserType.demoEmail}
              sx={{ mb: 2.5, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Person sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
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
              placeholder="••••••••"
              sx={{ mb: 3, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      sx={{ color: axelionColors.textMuted }}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              fullWidth
              type="submit"
              disabled={loading || !formData.email || !formData.password}
              sx={{
                background: `linear-gradient(135deg, ${axelionColors.gold} 0%, ${axelionColors.goldDark} 100%)`,
                color: '#FFFFFF',
                py: 1.5,
                borderRadius: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 500,
                fontSize: '0.85rem',
                boxShadow: 'none',
                mb: 2,
                '&:hover': {
                  background: `linear-gradient(135deg, ${axelionColors.goldDark} 0%, ${axelionColors.bronze} 100%)`,
                  boxShadow: 'none',
                },
                '&.Mui-disabled': {
                  backgroundColor: axelionColors.bgBeige,
                  color: axelionColors.textMuted,
                },
              }}
            >
              {loading ? <CircularProgress size={22} sx={{ color: '#FFFFFF' }} /> : 'Войти'}
            </Button>

            <Box sx={{ textAlign: 'right' }}>
              <Box
                component="span"
                onClick={() => navigate('/forgot-password')}
                sx={{
                  color: axelionColors.textMuted,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  '&:hover': { color: axelionColors.gold },
                }}
              >
                Забыли пароль?
              </Box>
            </Box>
          </form>

          {/* Demo Section */}
          <Box sx={{ mt: 3, pt: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
            <Typography
              sx={{
                textAlign: 'center',
                fontSize: '0.7rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: axelionColors.textMuted,
                mb: 2,
              }}
            >
              Быстрый демо-вход
            </Typography>

            <Button
              fullWidth
              onClick={handleDemoLogin}
              disabled={loading}
              sx={{
                backgroundColor: axelionColors.textDark,
                color: '#FFFFFF',
                py: 1.5,
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 500,
                fontSize: '0.85rem',
                boxShadow: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                '&:hover': {
                  backgroundColor: '#2D2D2D',
                  boxShadow: 'none',
                },
              }}
            >
              {currentUserType.icon}
              Войти как {currentUserType.label}
            </Button>

            <Box sx={{ mt: 2, p: 2, bgcolor: axelionColors.bgCream, borderRadius: '8px' }}>
              <Typography sx={{ fontSize: '0.75rem', color: axelionColors.textMuted, mb: 1 }}>
                Демо-данные для входа:
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: axelionColors.textSecondary, fontFamily: 'monospace' }}>
                Email: {currentUserType.demoEmail}
              </Typography>
              <Typography sx={{ fontSize: '0.8rem', color: axelionColors.textSecondary, fontFamily: 'monospace' }}>
                Пароль: {currentUserType.demoPassword}
              </Typography>
            </Box>
          </Box>

          {/* Features */}
          <Box sx={{ mt: 4, pt: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
              {['AI-консультант', 'Проверенные юристы', 'Безопасно'].map((feature, index) => (
                <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <CheckCircle sx={{ fontSize: 14, color: axelionColors.gold }} />
                  <Typography sx={{ color: axelionColors.textSecondary, fontSize: '0.75rem' }}>
                    {feature}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Register Link */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography sx={{ color: axelionColors.textMuted, fontSize: '0.85rem' }}>
              Нет аккаунта?{' '}
              <Box
                component="span"
                onClick={() => navigate('/register')}
                sx={{
                  color: axelionColors.gold,
                  cursor: 'pointer',
                  fontWeight: 500,
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                Зарегистрироваться
              </Box>
            </Typography>
          </Box>

          {/* Footer */}
          <Typography
            sx={{
              textAlign: 'center',
              color: axelionColors.textMuted,
              fontSize: '0.7rem',
              letterSpacing: '0.05em',
              mt: 3,
            }}
          >
            © 2024 MaslaXat. Все права защищены.
          </Typography>
        </Card>
      </Container>
    </Box>
  );
};

export default LoginPage;
