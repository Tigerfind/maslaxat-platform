import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { useTranslation } from '../../i18n';

// Оценка силы пароля: 0..4 (по длине и разнообразию символов)
const getPasswordScore = (pw) => {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { loading } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  const [searchParams] = useSearchParams();
  const roleFromUrl = searchParams.get('role');
  const [role, setRole] = useState(roleFromUrl === 'lawyer' ? 'lawyer' : 'client');
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
      setError(t('register.nameMin'));
      return false;
    }
    if (!formData.email || !/\S+@\S+\.\S+/.test(formData.email)) {
      setError(t('register.emailInvalid'));
      return false;
    }
    if (!formData.password || formData.password.length < 6) {
      setError(t('register.passwordMin'));
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError(t('register.passwordsMismatch'));
      return false;
    }
    if (role === 'lawyer' && !formData.specialization) {
      setError(t('register.specRequired'));
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
      const message = err.response?.data?.error || t('register.regError');
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
            {t('register.backToLogin')}
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
              {t('register.title')}
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
              {t('register.registerAs')}
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
                {t('register.roleClient')}
              </ToggleButton>
              <ToggleButton value="lawyer">
                <Gavel sx={{ mr: 1, fontSize: 20 }} />
                {t('register.roleLawyer')}
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
              label={t('register.fullName')}
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder={role === 'lawyer' ? 'Иванов Иван Иванович' : t('register.namePlaceholder')}
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
              label={t('register.phoneOptional')}
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
                label={t('register.specialization')}
                name="specialization"
                value={formData.specialization}
                onChange={handleChange}
                placeholder={t('register.specPlaceholder')}
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
              label={t('register.password')}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              placeholder={t('register.passwordPlaceholder')}
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

            {/* Индикатор силы пароля */}
            {formData.password && (() => {
              const score = getPasswordScore(formData.password);
              const meta = [
                { label: t('register.pwWeak'), color: axelionColors.error },
                { label: t('register.pwWeak'), color: axelionColors.error },
                { label: t('register.pwMedium'), color: axelionColors.warning },
                { label: t('register.pwGood'), color: axelionColors.gold },
                { label: t('register.pwStrong'), color: axelionColors.success },
              ][score];
              return (
                <Box sx={{ mt: -0.5, mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 0.75, mb: 0.75 }}>
                    {[0, 1, 2, 3].map((i) => (
                      <Box key={i} sx={{ flex: 1, height: 4, borderRadius: 2, background: i < score ? meta.color : axelionColors.borderLight, transition: 'background .3s' }} />
                    ))}
                  </Box>
                  <Typography sx={{ fontSize: '0.72rem', color: meta.color }}>{meta.label}</Typography>
                </Box>
              );
            })()}

            <TextField
              fullWidth
              label={t('register.confirmPassword')}
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder={t('register.confirmPlaceholder')}
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
                role === 'lawyer' ? t('register.submitLawyer') : t('register.submit')
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
                {t('register.lawyerNote')}
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
            {t('register.copyright')}
          </Typography>
        </Card>
      </Container>
    </Box>
  );
};

export default RegisterPage;
