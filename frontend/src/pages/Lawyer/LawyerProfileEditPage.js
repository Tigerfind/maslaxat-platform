import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Slider, Chip, TextField, CircularProgress } from '@mui/material';
import {
  PhotoCameraOutlined,
  GavelOutlined,
  SaveOutlined,
  CheckRounded,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import lawyerService from '../../services/lawyerService';
import { updateProfile } from '../../store/slices/authSlice';
import GlassShell from '../../components/GlassKit/GlassShell';
import VerificationDocuments from '../../components/Lawyer/VerificationDocuments';
import { useTranslation } from '../../i18n';
import { specLabel } from '../../utils/specLabel';
import { SPECIALIZATION_NAMES } from '../../constants/specializations';
import LinkedInPdfImport from '../../components/Lawyer/LinkedInPdfImport';
import ProfileImportReview from '../../components/Lawyer/ProfileImportReview';
import { mergeProfileIntoForm, replaceObjectUrl, revokeObjectUrl } from '../../utils/profileImportUtils';

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

// Единый справочник специализаций (тот же, что в брони и онбординге).
const SPECIALIZATIONS = SPECIALIZATION_NAMES;

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
  const [verificationStatus, setVerificationStatus] = useState('pending');
  const [meta, setMeta] = useState({ rating: 0, cases: 0 }); // для мини-статистики шапки
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [importRecord, setImportRecord] = useState(null);
  const [importResetEpoch, setImportResetEpoch] = useState(0);
  const manualRef = useRef(null);
  const avatarObjectUrl = useRef(null);

  const [form, setForm] = useState({
    profileRevision: 1,
    headline: '',
    description: '',
    greeting: '',
    experience: 0,
    price: 200000,
    location: 'Ташкент',
    specialization: '',
    specializations: [],
    schedule: {},
    workExperience: [],
    education: [],
    certificates: [],
    languages: [],
    linkedinUrl: '',
    avatarFile: null,
    avatarPreview: null,
  });

  // Load current profile
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/lawyer/profile');
        const p = res.data.profile || {};
        setProfileSnapshot(p);
        setForm((previous) => ({
          ...mergeProfileIntoForm(previous, p),
          avatarPreview: previous.avatarFile ? previous.avatarPreview : (res.data.user?.avatar || previous.avatarPreview),
        }));
        setVerificationStatus(p.verificationStatus || 'pending');
        setMeta({ rating: p.rating || 0, cases: p.completedCases || 0 });
      } catch {
        setError(t('lawyerPanel.loadProfileError'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => () => revokeObjectUrl(avatarObjectUrl.current), []);

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
      const preview = replaceObjectUrl(avatarObjectUrl.current, file);
      avatarObjectUrl.current = preview;
      setForm((previous) => ({ ...previous, avatarFile: file, avatarPreview: preview }));
    }
  };

  const mergeConfirmedProfile = async (confirmedProfile) => {
    let profile = confirmedProfile;
    let userData;
    if (!profile) {
      const response = await api.get('/lawyer/profile');
      profile = response.data.profile || {};
      userData = response.data.user;
    }
    setProfileSnapshot(profile);
    setForm((previous) => ({
      ...mergeProfileIntoForm(previous, profile),
      avatarPreview: previous.avatarFile ? previous.avatarPreview : (userData?.avatar || previous.avatarPreview),
    }));
    setImportRecord(null);
  };

  const handleSave = async () => {
    if (!form.description || form.description.length < 50) {
      toast.error(t('lawyerPanel.descMin'));
      return;
    }
    if (!form.specializations || form.specializations.length === 0) {
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
      formData.append('profileRevision', String(form.profileRevision));
      formData.append('headline', form.headline || '');
      formData.append('description', form.description);
      formData.append('greeting', form.greeting || '');
      formData.append('experience', String(form.experience));
      formData.append('specializations', JSON.stringify(form.specializations));
      formData.append('price', String(form.price));
      formData.append('location', form.location);
      formData.append('schedule', JSON.stringify(form.schedule));
      formData.append('workExperience', JSON.stringify(form.workExperience));
      formData.append('education', JSON.stringify(form.education));
      formData.append('certificates', JSON.stringify(form.certificates));
      formData.append('languages', JSON.stringify(form.languages));
      formData.append('linkedinUrl', form.linkedinUrl || '');
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

        <LinkedInPdfImport
          key={importResetEpoch}
          onImportReady={setImportRecord}
          onConfirmedRecovery={() => mergeConfirmedProfile()}
          onManual={() => manualRef.current?.focus()}
        />
        {importRecord?.status === 'draft' && profileSnapshot && <div style={{ ...glassCard, padding: 22 }}>
          <ProfileImportReview
            importRecord={importRecord}
            profile={profileSnapshot}
            onConfirmed={(confirmedProfile) => mergeConfirmedProfile(confirmedProfile)}
            onDiscarded={() => { setImportRecord(null); setImportResetEpoch((value) => value + 1); }}
            onConflict={async () => {
              const [importResult, profileResult] = await Promise.all([
                lawyerService.imports.get(importRecord.id),
                api.get('/lawyer/profile'),
              ]);
              const refreshed = profileResult.data.profile || {};
              setProfileSnapshot(refreshed);
              setForm((previous) => mergeProfileIntoForm(previous, refreshed));
              return { import: importResult.import, profile: refreshed };
            }}
          />
        </div>}

        {/* Photo — «Аврора-обложка» (вариант C) */}
        <div style={{ ...glassCard, padding: 0, overflow: 'hidden' }}>
          {/* Обложка: меш-градиент (аврора) + стеклянная кнопка «Сменить фото» */}
          <div style={{
            height: 120, position: 'relative',
            background: 'radial-gradient(60% 120% at 15% 20%, rgba(216,196,166,0.9), transparent 60%), radial-gradient(50% 120% at 85% 10%, rgba(122,154,107,0.5), transparent 60%), radial-gradient(80% 140% at 60% 120%, rgba(139,115,85,0.95), transparent 60%), linear-gradient(120deg, #B8956E, #8B7355)',
          }}>
            <label style={{
              position: 'absolute', right: 16, top: 16, display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 12, padding: '9px 14px',
              fontSize: 12, fontWeight: 600, letterSpacing: '0.03em', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <PhotoCameraOutlined sx={{ fontSize: 16 }} /> {t('lawyerPanel.changePhoto')}
              <input hidden type="file" accept="image/*" onChange={handleAvatarChange} />
            </label>
          </div>
          {/* Тело: квадратный аватар с наложением + имя + специализации + мини-статы */}
          <div style={{ padding: '0 26px 24px', marginTop: -46, position: 'relative' }}>
            <div style={{ position: 'relative', width: 96, height: 96 }}>
              <div style={{
                width: 96, height: 96, borderRadius: 26, border: '4px solid var(--surface)',
                background: form.avatarPreview ? `center/cover no-repeat url(${form.avatarPreview})` : 'linear-gradient(135deg, #B8956E, #8B7355)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 30, fontWeight: 300,
                boxShadow: '0 12px 26px rgba(0,0,0,0.22)',
              }}>
                {!form.avatarPreview && initialsOf(user?.name)}
              </div>
              {verificationStatus === 'approved' && (
                <div title={t('verification.approvedNote')} style={{ position: 'absolute', right: -6, bottom: -6, width: 30, height: 30, borderRadius: '50%', background: '#6E9A5F', border: '3px solid var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>
                  <CheckRounded sx={{ fontSize: 16 }} />
                </div>
              )}
            </div>
            <div style={{ fontSize: 21, fontWeight: 650, color: 'var(--text)', marginTop: 14, letterSpacing: '-0.01em' }}>{user?.name || t('lawyerPanel.lawyerFallback')}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 3 }}>
              {(form.specializations || []).map((s) => specLabel(t, s)).join(' · ') || t('lawyerPanel.fillProfile')}
            </div>
            {/* Мини-статистика */}
            <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', lineHeight: 1 }}>{Number(meta.rating) > 0 ? `${Number(meta.rating).toFixed(1)}★` : '—'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{t('lawyerPanel.rating')}</div>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', lineHeight: 1 }}>{meta.cases || 0}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{t('lawyerPanel.consultationsDone')}</div>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--text)', lineHeight: 1 }}>{form.location || '—'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{t('lawyerPanel.city')}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main info */}
        <div ref={manualRef} tabIndex={-1} style={{ ...glassCard, padding: 26 }}>
          <div style={cardHeading}>{t('lawyerPanel.mainInfo')}</div>

          <div style={fieldLabel}>{t('lawyerProfile.headline')}</div>
          <TextField fullWidth value={form.headline} onChange={(e) => handleChange('headline', e.target.value)} inputProps={{ maxLength: 300 }} sx={{ mb: 2.5, ...inputSx }} />

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

          <div style={fieldLabel}>{t('lawyerProfile.linkedin')}</div>
          <TextField fullWidth type="url" value={form.linkedinUrl} onChange={(e) => handleChange('linkedinUrl', e.target.value)} placeholder="https://www.linkedin.com/in/..." sx={{ mb: 2.5, ...inputSx }} />

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
              const selected = (form.specializations || []).includes(spec);
              const toggleSpec = () => {
                const cur = form.specializations || [];
                handleChange('specializations', cur.includes(spec) ? cur.filter((s) => s !== spec) : [...cur, spec]);
              };
              return (
                <Chip
                  key={spec}
                  label={specLabel(t, spec)}
                  icon={<GavelOutlined sx={{ fontSize: 14, color: selected ? '#fff !important' : 'var(--accent) !important' }} />}
                  onClick={toggleSpec}
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

        {/* Верификационные документы (диплом/лицензия/удостоверение) */}
        <VerificationDocuments initialStatus={verificationStatus} />

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
