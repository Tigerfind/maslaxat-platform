import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '@mui/material';
import { toast } from 'react-toastify';
import api from '../../services/api';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';
import { SPECIALIZATION_NAMES } from '../../constants/specializations';
import { specLabel } from '../../utils/specLabel';
import { MIN_WEEKLY_SLOTS, countWeeklySlots } from '../../utils/schedulePolicy';
import EmailVerificationBanner from '../Auth/EmailVerificationBanner';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const emptyExperience = { organization: '', position: '', startDate: '', endDate: '', isCurrent: false, description: '' };
const emptyEducation = { university: '', faculty: '', specialty: '', degree: '', startYear: '', endYear: '', country: '', city: '' };
const emptyCertificate = { title: '', organization: '', issuedAt: '', credentialUrl: '' };
const field = { width: '100%', minHeight: 44, padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 16 };
const btnPrimary = { minHeight: 44, padding: '0 22px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))' };
const btnGhost = { minHeight: 44, padding: '0 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)' };
const card = { background: 'var(--card-glass)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', padding: 18 };

// Поле с подписью. Раньше подписи не было вовсе: имя поля подставлялось как
// placeholder, и юрист видел в интерфейсе служебные слова вроде credentialUrl
// или university. Подпись должна быть видна и когда поле уже заполнено.
const Labeled = ({ label, hint, required, children }) => (
  <label style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 500 }}>
      {label}
      {required && <span style={{ color: 'var(--accent-dark)' }}> *</span>}
    </span>
    {children}
    {hint && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{hint}</span>}
  </label>
);

// Системная кнопка «Выбор файлов» выглядела инородно рядом с остальным сайтом.
const FilePicker = ({ label, accept, multiple, onFiles, buttonText }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
    <label style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44,
      padding: '0 18px', borderRadius: 10, cursor: 'pointer', width: 'fit-content',
      border: '1px solid var(--accent)', color: 'var(--accent-dark)', background: 'transparent',
      fontSize: 13.5, fontWeight: 600,
    }} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.currentTarget.querySelector('input')?.click();
      }
    }}>
      {buttonText}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); }}
        style={{ display: 'none' }}
      />
    </label>
  </div>
);

