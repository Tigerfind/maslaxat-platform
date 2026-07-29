import React, { useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { useTranslation } from '../../i18n';
import { specLabel } from '../../utils/specLabel';

/*
  ─────────────────────────────────────────────────────────────
  LAWYER ONBOARDING WIZARD — fullscreen overlay
  Re-skinned 1:1 from ClaudeDesign → lawyer/_full.html "ONBOARDING WIZARD".
  Fullscreen dark overlay (does NOT use GlassShell). 4 steps:
    Профиль → Специализация → Расписание → Прайс.
  Keeps the original step validation + PUT /lawyer/profile (multipart) submit.
  Colours use glass.css vars (var(--accent) / var(--accent-dark)); the dark
  overlay surface is intentional and fixed (matches the mockup).
  ─────────────────────────────────────────────────────────────
*/

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const SPECIALIZATIONS = [
  'Гражданское право', 'Семейное право', 'Трудовое право',
  'Уголовное право', 'Коммерческое право', 'Налоговое право',
  'Административное право', 'Земельное право', 'Корпоративное право',
  'Интеллектуальная собственность',
];

// ── shared dark-overlay styles ────────────────────────────────
const label = {
  fontSize: 12, letterSpacing: '0.04em', color: 'rgba(255,255,255,0.5)', marginBottom: 8,
};
const inputStyle = {
  width: '100%', padding: '15px 16px', borderRadius: 'var(--radius)',
  border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)',
  fontSize: 15, color: '#FFFFFF', fontFamily: 'inherit', boxSizing: 'border-box',
};
const chipStyle = (selected) => ({
  padding: '10px 16px', borderRadius: 'var(--radius)', fontSize: 13, fontFamily: 'inherit',
  cursor: 'pointer', transition: 'all 0.2s',
  background: selected ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
  color: selected ? '#FFFFFF' : 'rgba(255,255,255,0.75)',
  border: `1px solid ${selected ? 'var(--accent)' : 'rgba(255,255,255,0.18)'}`,
});

const fmtSum = (n) => Number(n || 0).toLocaleString('ru-RU');

