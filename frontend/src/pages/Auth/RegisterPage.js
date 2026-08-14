import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import {
  Container, Box, Typography, TextField, Button, Alert, CircularProgress,
  InputAdornment, IconButton, Card, Checkbox,
} from '@mui/material';
import {
  Visibility, VisibilityOff, Person, Lock, Email, Phone, Gavel, ArrowBack,
  ArrowForward, CheckCircle,
} from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { loginSuccess } from '../../store/slices/authSlice';
import api from '../../services/api';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';
import { SPECIALIZATION_NAMES } from '../../constants/specializations';
import { specLabel } from '../../utils/specLabel';

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
  const { t } = useTranslation();

  const [searchParams] = useSearchParams();
  const roleFromUrl = searchParams.get('role');
  const [role, setRole] = useState(roleFromUrl === 'lawyer' ? 'lawyer' : 'client');
  const [step, setStep] = useState(0);
  // Локальный сабмит-лоадер (НЕ глобальный auth.loading — тот разбирает роутер и ломает
  // navigate после регистрации; login полагается на редирект маршрута, а мы — на navigate).
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: '', specializations: [],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');

  // Шаги зависят от роли: у юриста добавляется выбор специализации.
  const steps = role === 'lawyer'
    ? ['role', 'account', 'spec']
    : ['role', 'account'];
  const isLast = step === steps.length - 1;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  // Валидация конкретного шага (шаг «роль» валиден всегда).
  const validateStep = () => {
    const key = steps[step];
    if (key === 'account') {
      if (!formData.name || formData.name.length < 2) { setError(t('register.nameMin')); return false; }
      if (!formData.email || !/\S+@\S+\.\S+/.test(formData.email)) { setError(t('register.emailInvalid')); return false; }
      if (!formData.password || formData.password.length < 8) { setError(t('register.passwordMin')); return false; }
      if (formData.password !== formData.confirmPassword) { setError(t('register.passwordsMismatch')); return false; }
      if (!acceptedTerms) { setError(t('register.acceptRequired')); return false; }
    }
    if (key === 'spec' && formData.specializations.length === 0) { setError(t('register.specRequired')); return false; }
    return true;
  };

  const next = () => {
    if (!validateStep()) return;
    setError('');
    if (isLast) { handleSubmit(); return; }
    setStep((s) => s + 1);
  };
  const back = () => { setError(''); if (step === 0) navigate('/login'); else setStep((s) => s - 1); };

  const handleSubmit = async () => {
    if (!acceptedTerms) { setError(t('register.acceptRequired')); return; }
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
        phone: formData.phone || undefined,
        role,
        acceptedTerms: true,
        legalVersion: '2026-08-13',
        ...(role === 'lawyer' && formData.specializations.length ? { specializations: formData.specializations } : {}),
      };
      const response = await api.post('/auth/register', payload);
      const { user, token } = response.data;
      dispatch(loginSuccess({ user, token, role: user.role }));
      navigate(user.role === 'lawyer' ? '/lawyer/dashboard' : '/dashboard', { replace: true });
    } catch (err) {
      const message = err.response?.data?.error || t('register.regError');
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyles = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: axelionColors.bgLight, borderRadius: '8px',
      '& fieldset': { borderColor: axelionColors.borderLight },
      '&:hover fieldset': { borderColor: axelionColors.gold },
      '&.Mui-focused fieldset': { borderColor: axelionColors.gold, borderWidth: 1 },
    },
    '& .MuiInputLabel-root.Mui-focused': { color: axelionColors.gold },
  };

  // ── Шаг 1: выбор роли (карточки) ──
  const RoleCard = ({ value, icon, title, desc }) => {
    const active = role === value;
    return (
      <Card
        onClick={() => { setRole(value); setError(''); }}
        sx={{
          flex: 1, p: 2.5, cursor: 'pointer', textAlign: 'center', borderRadius: '12px', boxShadow: 'none',
          border: `1.5px solid ${active ? axelionColors.gold : axelionColors.borderLight}`,
          background: active ? `${axelionColors.gold}12` : axelionColors.bgLight,
          transition: 'all .18s',
          '&:hover': { borderColor: axelionColors.gold },
        }}
      >
        <Box sx={{
          width: 52, height: 52, borderRadius: '14px', mx: 'auto', mb: 1.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? `linear-gradient(135deg, ${axelionColors.gold}, ${axelionColors.goldDark})` : `${axelionColors.gold}18`,
          color: active ? '#fff' : axelionColors.goldDark,
        }}>{icon}</Box>
        <Typography sx={{ fontWeight: 600, fontSize: '0.98rem', color: axelionColors.textDark, mb: 0.5 }}>{title}</Typography>
        <Typography sx={{ fontSize: '0.76rem', color: axelionColors.textMuted, lineHeight: 1.4 }}>{desc}</Typography>
        {active && <CheckCircle sx={{ color: axelionColors.gold, fontSize: 20, mt: 1 }} />}
      </Card>
    );
  };

  const stepBody = () => {
    const key = steps[step];
    if (key === 'role') {
      return (
        <Box>
          <Typography sx={stepTitleSx}>{t('register.stepRoleTitle')}</Typography>
          <Typography sx={stepSubSx}>{t('register.stepRoleSub')}</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
            <RoleCard value="client" icon={<Person />} title={t('register.roleClient')} desc={t('register.roleClientDesc')} />
            <RoleCard value="lawyer" icon={<Gavel />} title={t('register.roleLawyer')} desc={t('register.roleLawyerDesc')} />
          </Box>
        </Box>
      );
    }
    if (key === 'account') {
      const score = getPasswordScore(formData.password);
      const pwMeta = [
        { label: t('register.pwWeak'), color: axelionColors.error },
        { label: t('register.pwWeak'), color: axelionColors.error },
        { label: t('register.pwMedium'), color: axelionColors.warning },
        { label: t('register.pwGood'), color: axelionColors.gold },
        { label: t('register.pwStrong'), color: axelionColors.success },
      ][score];
      return (
        <Box>
          <Typography sx={stepTitleSx}>{t('register.stepAccountTitle')}</Typography>
          <Typography sx={stepSubSx}>{t('register.stepAccountSub')}</Typography>
          <Box sx={{ mt: 2 }}>
            <TextField fullWidth label={t('register.fullName')} name="name" value={formData.name} onChange={handleChange}
              placeholder={role === 'lawyer' ? 'Иванов Иван Иванович' : t('register.namePlaceholder')}
              sx={{ mb: 2, ...inputStyles }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Person sx={{ color: axelionColors.textMuted, fontSize: 20 }} /></InputAdornment> }} />
            <TextField fullWidth label="Email" name="email" type="email" value={formData.email} onChange={handleChange}
              placeholder="your@email.com" sx={{ mb: 2, ...inputStyles }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Email sx={{ color: axelionColors.textMuted, fontSize: 20 }} /></InputAdornment> }} />
            <TextField fullWidth label={t('register.phoneOptional')} name="phone" value={formData.phone} onChange={handleChange}
              placeholder="+998 90 123 45 67" sx={{ mb: 2, ...inputStyles }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Phone sx={{ color: axelionColors.textMuted, fontSize: 20 }} /></InputAdornment> }} />
            <TextField fullWidth label={t('register.password')} name="password" type={showPassword ? 'text' : 'password'}
              value={formData.password} onChange={handleChange} placeholder={t('register.passwordPlaceholder')}
              sx={{ mb: formData.password ? 1 : 2, ...inputStyles }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><Lock sx={{ color: axelionColors.textMuted, fontSize: 20 }} /></InputAdornment>,
                endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShowPassword(!showPassword)} edge="end" sx={{ color: axelionColors.textMuted }}>{showPassword ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment>,
              }} />
            {formData.password && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 0.75, mb: 0.75 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <Box key={i} sx={{ flex: 1, height: 4, borderRadius: 2, background: i < score ? pwMeta.color : axelionColors.borderLight, transition: 'background .3s' }} />
                  ))}
                </Box>
                <Typography sx={{ fontSize: '0.72rem', color: pwMeta.color }}>{pwMeta.label}</Typography>
              </Box>
            )}
            <TextField fullWidth label={t('register.confirmPassword')} name="confirmPassword" type={showPassword ? 'text' : 'password'}
              value={formData.confirmPassword} onChange={handleChange} placeholder={t('register.confirmPlaceholder')}
              sx={{ ...inputStyles }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Lock sx={{ color: axelionColors.textMuted, fontSize: 20 }} /></InputAdornment> }} />
            <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'flex-start' }}>
              <Checkbox inputProps={{ 'aria-label': t('register.acceptRequired') }} checked={acceptedTerms} onChange={(e) => { setAcceptedTerms(e.target.checked); setError(''); }} size="small" />
              <Typography component="span" sx={{ pt: 1, fontSize: '0.76rem', color: axelionColors.textSecondary, lineHeight: 1.5 }}>
                {t('register.acceptPrefix')} <Box component="a" href="/terms" target="_blank" rel="noopener noreferrer" sx={{ color: axelionColors.goldDark }}>{t('register.terms')}</Box>{' '}
                {t('register.and')} <Box component="a" href="/privacy" target="_blank" rel="noopener noreferrer" sx={{ color: axelionColors.goldDark }}>{t('register.privacy')}</Box>
              </Typography>
            </Box>
          </Box>
        </Box>
      );
    }
    // spec (только юрист)
    return (
      <Box>
        <Typography sx={stepTitleSx}>{t('register.stepSpecTitle')}</Typography>
        <Typography sx={stepSubSx}>{t('register.stepSpecSub')}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
          {SPECIALIZATION_NAMES.map((sp) => {
            const on = formData.specializations.includes(sp);
            const toggle = () => {
              setError('');
              setFormData((f) => ({
                ...f,
                specializations: f.specializations.includes(sp)
                  ? f.specializations.filter((x) => x !== sp)
                  : [...f.specializations, sp],
              }));
            };
            return (
              <Box key={sp} onClick={toggle}
                sx={{
                  cursor: 'pointer', px: 1.6, py: 0.9, borderRadius: '10px', fontSize: '0.83rem', fontWeight: on ? 600 : 400,
                  border: `1px solid ${on ? axelionColors.gold : axelionColors.borderLight}`,
                  background: on ? axelionColors.gold : axelionColors.bgLight,
                  color: on ? '#fff' : axelionColors.textSecondary, transition: 'all .15s',
                  '&:hover': { borderColor: axelionColors.gold },
                }}>
                {on && '✓ '}{specLabel(t, sp)}
              </Box>
            );
          })}
        </Box>
        <Box sx={{ mt: 2.5, p: 2, bgcolor: axelionColors.bgCream, borderRadius: '8px', border: `1px solid ${axelionColors.borderLight}` }}>
          <Typography sx={{ fontSize: '0.8rem', color: axelionColors.textSecondary }}>{t('register.lawyerNote')}</Typography>
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: axelionColors.bgCream, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
      <Container maxWidth="sm">
        <Card sx={{ p: { xs: 3, sm: 5 }, boxShadow: '0 8px 40px rgba(26, 26, 26, 0.08)', border: `1px solid ${axelionColors.borderLight}`, borderRadius: '8px', backgroundColor: axelionColors.bgLight }}>
          {/* Logo */}
          <Box sx={{ textAlign: 'center', mb: 2.5 }}>
            <Typography sx={{ fontWeight: 300, fontSize: '2rem', letterSpacing: '0.3em', color: axelionColors.gold, mb: 0.5 }}>M</Typography>
            <Typography sx={{ fontWeight: 300, fontSize: '1.1rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: axelionColors.textDark }}>{t('register.title')}</Typography>
          </Box>

          {/* Step progress */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3, justifyContent: 'center' }}>
            {steps.map((s, i) => (
              <React.Fragment key={s}>
                <Box sx={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', fontWeight: 600, transition: 'all .25s',
                  background: i <= step ? `linear-gradient(135deg, ${axelionColors.gold}, ${axelionColors.goldDark})` : axelionColors.bgBeige,
                  color: i <= step ? '#fff' : axelionColors.textMuted,
                }}>{i < step ? '✓' : i + 1}</Box>
                {i < steps.length - 1 && <Box sx={{ width: 34, height: 2, borderRadius: 1, background: i < step ? axelionColors.gold : axelionColors.borderLight, transition: 'background .25s' }} />}
              </React.Fragment>
            ))}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: '8px', backgroundColor: axelionColors.errorLight, border: `1px solid ${axelionColors.error}20` }}>{error}</Alert>
          )}

          {/* Animated step body */}
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
              {stepBody()}
            </motion.div>
          </AnimatePresence>

          {/* Nav buttons */}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 3.5 }}>
            <Button startIcon={<ArrowBack />} onClick={back}
              sx={{ color: axelionColors.textMuted, textTransform: 'none', flexShrink: 0, '&:hover': { color: axelionColors.gold } }}>
              {step === 0 ? t('register.backToLogin') : t('register.back')}
            </Button>
            <Button fullWidth onClick={next} disabled={submitting}
              endIcon={!isLast && !submitting ? <ArrowForward /> : null}
              sx={{
                background: `linear-gradient(135deg, ${axelionColors.gold} 0%, ${axelionColors.goldDark} 100%)`,
                color: '#FFFFFF', py: 1.4, borderRadius: '8px', textTransform: 'uppercase', letterSpacing: '0.08em',
                fontWeight: 500, fontSize: '0.82rem', boxShadow: 'none',
                '&:hover': { background: `linear-gradient(135deg, ${axelionColors.goldDark} 0%, ${axelionColors.bronze} 100%)` },
                '&.Mui-disabled': { backgroundColor: axelionColors.bgBeige, color: axelionColors.textMuted },
              }}>
              {submitting ? <CircularProgress size={22} sx={{ color: '#FFFFFF' }} />
                : isLast ? (role === 'lawyer' ? t('register.submitLawyer') : t('register.submit')) : t('register.next')}
            </Button>
          </Box>

          <Typography sx={{ textAlign: 'center', color: axelionColors.textMuted, fontSize: '0.7rem', letterSpacing: '0.05em', mt: 3.5 }}>{t('register.copyright')}</Typography>
        </Card>
      </Container>
    </Box>
  );
};

const stepTitleSx = { fontSize: '1.05rem', fontWeight: 600, color: axelionColors.textDark, textAlign: 'center' };
const stepSubSx = { fontSize: '0.82rem', color: axelionColors.textMuted, textAlign: 'center', mt: 0.5 };

export default RegisterPage;
