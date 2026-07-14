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
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Gavel,
  Lock,
  AttachMoney,
  People,
  Schedule,
  TrendingUp,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';
import { axelionColors } from '../../theme/axelionTheme';
import api from '../../services/api';

/**
 * MaslaXat Premium Lawyer Login
 * Elegant, minimalist design with gold accents
 */
const LawyerLoginGlass = () => {
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

  const performLogin = async (email, password) => {
    dispatch(loginStart());
    try {
      const response = await api.post('/auth/login', { email, password });
      const { user, token, role } = response.data;
      dispatch(loginSuccess({ user, token, role }));
      navigate('/lawyer/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || err.message || 'Ошибка входа';
      dispatch(loginFailure(message));
    }
  };

  const handleQuickLogin = () => {
    performLogin('akbarov@maslaxat.uz', 'lawyer123');
  };

  const handleSubmit = async (e) => {
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
      }}
    >
      {/* Decorative elements */}
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '150px',
          height: '150px',
          borderTop: `1px solid rgba(184, 149, 110, 0.1)`,
          borderRight: `1px solid rgba(184, 149, 110, 0.1)`,
        }}
      />
      <Box
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '150px',
          height: '150px',
          borderBottom: `1px solid rgba(184, 149, 110, 0.1)`,
          borderLeft: `1px solid rgba(184, 149, 110, 0.1)`,
        }}
      />

      <Container maxWidth="sm">
        <Card
          sx={{
            p: { xs: 4, sm: 6 },
            boxShadow: '0 8px 32px rgba(26, 26, 26, 0.08)',
            border: `1px solid ${axelionColors.borderLight}`,
            borderRadius: '8px',
            backgroundColor: axelionColors.bgLight,
          }}
        >
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 5 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '8px',
                bgcolor: axelionColors.bronze,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
                mb: 3,
              }}
            >
              <Gavel sx={{ fontSize: 40, color: 'white' }} />
            </Box>
            <Typography
              sx={{
                fontWeight: 300,
                fontSize: '1.5rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: axelionColors.textDark,
                mb: 1,
              }}
            >
              eMaslaXat
            </Typography>
            <Box
              sx={{
                width: '60px',
                height: '2px',
                backgroundColor: axelionColors.gold,
                margin: '16px auto',
              }}
            />
            <Typography
              sx={{
                color: axelionColors.textMuted,
                fontSize: '0.8rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Lawyer Portal
            </Typography>
          </Box>

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
              required
              sx={{ mb: 3, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Gavel sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
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
              sx={{ mb: 2, ...inputStyles }}
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

            <Box sx={{ textAlign: 'right', mb: 3 }}>
              <Link
                to="/forgot-password"
                style={{
                  color: axelionColors.gold,
                  textDecoration: 'none',
                  fontSize: '0.8rem',
                  letterSpacing: '0.05em',
                }}
              >
                Забыли пароль?
              </Link>
            </Box>

            <Button
              fullWidth
              type="submit"
              disabled={loading}
              sx={{
                backgroundColor: axelionColors.bronze,
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
                  backgroundColor: axelionColors.bronzeDark,
                  boxShadow: 'none',
                },
                '&.Mui-disabled': {
                  backgroundColor: axelionColors.bgBeige,
                  color: axelionColors.textMuted,
                },
              }}
            >
              {loading ? <CircularProgress size={24} sx={{ color: '#FFFFFF' }} /> : 'Войти'}
            </Button>

            <Button
              fullWidth
              onClick={handleQuickLogin}
              disabled={loading}
              sx={{
                backgroundColor: axelionColors.textDark,
                color: '#FFFFFF',
                py: 1.5,
                borderRadius: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: 500,
                fontSize: '0.85rem',
                boxShadow: 'none',
                mb: 3,
                '&:hover': {
                  backgroundColor: '#2D2D2D',
                  boxShadow: 'none',
                },
              }}
            >
              Quick Login (Demo)
            </Button>

            <Typography
              sx={{
                textAlign: 'center',
                color: axelionColors.textSecondary,
                fontSize: '0.85rem',
              }}
            >
              Нет аккаунта?{' '}
              <Link
                to="/register/lawyer"
                style={{
                  color: axelionColors.gold,
                  textDecoration: 'none',
                  fontWeight: 500,
                }}
              >
                Стать юристом платформы
              </Link>
            </Typography>
          </form>

          {/* Benefits for Lawyers */}
          <Box sx={{ mt: 5, pt: 4, borderTop: `1px solid ${axelionColors.borderLight}` }}>
            <Typography
              sx={{
                fontWeight: 500,
                fontSize: '0.7rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: axelionColors.textMuted,
                textAlign: 'center',
                mb: 3,
              }}
            >
              Benefits for Lawyers
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 2,
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
                    gap: 1.5,
                    p: 2,
                    borderRadius: '8px',
                    backgroundColor: axelionColors.bgWarm,
                    border: `1px solid ${axelionColors.borderLight}`,
                  }}
                >
                  <Box sx={{ color: axelionColors.gold }}>{benefit.icon}</Box>
                  <Typography sx={{ color: axelionColors.textPrimary, fontSize: '0.8rem' }}>
                    {benefit.text}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* Other Login Options */}
          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography
              sx={{
                color: axelionColors.textMuted,
                fontSize: '0.7rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                mb: 2,
              }}
            >
              Other Portals
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Link to="/login/client" style={{ textDecoration: 'none' }}>
                <Button
                  sx={{
                    color: axelionColors.textSecondary,
                    border: `1px solid ${axelionColors.borderLight}`,
                    borderRadius: '8px',
                    px: 3,
                    py: 1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontWeight: 500,
                    fontSize: '0.7rem',
                    '&:hover': {
                      borderColor: axelionColors.gold,
                      color: axelionColors.gold,
                      backgroundColor: axelionColors.accentLight,
                    },
                  }}
                >
                  Client
                </Button>
              </Link>
              <Link to="/login/admin" style={{ textDecoration: 'none' }}>
                <Button
                  sx={{
                    color: axelionColors.textSecondary,
                    border: `1px solid ${axelionColors.borderLight}`,
                    borderRadius: '8px',
                    px: 3,
                    py: 1,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    fontWeight: 500,
                    fontSize: '0.7rem',
                    '&:hover': {
                      borderColor: axelionColors.gold,
                      color: axelionColors.gold,
                      backgroundColor: axelionColors.accentLight,
                    },
                  }}
                >
                  Admin
                </Button>
              </Link>
            </Box>
          </Box>
        </Card>
      </Container>
    </Box>
  );
};

export default LawyerLoginGlass;