const OnboardingWizard = ({ onComplete }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [docs, setDocs] = useState([]);
  const [docType, setDocType] = useState('license');
  const hydrated = useRef(false);
  const saveSequence = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const skipNextAutosave = useRef(false);
  const [data, setData] = useState({
    name: '', email: '', phone: '', avatar: '', professionalTitle: '', description: '',
    location: '', region: '', languages: ['ru', 'uz'], linkedinUrl: '', specializations: [],
    licenseNumber: '', licenseIssuer: '', licenseIssuedAt: '', licenseExpiresAt: '',
    experience: 0, price: 100000, consultationFormats: ['chat', 'webrtc'],
    consultationDurations: [30, 60], timezone: 'Asia/Tashkent', schedule: {},
    experiences: [], educations: [], certificates: [],
  });

  useEffect(() => {
    Promise.all([api.get('/lawyer/profile'), lawyerService.verification.getDocuments()])
      .then(([profileResponse, documentResponse]) => {
        const { user, profile, experiences, educations, certificates } = profileResponse.data;
        skipNextAutosave.current = true;
        setData((current) => ({
          ...current, ...profile, name: user?.name || '', email: user?.email || '', phone: user?.phone || '', avatar: user?.avatar || '',
          experiences: experiences || [], educations: educations || [], certificates: certificates || [],
          licenseIssuedAt: profile?.licenseIssuedAt || '', licenseExpiresAt: profile?.licenseExpiresAt || '',
        }));
        setStep(Math.min(5, Number(profile?.onboardingStep || 0)));
        setDocs(documentResponse.documents || []);
        hydrated.current = true;
      })
      .catch(() => toast.error(t('onboarding.saveError')))
      .finally(() => setLoading(false));
  }, [t]);

  const saveDraft = (nextStep = step) => {
    const sequence = ++saveSequence.current;
    const payload = { ...data, step: nextStep };
    delete payload.avatar;
    delete payload.email;
    setSaving(true);
    const save = async () => {
      try {
        const { data: response } = await api.patch('/lawyer/profile/draft', payload);
        if (sequence === saveSequence.current) setSavedAt(response.savedAt);
        return true;
      } catch (error) {
        toast.error(error.response?.data?.error || t('onboarding.saveError'));
        return false;
      } finally {
        if (sequence === saveSequence.current) setSaving(false);
      }
    };
    const queued = saveQueue.current.catch(() => false).then(save);
    saveQueue.current = queued;
    return queued;
  };

  useEffect(() => {
    if (!hydrated.current) return undefined;
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return undefined; }
    const timer = setTimeout(() => saveDraft(step), 700);
    return () => clearTimeout(timer);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (name, value) => setData((current) => ({ ...current, [name]: value }));
  const updateRow = (name, index, value) => setData((current) => ({
    ...current,
    [name]: current[name].map((row, rowIndex) => (rowIndex === index ? { ...row, ...value } : row)),
  }));
  const removeRow = (name, index) => setData((current) => ({ ...current, [name]: current[name].filter((_, rowIndex) => rowIndex !== index) }));

  const uploadAvatar = async (file) => {
    try {
      const form = new FormData(); form.append('avatar', file);
      const { data: response } = await api.put('/lawyer/profile', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      update('avatar', response.user?.avatar || '');
    } catch (error) {
      toast.error(error.response?.data?.error || t('onboarding.saveError'));
    }
  };
  const uploadDocument = async (file) => {
    try {
      const response = await lawyerService.verification.uploadDocument(file, docType);
      setDocs((current) => [response.document, ...current]);
    } catch (error) {
      toast.error(error.response?.data?.error || t('onboarding.saveError'));
    }
  };

  const next = async () => {
    if (await saveDraft(Math.min(5, step + 1))) setStep((current) => Math.min(5, current + 1));
  };
  const submit = async () => {
    if (!(await saveDraft(5))) return;
    try {
      await lawyerService.verification.submitForReview();
      toast.success(t('onboarding.submittedHint'));
      onComplete();
    } catch (error) {
      toast.error(error.response?.data?.error || t('onboarding.saveError'));
    }
  };

  if (loading) return <div style={{ padding: 40 }}>{t('common.loading')}</div>;
  const steps = [
    t('onboarding.profile'), t('onboarding.specialization'), t('onboarding.experience'),
    t('lawyerProfile.education'), t('lawyerProfile.achievements'), t('lawyerProfile.headerTitle'),
  ];
  const weeklySlots = countWeeklySlots(data.schedule);

  return (
    <Dialog
      open
      fullScreen
      disableEscapeKeyDown
      aria-labelledby="lawyer-onboarding-title"
      PaperProps={{ sx: { background: 'var(--canvas)', backgroundImage: 'none', color: 'var(--text)' } }}
    >
      <EmailVerificationBanner />
      <div className="onboarding-scroll" style={{ minHeight: '100dvh', overflowY: 'auto', padding: 'max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(80px, calc(24px + env(safe-area-inset-bottom))) max(16px, env(safe-area-inset-left))' }}>
      <div style={{ maxWidth: 900, minWidth: 0, margin: '0 auto' }}>
        <h1 id="lawyer-onboarding-title" style={{ fontWeight: 400 }}>{t('onboarding.title')}</h1>
        <div role="tablist" aria-label={t('onboarding.title')} style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 24, paddingBottom: 4 }}>
          {steps.map((title, index) => <button key={title} type="button" role="tab" aria-selected={index === step} onClick={() => setStep(index)} style={{ minHeight: 44, padding: '8px 14px', whiteSpace: 'nowrap', borderRadius: 999, border: '1px solid var(--border)', background: index === step ? 'var(--accent)' : 'var(--surface)', color: index === step ? '#fff' : 'var(--text2)' }}>{index + 1}. {title}</button>)}
        </div>

        {step === 0 && <div style={{ ...card, display: 'grid', gap: 14 }}>
          <Labeled label={t('onboarding.lblName')} required>
            <input style={field} value={data.name} onChange={(e) => update('name', e.target.value)} />
          </Labeled>
          <Labeled label={t('onboarding.lblTitle')} hint={t('onboarding.lblTitleHint')} required>
            <input style={field} value={data.professionalTitle || ''} onChange={(e) => update('professionalTitle', e.target.value)} />
          </Labeled>
          <Labeled label={t('onboarding.lblAbout')} hint={t('onboarding.minChars')} required>
            <textarea style={{ ...field, minHeight: 120 }} value={data.description || ''} onChange={(e) => update('description', e.target.value)} placeholder={t('onboarding.aboutPlaceholder')} />
          </Labeled>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <Labeled label={t('onboarding.lblCity')} required>
              <input style={field} value={data.location || ''} onChange={(e) => update('location', e.target.value)} placeholder={t('onboarding.cityPlaceholder')} />
            </Labeled>
            <Labeled label={t('onboarding.lblRegion')}>
              <input style={field} value={data.region || ''} onChange={(e) => update('region', e.target.value)} />
            </Labeled>
            <Labeled label={t('onboarding.lblPhone')} required>
              <input style={field} value={data.phone || ''} onChange={(e) => update('phone', e.target.value)} placeholder="+998 90 123 45 67" />
            </Labeled>
            <Labeled label={t('onboarding.lblEmail')}>
              <input style={{ ...field, opacity: 0.7 }} value={data.email || ''} readOnly />
            </Labeled>
          </div>
          <Labeled label={t('onboarding.lblLinkedin')}>
            <input style={field} value={data.linkedinUrl || ''} onChange={(e) => update('linkedinUrl', e.target.value)} placeholder="https://www.linkedin.com/in/..." />
          </Labeled>
          <FilePicker
            label={t('onboarding.lblPhoto')}
            buttonText={t('onboarding.uploadPhoto')}
            accept="image/*"
            onFiles={(files) => uploadAvatar(files[0])}
          />
        </div>}

        {step === 1 && <div style={{ ...card, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{SPECIALIZATION_NAMES.map((spec) => <button type="button" key={spec} onClick={() => update('specializations', data.specializations.includes(spec) ? data.specializations.filter((item) => item !== spec) : [...data.specializations, spec])} style={{ minHeight: 44, borderRadius: 999, border: '1px solid var(--border)', background: data.specializations.includes(spec) ? 'var(--accent)' : 'var(--surface)', color: data.specializations.includes(spec) ? '#fff' : 'var(--text)' }}>{specLabel(t, spec)}</button>)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <Labeled label={t('onboarding.lblLicenseNo')} required>
              <input style={field} value={data.licenseNumber || ''} onChange={(e) => update('licenseNumber', e.target.value)} />
            </Labeled>
            <Labeled label={t('onboarding.lblLicenseIssuer')}>
              <input style={field} value={data.licenseIssuer || ''} onChange={(e) => update('licenseIssuer', e.target.value)} />
            </Labeled>
            <Labeled label={t('onboarding.lblLicenseFrom')}>
              <input style={field} type="date" value={data.licenseIssuedAt || ''} onChange={(e) => update('licenseIssuedAt', e.target.value)} />
            </Labeled>
            <Labeled label={t('onboarding.lblLicenseTo')}>
              <input style={field} type="date" value={data.licenseExpiresAt || ''} onChange={(e) => update('licenseExpiresAt', e.target.value)} />
            </Labeled>
            <Labeled label={t('onboarding.lblExperienceYears')} required>
              <input style={field} type="number" min="0" max="80" value={data.experience} onChange={(e) => update('experience', Number(e.target.value))} />
            </Labeled>
            <Labeled label={t('onboarding.lblPrice')} required>
              <input style={field} type="number" min="0" value={data.price} onChange={(e) => update('price', Number(e.target.value))} />
            </Labeled>
            <Labeled label={t('onboarding.lblLanguages')} hint="ru, uz, en">
              <input style={field} value={(data.languages || []).join(', ')} onChange={(e) => update('languages', e.target.value.split(',').map((value) => value.trim()).filter(Boolean))} />
            </Labeled>
            <Labeled label={t('onboarding.lblTimezone')}>
              <input style={field} value={data.timezone || ''} onChange={(e) => update('timezone', e.target.value)} placeholder="Asia/Tashkent" />
            </Labeled>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 500 }}>{t('onboarding.lblFormats')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { v: 'chat', label: t('lawyers.fmtChat') },
                { v: 'audio', label: t('lawyers.fmtAudio') },
                { v: 'webrtc', label: t('lawyers.fmtVideo') },
                { v: 'zoom', label: t('lawyers.fmtZoom') },
              ].map(({ v, label }) => {
                const on = data.consultationFormats.includes(v);
                return (
                  <button
                    type="button"
                    key={v}
                    onClick={() => update('consultationFormats', on ? data.consultationFormats.filter((item) => item !== v) : [...data.consultationFormats, v])}
                    aria-pressed={on}
                    style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--text2)' }}
                  >{label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 500 }}>{t('onboarding.lblDurations')}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[30, 60, 90].map((duration) => {
                const on = data.consultationDurations.includes(duration);
                return (
                  <button
                    type="button"
                    key={duration}
                    onClick={() => update('consultationDurations', on ? data.consultationDurations.filter((item) => item !== duration) : [...data.consultationDurations, duration])}
                    aria-pressed={on}
                    style={{ minHeight: 44, padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--text2)' }}
                  >{duration} {t('lawyers.perMin').replace('{n}', '').replace('за', '').trim() || 'мин'}</button>
                );
              })}
            </div>
          </div>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: weeklySlots >= MIN_WEEKLY_SLOTS ? 'rgba(122,154,107,0.12)' : 'rgba(196,163,90,0.14)', color: 'var(--text2)' }}>
            {t('onboarding.scheduleProgress', { count: weeklySlots, required: MIN_WEEKLY_SLOTS })}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>{DAYS.map((day) => <div key={day} className="onboarding-schedule-row" style={{ display: 'grid', gridTemplateColumns: '100px minmax(0, 1fr) minmax(0, 1fr)', gap: 8, alignItems: 'center' }}><label style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={Boolean(data.schedule?.[day]?.enabled)} onChange={(e) => update('schedule', { ...data.schedule, [day]: { enabled: e.target.checked, from: data.schedule?.[day]?.from || '09:00', to: data.schedule?.[day]?.to || '18:00' } })} /> {day}</label><input aria-label={`${day} ${t('onboarding.lblFrom')}`} style={field} type="time" value={data.schedule?.[day]?.from || '09:00'} onChange={(e) => update('schedule', { ...data.schedule, [day]: { ...(data.schedule?.[day] || {}), enabled: true, from: e.target.value, to: data.schedule?.[day]?.to || '18:00' } })} /><input aria-label={`${day} ${t('onboarding.lblTo')}`} style={field} type="time" value={data.schedule?.[day]?.to || '18:00'} onChange={(e) => update('schedule', { ...data.schedule, [day]: { ...(data.schedule?.[day] || {}), enabled: true, from: data.schedule?.[day]?.from || '09:00', to: e.target.value } })} /></div>)}</div>
        </div>}

        {step === 2 && <Repeatable title={t('onboarding.experience')} rows={data.experiences} empty={emptyExperience} add={() => update('experiences', [...data.experiences, emptyExperience])} remove={(index) => removeRow('experiences', index)} render={(row, index) => <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <Labeled label={t('onboarding.lblOrg')}>
              <input style={field} value={row.organization} onChange={(e) => updateRow('experiences', index, { organization: e.target.value })} />
            </Labeled>
            <Labeled label={t('onboarding.lblPosition')}>
              <input style={field} value={row.position} onChange={(e) => updateRow('experiences', index, { position: e.target.value })} />
            </Labeled>
            <Labeled label={t('onboarding.lblFrom')}>
              <input style={field} type="date" value={row.startDate || ''} onChange={(e) => updateRow('experiences', index, { startDate: e.target.value })} />
            </Labeled>
            <Labeled label={t('onboarding.lblTo')}>
              <input style={field} type="date" disabled={row.isCurrent} value={row.endDate || ''} onChange={(e) => updateRow('experiences', index, { endDate: e.target.value })} />
            </Labeled>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--text2)' }}>
            <input type="checkbox" checked={row.isCurrent} onChange={(e) => updateRow('experiences', index, { isCurrent: e.target.checked, endDate: '' })} />
            {t('onboarding.lblCurrent')}
          </label>
          <Labeled label={t('onboarding.lblDuties')}>
            <textarea style={{ ...field, minHeight: 80 }} value={row.description || ''} onChange={(e) => updateRow('experiences', index, { description: e.target.value })} />
          </Labeled>
        </div>} />}
        {step === 3 && <Repeatable title={t('lawyerProfile.education')} rows={data.educations} empty={emptyEducation} add={() => update('educations', [...data.educations, emptyEducation])} remove={(index) => removeRow('educations', index)} render={(row, index) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          {[
            { key: 'university', label: t('onboarding.lblUniversity') },
            { key: 'faculty', label: t('onboarding.lblFaculty') },
            { key: 'specialty', label: t('onboarding.lblSpecialty') },
            { key: 'degree', label: t('onboarding.lblDegree') },
            { key: 'startYear', label: t('onboarding.lblYearFrom') },
            { key: 'endYear', label: t('onboarding.lblYearTo') },
            { key: 'country', label: t('onboarding.lblCountry') },
            { key: 'city', label: t('onboarding.lblCityEdu') },
          ].map(({ key, label }) => (
            <Labeled key={key} label={label}>
              <input
                style={field}
                type={key.includes('Year') ? 'number' : 'text'}
                value={row[key] || ''}
                onChange={(e) => updateRow('educations', index, { [key]: key.includes('Year') ? Number(e.target.value) : e.target.value })}
              />
            </Labeled>
          ))}
        </div>} />}
        {step === 4 && <div style={{ display: 'grid', gap: 16 }}><Repeatable title={t('lawyerProfile.achievements')} rows={data.certificates} empty={emptyCertificate} add={() => update('certificates', [...data.certificates, emptyCertificate])} remove={(index) => removeRow('certificates', index)} render={(row, index) => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
          {[
            { key: 'title', label: t('onboarding.lblCertTitle') },
            { key: 'organization', label: t('onboarding.lblCertOrg') },
            { key: 'issuedAt', label: t('onboarding.lblCertDate'), type: 'date' },
            { key: 'credentialUrl', label: t('onboarding.lblCertUrl') },
          ].map(({ key, label, type }) => (
            <Labeled key={key} label={label}>
              <input style={field} type={type || 'text'} value={row[key] || ''} onChange={(e) => updateRow('certificates', index, { [key]: e.target.value })} />
            </Labeled>
          ))}
        </div>} /><div style={{ ...card, display: 'grid', gap: 14 }}>
          <Labeled label={t('onboarding.lblDocType')} required>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} style={field}>
              <option value="license">{t('adminManage.docLicense')}</option>
              <option value="diploma">{t('adminManage.docDiploma')}</option>
              <option value="certificate">{t('lawyerProfile.achievements')}</option>
              <option value="id">{t('adminManage.docId')}</option>
            </select>
          </Labeled>
          <FilePicker
            label={t('onboarding.lblDocFile')}
            buttonText={t('onboarding.chooseFile')}
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            multiple
            onFiles={(files) => Promise.all(files.map(uploadDocument))
              .then(() => lawyerService.verification.getDocuments())
              .then((response) => setDocs(response.documents || []))}
          />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)' }}>{t('onboarding.uploadedDocs')}: {docs.length}</p>
        </div></div>}
        {step === 5 && <div style={{ ...card, display: 'grid', gap: 12 }}><h2>{data.name}</h2><strong>{data.professionalTitle}</strong><p>{data.description}</p><p>{data.specializations.join(' · ')}</p><p>{data.location}{data.region ? `, ${data.region}` : ''} · {data.languages.join(', ')}</p><p>{Number(data.price).toLocaleString()} сум · {data.experience} лет</p><h3>Опыт</h3>{data.experiences.map((item) => <p key={`${item.organization}-${item.position}`}>{item.position} — {item.organization}</p>)}<h3>Образование</h3>{data.educations.map((item) => <p key={`${item.university}-${item.specialty}`}>{item.university}, {item.specialty}</p>)}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} style={btnGhost}>{t('onboarding.back')}</button>}
          <button type="button" disabled={saving} onClick={() => saveDraft(step)} style={btnGhost}>{saving ? t('onboarding.saving') : t('common.save')}</button>
          {step < 5
            ? <button type="button" onClick={next} style={btnPrimary}>{t('onboarding.next')}</button>
            : <button type="button" onClick={submit} style={btnPrimary}>{t('onboarding.publish')}</button>}
          {savedAt && <span style={{ color: 'var(--text3)', fontSize: 12.5 }}>{t('onboarding.savedToast')} · {new Date(savedAt).toLocaleTimeString()}</span>}
        </div>
      </div>
      </div>
      <style>{`@media(max-width:520px){.onboarding-scroll{padding-left:12px !important;padding-right:12px !important}.onboarding-schedule-row{grid-template-columns:1fr !important}.onboarding-schedule-row>label{grid-column:1}.onboarding-schedule-row>input{width:100%}}`}</style>
    </Dialog>
  );
};

const Repeatable = ({ title, rows, add, remove, render }) => (
  <div style={{ display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: 0 }}>{title}</h2><button type="button" onClick={add} style={btnGhost}>+ Добавить</button></div>
    {rows.map((row, index) => <div key={index} style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,190px),1fr))', gap: 10 }}>{render(row, index)}<button type="button" onClick={() => remove(index)} style={{ ...btnGhost, justifySelf: 'start' }}>Удалить</button></div>)}
    {!rows.length && <div style={card}>Раздел пока не заполнен</div>}
  </div>
);

export default OnboardingWizard;
