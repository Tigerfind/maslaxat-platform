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
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Person,
  Lock,
  Email,
  Phone,
  Gavel,
  ArrowBack,
} from '@mui/icons-material';
import { loginStart, loginSuccess, loginFailure } from '../../store/slices/authSlice';
import api from '../../services/api';
import { axelionColors } from '../../theme/axelionTheme';

const RegisterPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { loading } = useSelector((state) => state.auth);

  const [role, setRole] = useState('client');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    specialization: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const validate = () => {
    if (!formData.name || formData.name.length < 2) {
      setError('Имя должно содержать минимум 2 символа');
      return false;
    }
    if (!formData.email || !/\S+@\S+\.\S+/.test(formData.email)) {
      setError('Введите корректный email');
      return false;
    }
    if (!formData.password || formData.password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Пароли не совпадают');
      return false;
    }
    if (role === 'lawyer' && !formData.specialization) {
      setError('Укажите специализацию');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    dispatch(loginStart());
    setError('');

    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone || undefined,
        role,
        ...(role === 'lawyer' && formData.specialization ? { specialization: formData.specialization } : {}),
      };

      const response = await api.post('/auth/register', payload);
      const { user, token } = response.data;

      dispatch(loginSuccess({ user, token, role: user.role }));

      const dashboardMap = {
        client: '/dashboard',
        lawyer: '/lawyer/dashboard',
      };
      navigate(dashboardMap[user.role] || '/dashboard');
    } catch (err) {
      const message = err.response?.data?.error || 'Ошибка регистрации';
      dispatch(loginFailure(message));
      setError(message);
    }
  };

  const inputStyles = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: axelionColors.bgLight,
      borderRadius: '8px',
      '& fieldset': { borderColor: axelionColors.borderLight },
      '&:hover fieldset': { borderColor: axelionColors.gold },
      '&.Mui-focused fieldset': { borderColor: axelionColors.gold, borderWidth: 1 },
    },
    '& .MuiInputLabel-root.Mui-focused': { color: axelionColors.gold },
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
          {/* Back button */}
          <Button
            startIcon={<ArrowBack />}
            onClick={() => navigate('/login')}
            sx={{
              color: axelionColors.textMuted,
              textTransform: 'none',
              mb: 2,
              '&:hover': { color: axelionColors.gold },
            }}
          >
            Назад ко входу
          </Button>

          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Typography
              sx={{
                fontWeight: 300,
                fontSize: '2rem',
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
                fontSize: '1.1rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: axelionColors.textDark,
              }}
            >
              Регистрация
            </Typography>
            <Box
              sx={{
                width: '50px',
                height: '1px',
                backgroundColor: axelionColors.gold,
                margin: '12px auto',
              }}
            />
          </Box>

          {/* Role Selection */}
          <Box sx={{ mb: 3 }}>
            <Typography
              sx={{
                fontSize: '0.7rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: axelionColors.textMuted,
                mb: 1.5,
                textAlign: 'center',
              }}
            >
              Я регистрируюсь как
            </Typography>
            <ToggleButtonGroup
              value={role}
              exclusive
              onChange={(e, val) => val && setRole(val)}
              fullWidth
              sx={{
                '& .MuiToggleButton-root': {
                  border: `1px solid ${axelionColors.borderLight}`,
                  color: axelionColors.textSecondary,
                  textTransform: 'none',
                  fontWeight: 500,
                  py: 1.5,
                  '&.Mui-selected': {
                    backgroundColor: axelionColors.gold,
                    color: '#FFFFFF',
                    borderColor: axelionColors.gold,
                    '&:hover': { backgroundColor: axelionColors.goldDark },
                  },
                },
              }}
            >
              <ToggleButton value="client">
                <Person sx={{ mr: 1, fontSize: 20 }} />
                Клиент
              </ToggleButton>
              <ToggleButton value="lawyer">
                <Gavel sx={{ mr: 1, fontSize: 20 }} />
                Юрист
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* Error */}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 2,
                borderRadius: '8px',
                backgroundColor: axelionColors.errorLight,
                border: `1px solid ${axelionColors.error}20`,
              }}
            >
              {error}
            </Alert>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Полное имя"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder={role === 'lawyer' ? 'Иванов Иван Иванович' : 'Ваше имя'}
              sx={{ mb: 2, ...inputStyles }}
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
              label="Email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              sx={{ mb: 2, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Email sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Телефон (необязательно)"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder="+998 90 123 45 67"
              sx={{ mb: 2, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Phone sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
                  </InputAdornment>
                ),
              }}
            />

            {/* Lawyer-specific: specialization */}
            {role === 'lawyer' && (
              <TextField
                fullWidth
                label="Специализация"
                name="specialization"
                value={formData.specialization}
                onChange={handleChange}
                placeholder="Например: Гражданское право"
                sx={{ mb: 2, ...inputStyles }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Gavel sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
                    </InputAdornment>
                  ),
                }}
              />
            )}

            <TextField
              fullWidth
              label="Пароль"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              placeholder="Минимум 6 символов"
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

            <TextField
              fullWidth
              label="Подтвердите пароль"
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Повторите пароль"
              sx={{ mb: 3, ...inputStyles }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock sx={{ color: axelionColors.textMuted, fontSize: 20 }} />
                  </InputAdornment>
                ),
              }}
            />

            <Button
              fullWidth
              type="submit"
              disabled={loading}
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
                '&:hover': {
                  background: `linear-gradient(135deg, ${axelionColors.goldDark} 0%, ${axelionColors.bronze} 100%)`,
                },
                '&.Mui-disabled': {
                  backgroundColor: axelionColors.bgBeige,
                  color: axelionColors.textMuted,
                },
              }}
            >
              {loading ? (
                <CircularProgress size={22} sx={{ color: '#FFFFFF' }} />
              ) : (
                role === 'lawyer' ? 'Зарегистрироваться как юрист' : 'Зарегистрироваться'
              )}
            </Button>
          </form>

          {/* Info for lawyers */}
          {role === 'lawyer' && (
            <Box
              sx={{
                mt: 3,
                p: 2,
                bgcolor: axelionColors.bgCream,
                borderRadius: '8px',
                border: `1px solid ${axelionColors.borderLight}`,
              }}
            >
              <Typography sx={{ fontSize: '0.8rem', color: axelionColors.textSecondary }}>
                После регистрации заполните профиль — фото, описание, расписание и прайс.
                Как только заполните все шаги, ваш профиль появится в каталоге юристов.
              </Typography>
            </Box>
          )}

          {/* Footer */}
          <Typography
            sx={{
              textAlign: 'center',
              color: axelionColors.textMuted,
              fontSize: '0.7rem',
              letterSpacing: '0.05em',
              mt: 4,
            }}
          >
            © 2024 MaslaXat. Все права защищены.
          </Typography>
        </Card>
      </Container>
    </Box>
  );
};

export default RegisterPage;
