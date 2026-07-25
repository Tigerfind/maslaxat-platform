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
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { motion } from 'framer-motion';
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
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../../components/LanguageSwitcher';

/**
 * MaslaXat Unified Login Page
 * Single elegant login form for all user types with demo access
 */
const LoginPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { loading, error } = useSelector((state) => state.auth);
  const { t } = useTranslation();

  const isDev = process.env.NODE_ENV === 'development';

  const [activeTab, setActiveTab] = useState(0);
  const [formData, setFormData] = useState({
    email: localStorage.getItem('rememberedEmail') || '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(Boolean(localStorage.getItem('rememberedEmail')));
  const [touched, setTouched] = useState({ email: false, password: false });
  const [twoFA, setTwoFA] = useState({ required: false, tempToken: null, code: '', error: '', loading: false, email: '' });

  const userTypes = [
    { label: t('login.client'), icon: <Person sx={{ fontSize: 20 }} />, role: 'client', dashboard: '/dashboard', demoEmail: 'client@maslaxat.uz', demoPassword: 'client123' },
    { label: t('login.lawyer'), icon: <Gavel sx={{ fontSize: 20 }} />, role: 'lawyer', dashboard: '/lawyer/dashboard', demoEmail: 'ivanov@maslaxat.uz', demoPassword: 'lawyer123' },
    { label: t('login.admin'), icon: <AdminPanelSettings sx={{ fontSize: 20 }} />, role: 'admin', dashboard: '/admin/dashboard', demoEmail: 'admin@maslaxat.uz', demoPassword: 'admin123' },
  ];

  const currentUserType = userTypes[activeTab];

  // Инлайн-валидация
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email);
  const emailError = touched.email && !formData.email ? t('login.errEmailRequired')
    : touched.email && !emailValid ? t('login.errEmailInvalid') : '';
  const passwordError = touched.password && !formData.password ? t('login.errPasswordRequired') : '';
  const formValid = emailValid && Boolean(formData.password);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };
  const handleBlur = (e) => setTouched((prev) => ({ ...prev, [e.target.name]: true }));

  const dashboardMap = { client: '/dashboard', lawyer: '/lawyer/dashboard', admin: '/admin/dashboard' };

  const finishLogin = (data, email) => {
    const { user, token, role } = data;
    if (rememberMe) localStorage.setItem('rememberedEmail', email);
    else localStorage.removeItem('rememberedEmail');
    dispatch(loginSuccess({ user, token, role }));
    navigate(dashboardMap[role] || '/dashboard');
  };

  const performLogin = async (email, password) => {
    dispatch(loginStart());
    try {
      const response = await api.post('/auth/login', { email, password });

      // Аккаунт с 2FA — переходим ко второму шагу (ввод кода), токен пока не выдан
      if (response.data.twoFactorRequired) {
        dispatch(loginFailure(null)); // сбрасываем loading без ошибки
        setTwoFA({ required: true, tempToken: response.data.tempToken, code: '', error: '', loading: false, email });
        return;
      }

      finishLogin(response.data, email);
    } catch (err) {
      const message = err.response?.data?.error || err.message || t('login.loginError');
      dispatch(loginFailure(message));
    }
  };

  const submit2FA = async (e) => {
    e.preventDefault();
    const code = twoFA.code.trim();
    if (!code) return;
    setTwoFA((p) => ({ ...p, loading: true, error: '' }));
    try {
      const response = await api.post('/auth/login/2fa', { tempToken: twoFA.tempToken, code });
      finishLogin(response.data, twoFA.email);
    } catch (err) {
      const message = err.response?.data?.error || t('login.twoFA.error');
      setTwoFA((p) => ({ ...p, loading: false, error: message }));
    }
  };

  const cancel2FA = () => setTwoFA({ required: false, tempToken: null, code: '', error: '', loading: false, email: '' });

  const handleDemoLogin = () => {
    performLogin(currentUserType.demoEmail, currentUserType.demoPassword);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!formValid) return;
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
        <LanguageSwitcher variant="dropdown" />
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
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
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

          {/* ── Шаг 2FA: ввод кода ── */}
          {twoFA.required && (
            <form onSubmit={submit2FA}>
              <Typography sx={{ fontSize: 15, fontWeight: 600, color: axelionColors.textDark, mb: 0.5 }}>
                {t('login.twoFA.title')}
              </Typography>
              <Typography sx={{ fontSize: 13, color: axelionColors.textMuted, mb: 2.5 }}>
                {t('login.twoFA.subtitle')}
              </Typography>
              {twoFA.error && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>{twoFA.error}</Alert>
              )}
              <TextField
                fullWidth
                autoFocus
                label={t('login.twoFA.codeLabel')}
                value={twoFA.code}
                onChange={(e) => setTwoFA((p) => ({ ...p, code: e.target.value }))}
                placeholder="123456"
                inputProps={{ inputMode: 'text', autoComplete: 'one-time-code', maxLength: 9 }}
                sx={{ mb: 2.5, ...inputStyles }}
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                disabled={twoFA.loading || !twoFA.code.trim()}
                sx={{ py: 1.5, borderRadius: '8px', textTransform: 'none', fontSize: 16, fontWeight: 600, backgroundColor: axelionColors.gold, '&:hover': { backgroundColor: axelionColors.bronze } }}
              >
                {twoFA.loading ? t('login.twoFA.checking') : t('login.twoFA.submit')}
              </Button>
              <Button
                fullWidth
                onClick={cancel2FA}
                sx={{ mt: 1.5, textTransform: 'none', color: axelionColors.textMuted }}
              >
                {t('login.twoFA.back')}
              </Button>
            </form>
          )}

          {/* Login Form */}
          {!twoFA.required && (
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              error={Boolean(emailError)}
              helperText={emailError}
              placeholder={currentUserType.demoEmail}
              sx={{ mb: emailError ? 1.5 : 2.5, ...inputStyles }}
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
              label={t('login.password')}
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              onBlur={handleBlur}
              error={Boolean(passwordError)}
              helperText={passwordError}
              placeholder="••••••••"
              sx={{ mb: passwordError ? 1.5 : 3, ...inputStyles }}
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

            {/* Remember me + forgot password */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    size="small"
                    sx={{ color: axelionColors.textMuted, '&.Mui-checked': { color: axelionColors.gold } }}
                  />
                }
                label={<Typography sx={{ fontSize: '0.8rem', color: axelionColors.textSecondary }}>{t('login.rememberMe')}</Typography>}
              />
              <Box
                component="span"
                onClick={() => navigate('/forgot-password')}
                sx={{ color: axelionColors.textMuted, fontSize: '0.8rem', cursor: 'pointer', '&:hover': { color: axelionColors.gold } }}
              >
                {t('login.forgotPassword')}
              </Box>
            </Box>

            <Button
              fullWidth
              type="submit"
              disabled={loading || !formValid}
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
              {loading ? <CircularProgress size={22} sx={{ color: '#FFFFFF' }} /> : t('login.login')}
            </Button>
          </form>
          )}

          {/* Demo Section — только в dev, не попадает в прод-сборку */}
          {isDev && !twoFA.required && (
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
                {t('login.demoQuickLogin')}
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
                {t('login.loginAs')} {currentUserType.label}
              </Button>
            </Box>
          )}

          {/* Features */}
          <Box sx={{ mt: 4, pt: 3, borderTop: `1px solid ${axelionColors.borderLight}` }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
              {[t('login.featureAi'), t('login.featureVerified'), t('login.featureSecure')].map((feature, index) => (
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
              {t('login.noAccount')}{' '}
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
                {t('login.register')}
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
        </motion.div>
      </Container>
    </Box>
  );
};

export default LoginPage;