// ── Step 1: Photo + Description + Experience ──────────────────
const StepProfile = ({ data, onChange, t }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    <div>
      <div style={label}>{t('onboarding.photoLabel')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', overflow: 'hidden',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', fontSize: 22,
        }}>
          {data.avatarPreview
            ? <img src={data.avatarPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : '＋'}
        </div>
        <label style={{
          padding: '11px 20px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)',
          color: 'var(--accent)', fontSize: 13, fontWeight: 500, letterSpacing: '0.04em',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          {t('onboarding.uploadPhoto')}
          <input
            hidden type="file" accept="image/*"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) onChange('avatarFile', file, URL.createObjectURL(file));
            }}
          />
        </label>
      </div>
    </div>

    <div>
      <div style={label}>{t('onboarding.about')} <span style={{ color: 'var(--accent)' }}>*</span></div>
      <textarea
        rows={4}
        placeholder={t('onboarding.aboutPlaceholder')}
        value={data.description}
        onChange={(e) => onChange('description', e.target.value)}
        maxLength={500}
        style={{ ...inputStyle, resize: 'none' }}
      />
      <div style={{
        fontSize: 12, marginTop: 6,
        color: data.description.length > 0 && data.description.length < 50 ? 'var(--accent)' : 'rgba(255,255,255,0.4)',
      }}>
        {data.description.length > 0 && data.description.length < 50
          ? t('onboarding.minChars', { n: data.description.length })
          : `${data.description.length}/500`}
      </div>
    </div>

    <div>
      <div style={label}>{t('onboarding.experience')}: {data.experience === 0 ? t('onboarding.noExperience') : `${data.experience} ${t('onboarding.years')}`}</div>
      <input
        type="range" min={0} max={40} step={1}
        value={data.experience}
        onChange={(e) => onChange('experience', Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  </div>
);

// ── Step 2: Specialization (одиночный выбор) ──────────────────
// Бэкенд хранит ОДНУ специализацию (LawyerProfile.specialization — STRING), и по
// ней же фильтруется каталог. Раньше был мульти-выбор, но сохранялась только [0] —
// остальные молча терялись. Делаем честный одиночный выбор (радио-поведение).
const StepSpecializations = ({ data, onChange, t }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
    {SPECIALIZATIONS.map((spec) => {
      const selected = data.specializations[0] === spec;
      return (
        <button
          key={spec}
          onClick={() => onChange('specializations', [spec])}
          style={chipStyle(selected)}
        >
          {specLabel(t, spec)}
        </button>
      );
    })}
  </div>
);

// ── Step 3: Schedule ──────────────────────────────────────────
const StepSchedule = ({ data, onChange, times, setTimes, t }) => {
  const DAYS = t('onboarding.days');
  // Единый формат {enabled, from, to} (как в редакторе «Часы приёма»).
  const toggleDay = (key) => {
    const current = data.schedule[key];
    onChange('schedule', {
      ...data.schedule,
      [key]: current?.enabled
        ? { ...current, enabled: false }
        : { enabled: true, from: times.start, to: times.end },
    });
  };

  // field: 'from' | 'to' — общие часы применяются ко всем включённым дням.
  const applyTime = (field, value) => {
    setTimes((t) => ({ ...t, [field === 'from' ? 'start' : 'end']: value }));
    const next = { ...data.schedule };
    Object.keys(next).forEach((k) => {
      if (next[k]?.enabled) next[k] = { ...next[k], [field]: value };
    });
    onChange('schedule', next);
  };

  const activeCount = Object.values(data.schedule).filter((d) => d?.enabled).length;

  return (
    <div>
      <div style={label}>{t('onboarding.workDays')} {activeCount > 0 && <span style={{ color: 'var(--accent)' }}>· {t('onboarding.selected', { n: activeCount })}</span>}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {DAY_KEYS.map((key, idx) => (
          <button key={key} onClick={() => toggleDay(key)} style={{ ...chipStyle(!!data.schedule[key]?.enabled), minWidth: 52, textAlign: 'center' }}>
            {DAYS[idx]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 26 }}>
        <div style={{ flex: 1 }}>
          <div style={label}>{t('onboarding.start')}</div>
          <input type="time" value={times.start} onChange={(e) => applyTime('from', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={label}>{t('onboarding.end')}</div>
          <input type="time" value={times.end} onChange={(e) => applyTime('to', e.target.value)} style={inputStyle} />
        </div>
      </div>
    </div>
  );
};

// ── Step 4: Price + Location ──────────────────────────────────
const StepPrice = ({ data, onChange, t }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 'var(--radius)', padding: 32 }}>
      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ fontSize: 40, fontWeight: 200, color: 'var(--accent)' }}>{fmtSum(data.price)} {t('onboarding.sum')}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>{t('onboarding.perConsultation')}</div>
      </div>
      <input
        type="range" min={50000} max={500000} step={10000}
        value={data.price}
        onChange={(e) => onChange('price', Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 10 }}>
        <span>50 000 {t('onboarding.sum')}</span><span>500 000 {t('onboarding.sum')}</span>
      </div>
    </div>

    <div>
      <div style={label}>{t('onboarding.city')}</div>
      <input placeholder={t('onboarding.cityPlaceholder')} value={data.location} onChange={(e) => onChange('location', e.target.value)} style={inputStyle} />
    </div>
  </div>
);

// ── Main Wizard ───────────────────────────────────────────────
const OnboardingWizard = ({ onComplete }) => {
  const { t } = useTranslation();
  const STEPS = t('onboarding.steps');
  const STEP_META = t('onboarding.metaTitles').map((title, i) => ({ title, sub: t('onboarding.metaSubs')[i] }));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [times, setTimes] = useState({ start: '09:00', end: '18:00' });
  const [data, setData] = useState({
    description: '',
    experience: 3,
    avatarFile: null,
    avatarPreview: null,
    specializations: [],
    schedule: {},
    price: 200000,
    location: 'Ташкент',
  });

  const handleChange = (field, value, extra) => {
    setData((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'avatarFile' ? { avatarPreview: extra } : {}),
    }));
  };

  const canProceed = () => {
    if (step === 0) return data.description.length >= 50;
    if (step === 1) return data.specializations.length >= 1;
    if (step === 2) return Object.values(data.schedule).filter((d) => d?.enabled).length >= 3;
    if (step === 3) return data.price >= 50000;
    return false;
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('description', data.description);
      formData.append('experience', String(data.experience));
      formData.append('specialization', data.specializations[0]);
      formData.append('languages', JSON.stringify(['uz', 'ru']));
      formData.append('schedule', JSON.stringify(data.schedule));
      formData.append('price', String(data.price));
      formData.append('location', data.location);
      if (data.avatarFile) formData.append('avatar', data.avatarFile);

      await api.put('/lawyer/profile', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      toast.success(t('onboarding.savedToast'));
      onComplete();
    } catch (err) {
      toast.error(err.response?.data?.error || t('onboarding.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const meta = STEP_META[step];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 800,
      background: 'radial-gradient(circle at 25% 15%, #2D2820, #1A1A1A 60%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 620, display: 'flex', flexDirection: 'column', margin: 'auto' }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 34 }}>
          <div style={{
            width: 40, height: 40, border: '1.5px solid var(--accent)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 300, fontSize: 22,
          }}>M</div>
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#FFFFFF' }}>eMaslaXat</div>
            <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent)', marginTop: 3 }}>{t('onboarding.brandSub')}</div>
          </div>
        </div>

        {/* Numbered stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 38 }}>
          {STEPS.map((s, i) => {
            const done = i <= step;
            return (
              <React.Fragment key={s}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 500, transition: 'all 0.25s',
                  background: done ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                  color: done ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                }}>{i + 1}</div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, borderRadius: 1, background: i < step ? 'var(--accent)' : 'rgba(255,255,255,0.12)', transition: 'background 0.25s' }} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Title + subtitle */}
        <div style={{ fontSize: 30, fontWeight: 300, letterSpacing: '0.01em', color: '#FFFFFF', marginBottom: 8 }}>{meta.title}</div>
        <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.55)', marginBottom: 32 }}>{meta.sub}</div>

        {/* Step content */}
        <div style={{ minHeight: 220 }}>
          {step === 0 && <StepProfile data={data} onChange={handleChange} t={t} />}
          {step === 1 && <StepSpecializations data={data} onChange={handleChange} t={t} />}
          {step === 2 && <StepSchedule data={data} onChange={handleChange} times={times} setTimes={setTimes} t={t} />}
          {step === 3 && <StepPrice data={data} onChange={handleChange} t={t} />}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 38 }}>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{
                padding: '15px 28px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500, letterSpacing: '0.05em',
                textTransform: 'uppercase', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >{t('onboarding.back')}</button>
          )}
          <button
            onClick={() => (step < STEPS.length - 1 ? setStep((s) => s + 1) : handleFinish())}
            disabled={!canProceed() || saving}
            style={{
              flex: 1, padding: 16,
              background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
              border: 'none', color: '#FFFFFF', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', borderRadius: 'var(--radius)', fontFamily: 'inherit',
              cursor: (!canProceed() || saving) ? 'default' : 'pointer',
              opacity: (!canProceed() || saving) ? 0.5 : 1, transition: 'opacity 0.2s',
            }}
          >
            {step < STEPS.length - 1 ? t('onboarding.next') : (saving ? t('onboarding.saving') : t('onboarding.publish'))}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingWizard;
