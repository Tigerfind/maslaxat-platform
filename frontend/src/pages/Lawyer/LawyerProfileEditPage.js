import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Slider, Chip, TextField, CircularProgress } from '@mui/material';
import {
  PhotoCameraOutlined,
  GavelOutlined,
  SaveOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { updateProfile } from '../../store/slices/authSlice';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';
import { specLabel } from '../../utils/specLabel';

/*
  ─────────────────────────────────────────────────────────────
  LAWYER PROFILE EDIT  (/lawyer/profile/edit)
  Ported 1:1 from ClaudeDesign → LawyerApp "PROFILE EDIT".
   • Photo upload · main info (description ≥50, experience 0–40,
     city, price ≥50k) · specialization chips · weekly schedule
   • GET / PUT /lawyer/profile (multipart) — unchanged data layer.
  Chrome (sidebar + topbar + dark toggle + lang + bell) = <GlassShell>.
  ─────────────────────────────────────────────────────────────
*/

const glassCard = {
  background: 'var(--card-glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--card-brd)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 'var(--radius)',
};

const cardHeading = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text)',
  marginBottom: 20,
};

const fieldLabel = {
  fontSize: 12,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 8,
};

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const SPECIALIZATIONS = [
  'Гражданское право', 'Семейное право', 'Трудовое право',
  'Уголовное право', 'Коммерческое право', 'Налоговое право',
  'Административное право', 'Земельное право', 'Корпоративное право',
  'Интеллектуальная собственность', 'Жилищное право', 'Страховое право',
];

const inputSx = {
  '& .MuiOutlinedInput-root': {
    background: 'var(--canvas)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontFamily: 'inherit',
    '& fieldset': { borderColor: 'var(--border)' },
    '&:hover fieldset': { borderColor: 'var(--accent)' },
    '&.Mui-focused fieldset': { borderColor: 'var(--accent)', borderWidth: 1 },
  },
  '& .MuiInputBase-input, & textarea': { color: 'var(--text)' },
  '& .MuiFormHelperText-root': { color: 'var(--text3)' },
};

const timeSx = {
  width: 128,
  ...inputSx,
};

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'Ю';

const LawyerProfileEditPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const DAYS = t('lawyerPanel.days');
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    description: '',
    greeting: '',
    experience: 0,
    price: 200000,
    location: 'Ташкент',
    specialization: '',
    schedule: {},
    avatarFile: null,
    avatarPreview: null,
  });

  // Load current profile
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/lawyer/profile');
        const p = res.data.profile || {};
        setForm({
          description: p.description || '',
          greeting: p.greeting || '',
          experience: p.experience || 0,
          price: p.price || 200000,
          location: p.location || 'Ташкент',
          specialization: p.specialization || '',
          schedule: p.schedule || {},
          avatarFile: null,
          avatarPreview: res.data.user?.avatar || null,
        });
      } catch {
        setError(t('lawyerPanel.loadProfileError'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Единый формат {enabled, from, to} (совместимо с редактором «Часы приёма»).
  const toggleDay = (key) => {
    const current = form.schedule[key];
    handleChange('schedule', {
      ...form.schedule,
      [key]: current?.enabled
        ? { ...current, enabled: false }
        : { enabled: true, from: current?.from || '09:00', to: current?.to || '18:00' },
    });
  };

  const updateTime = (key, field, value) => {
    handleChange('schedule', {
      ...form.schedule,
      [key]: { ...form.schedule[key], [field]: value },
    });
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleChange('avatarFile', file);
      handleChange('avatarPreview', URL.createObjectURL(file));
    }
  };

  const handleSave = async () => {
    if (!form.description || form.description.length < 50) {
      toast.error(t('lawyerPanel.descMin'));
      return;
    }
    if (!form.specialization) {
      toast.error(t('lawyerPanel.specRequired'));
      return;
    }
    if (form.price < 50000) {
      toast.error(t('lawyerPanel.priceMin'));
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('description', form.description);
      formData.append('greeting', form.greeting || '');
      formData.append('experience', String(form.experience));
      formData.append('specialization', form.specialization);
      formData.append('price', String(form.price));
      formData.append('location', form.location);
      formData.append('schedule', JSON.stringify(form.schedule));
      if (form.avatarFile) formData.append('avatar', form.avatarFile);

      const res = await api.put('/lawyer/profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Update avatar in Redux store if it changed
      if (res.data.user?.avatar) {
        dispatch(updateProfile({ avatar: res.data.user.avatar }));
      }

      toast.success(t('lawyerPanel.profileSaved'));
      navigate('/lawyer/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || t('lawyerPanel.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <GlassShell active="/lawyer/profile/edit" title={t('lawyerPanel.profileTitle')} subtitle={t('lawyerPanel.profileSub')} role="lawyer">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
          <CircularProgress sx={{ color: 'var(--accent)' }} />
        </div>
      </GlassShell>
    );
  }

  const expLabel = form.experience === 0 ? t('lawyerPanel.noExperience') : `${form.experience} ${t('lawyerPanel.expYears')}`;

  return (
    <GlassShell active="/lawyer/profile/edit" title={t('lawyerPanel.profileTitle')} subtitle={t('lawyerPanel.profileSub')} role="lawyer">
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {error && (
          <div style={{ ...glassCard, padding: '14px 18px', color: 'var(--error)', border: '1px solid var(--error)', fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Photo */}
        <div style={{ ...glassCard, padding: 26, display: 'flex', alignItems: 'center', gap: 22 }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: '50%',
              background: form.avatarPreview ? `center/cover no-repeat url(${form.avatarPreview})` : 'linear-gradient(135deg, #B8956E, #8B7355)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: 30,
              fontWeight: 300,
              flexShrink: 0,
            }}
          >
            {!form.avatarPreview && initialsOf(user?.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)' }}>{user?.name || t('lawyerPanel.lawyerFallback')}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>
              {[form.specialization, form.location].filter(Boolean).join(' · ') || t('lawyerPanel.fillProfile')}
            </div>
          </div>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: '1px solid var(--accent)',
              color: 'var(--text)',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '11px 20px',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <PhotoCameraOutlined sx={{ fontSize: 17 }} /> {t('lawyerPanel.changePhoto')}
            <input hidden type="file" accept="image/*" onChange={handleAvatarChange} />
          </label>
        </div>

        {/* Main info */}
        <div style={{ ...glassCard, padding: 26 }}>
          <div style={cardHeading}>{t('lawyerPanel.mainInfo')}</div>

          <div style={fieldLabel}>{t('lawyerPanel.about')}</div>
          <TextField
            fullWidth
            multiline
            minRows={3}
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            placeholder={t('lawyerPanel.aboutPlaceholder')}
            helperText={t('lawyerPanel.charsHelper', { n: form.description.length })}
            inputProps={{ maxLength: 500 }}
            sx={{ mb: 2.5, ...inputSx }}
          />

          {/* Автоприветствие в чате */}
          <div style={fieldLabel}>{t('lawyerPanel.greeting')}</div>
          <TextField
            fullWidth
            multiline
            minRows={2}
            value={form.greeting}
            onChange={(e) => handleChange('greeting', e.target.value)}
            placeholder={t('lawyerPanel.greetingPlaceholder')}
            helperText={t('lawyerPanel.greetingHelper')}
            inputProps={{ maxLength: 1000 }}
            sx={{ mb: 2.5, ...inputSx }}
          />

          <div style={{ display: 'flex', gap: 18, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>{t('lawyerPanel.city')}</div>
              <TextField
                fullWidth
                size="small"
                value={form.location}
                onChange={(e) => handleChange('location', e.target.value)}
                sx={inputSx}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>{t('lawyerPanel.priceSum')}</div>
              <TextField
                fullWidth
                size="small"
                type="number"
                value={form.price}
                onChange={(e) => handleChange('price', Number(e.target.value))}
                inputProps={{ min: 50000, step: 10000 }}
                sx={inputSx}
              />
            </div>
          </div>

          <div style={{ ...fieldLabel, marginBottom: 4 }}>{t('lawyerPanel.experienceLabel')}: {expLabel}</div>
          <div style={{ padding: '0 4px', marginBottom: 20 }}>
            <Slider
              value={form.experience}
              onChange={(_, v) => handleChange('experience', v)}
              min={0}
              max={40}
              step={1}
              marks={[{ value: 0, label: '0' }, { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 40, label: '40+' }]}
              sx={{
                color: 'var(--accent)',
                '& .MuiSlider-markLabel': { color: 'var(--text3)', fontSize: 11 },
                '& .MuiSlider-rail': { color: 'var(--border-strong)' },
              }}
            />
          </div>

          <div style={{ ...fieldLabel, marginBottom: 10 }}>{t('lawyerPanel.specialization')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {SPECIALIZATIONS.map((spec) => {
              const selected = form.specialization === spec;
              return (
                <Chip
                  key={spec}
                  label={specLabel(t, spec)}
                  icon={<GavelOutlined sx={{ fontSize: 14, color: selected ? '#fff !important' : 'var(--accent) !important' }} />}
                  onClick={() => handleChange('specialization', selected ? '' : spec)}
                  sx={{
                    borderRadius: 'var(--radius)',
                    fontFamily: 'inherit',
                    background: selected ? 'var(--accent)' : 'var(--canvas)',
                    color: selected ? '#fff' : 'var(--text2)',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                    '&:hover': { background: selected ? 'var(--accent-dark)' : 'var(--border)' },
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Schedule */}
        <div style={{ ...glassCard, padding: 26 }}>
          <div style={cardHeading}>{t('lawyerPanel.schedule')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {DAY_KEYS.map((key, idx) => {
              const active = !!form.schedule[key]?.enabled;
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <Chip
                    label={DAYS[idx]}
                    onClick={() => toggleDay(key)}
                    size="small"
                    sx={{
                      width: 52,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      fontFamily: 'inherit',
                      background: active ? 'var(--accent)' : 'var(--canvas)',
                      color: active ? '#fff' : 'var(--text2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      '&:hover': { background: active ? 'var(--accent-dark)' : 'var(--border)' },
                    }}
                  />
                  {active && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <TextField
                        type="time"
                        size="small"
                        value={form.schedule[key]?.from || '09:00'}
                        onChange={(e) => updateTime(key, 'from', e.target.value)}
                        sx={timeSx}
                      />
                      <span style={{ color: 'var(--text3)' }}>—</span>
                      <TextField
                        type="time"
                        size="small"
                        value={form.schedule[key]?.to || '18:00'}
                        onChange={(e) => updateTime(key, 'to', e.target.value)}
                        sx={timeSx}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
            color: '#FFFFFF',
            border: 'none',
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            padding: '14px 32px',
            borderRadius: 'var(--radius)',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.7 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <SaveOutlined sx={{ fontSize: 18 }} />}
          {saving ? t('lawyerPanel.savingProfile') : t('lawyerPanel.saveChanges')}
        </button>
      </div>
    </GlassShell>
  );
};

export default LawyerProfileEditPage;
