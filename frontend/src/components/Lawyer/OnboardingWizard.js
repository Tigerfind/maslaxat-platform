import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../services/api';
import lawyerService from '../../services/lawyerService';
import { useTranslation } from '../../i18n';
import { SPECIALIZATION_NAMES } from '../../constants/specializations';
import { specLabel } from '../../utils/specLabel';
import { MIN_WEEKLY_SLOTS, countWeeklySlots } from '../../utils/schedulePolicy';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const emptyExperience = { organization: '', position: '', startDate: '', endDate: '', isCurrent: false, description: '' };
const emptyEducation = { university: '', faculty: '', specialty: '', degree: '', startYear: '', endYear: '', country: '', city: '' };
const emptyCertificate = { title: '', organization: '', issuedAt: '', credentialUrl: '' };
const field = { width: '100%', minHeight: 44, padding: '11px 13px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', boxSizing: 'border-box' };
const card = { background: 'var(--card-glass)', border: '1px solid var(--card-brd)', borderRadius: 'var(--radius)', padding: 18 };

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
    <div style={{ position: 'fixed', inset: 0, zIndex: 1400, overflowY: 'auto', background: 'var(--canvas)', color: 'var(--text)', padding: '24px 16px 80px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontWeight: 400 }}>{t('onboarding.title')}</h1>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 24 }}>
          {steps.map((title, index) => <button key={title} type="button" onClick={() => setStep(index)} style={{ minHeight: 44, padding: '8px 14px', whiteSpace: 'nowrap', borderRadius: 999, border: '1px solid var(--border)', background: index === step ? 'var(--accent)' : 'var(--surface)', color: index === step ? '#fff' : 'var(--text2)' }}>{index + 1}. {title}</button>)}
        </div>

        {step === 0 && <div style={{ ...card, display: 'grid', gap: 14 }}>
          <input style={field} value={data.name} onChange={(e) => update('name', e.target.value)} placeholder={t('register.fullName')} />
          <input style={field} value={data.professionalTitle || ''} onChange={(e) => update('professionalTitle', e.target.value)} placeholder="Адвокат по семейному праву" />
          <textarea style={{ ...field, minHeight: 120 }} value={data.description || ''} onChange={(e) => update('description', e.target.value)} placeholder={t('onboarding.aboutPlaceholder')} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <input style={field} value={data.location || ''} onChange={(e) => update('location', e.target.value)} placeholder={t('onboarding.city')} />
            <input style={field} value={data.region || ''} onChange={(e) => update('region', e.target.value)} placeholder="Регион" />
            <input style={field} value={data.phone || ''} onChange={(e) => update('phone', e.target.value)} placeholder="+998..." />
            <input style={field} value={data.email || ''} readOnly aria-label="Email" />
          </div>
          <input style={field} value={data.linkedinUrl || ''} onChange={(e) => update('linkedinUrl', e.target.value)} placeholder="https://www.linkedin.com/in/..." />
          <label><span>{t('onboarding.photoLabel')}</span><input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} /></label>
        </div>}

        {step === 1 && <div style={{ ...card, display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{SPECIALIZATION_NAMES.map((spec) => <button type="button" key={spec} onClick={() => update('specializations', data.specializations.includes(spec) ? data.specializations.filter((item) => item !== spec) : [...data.specializations, spec])} style={{ minHeight: 44, borderRadius: 999, border: '1px solid var(--border)', background: data.specializations.includes(spec) ? 'var(--accent)' : 'var(--surface)', color: data.specializations.includes(spec) ? '#fff' : 'var(--text)' }}>{specLabel(t, spec)}</button>)}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
            <input style={field} value={data.licenseNumber || ''} onChange={(e) => update('licenseNumber', e.target.value)} placeholder="Номер лицензии" />
            <input style={field} value={data.licenseIssuer || ''} onChange={(e) => update('licenseIssuer', e.target.value)} placeholder="Кем выдана" />
            <input style={field} type="date" value={data.licenseIssuedAt || ''} onChange={(e) => update('licenseIssuedAt', e.target.value)} />
            <input style={field} type="date" value={data.licenseExpiresAt || ''} onChange={(e) => update('licenseExpiresAt', e.target.value)} />
            <input style={field} type="number" min="0" max="80" value={data.experience} onChange={(e) => update('experience', Number(e.target.value))} placeholder={t('onboarding.experience')} />
            <input style={field} type="number" min="0" value={data.price} onChange={(e) => update('price', Number(e.target.value))} placeholder={t('lawyerProfile.priceLabel')} />
            <input style={field} value={(data.languages || []).join(', ')} onChange={(e) => update('languages', e.target.value.split(',').map((value) => value.trim()).filter(Boolean))} placeholder="ru, uz, en" />
            <input style={field} value={data.timezone || ''} onChange={(e) => update('timezone', e.target.value)} placeholder="Asia/Tashkent" />
          </div>
          <div>{['chat', 'audio', 'webrtc', 'zoom'].map((format) => <label key={format} style={{ marginRight: 16 }}><input type="checkbox" checked={data.consultationFormats.includes(format)} onChange={() => update('consultationFormats', data.consultationFormats.includes(format) ? data.consultationFormats.filter((item) => item !== format) : [...data.consultationFormats, format])} /> {format}</label>)}</div>
          <div>{[30, 60, 90].map((duration) => <label key={duration} style={{ marginRight: 16 }}><input type="checkbox" checked={data.consultationDurations.includes(duration)} onChange={() => update('consultationDurations', data.consultationDurations.includes(duration) ? data.consultationDurations.filter((item) => item !== duration) : [...data.consultationDurations, duration])} /> {duration} мин</label>)}</div>
          <div style={{ padding: '12px 14px', borderRadius: 10, background: weeklySlots >= MIN_WEEKLY_SLOTS ? 'rgba(122,154,107,0.12)' : 'rgba(196,163,90,0.14)', color: 'var(--text2)' }}>
            {t('onboarding.scheduleProgress', { count: weeklySlots, required: MIN_WEEKLY_SLOTS })}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>{DAYS.map((day) => <div key={day} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 1fr', gap: 8, alignItems: 'center' }}><label><input type="checkbox" checked={Boolean(data.schedule?.[day]?.enabled)} onChange={(e) => update('schedule', { ...data.schedule, [day]: { enabled: e.target.checked, from: data.schedule?.[day]?.from || '09:00', to: data.schedule?.[day]?.to || '18:00' } })} /> {day}</label><input style={field} type="time" value={data.schedule?.[day]?.from || '09:00'} onChange={(e) => update('schedule', { ...data.schedule, [day]: { ...(data.schedule?.[day] || {}), enabled: true, from: e.target.value, to: data.schedule?.[day]?.to || '18:00' } })} /><input style={field} type="time" value={data.schedule?.[day]?.to || '18:00'} onChange={(e) => update('schedule', { ...data.schedule, [day]: { ...(data.schedule?.[day] || {}), enabled: true, from: data.schedule?.[day]?.from || '09:00', to: e.target.value } })} /></div>)}</div>
        </div>}

        {step === 2 && <Repeatable title="Опыт работы" rows={data.experiences} empty={emptyExperience} add={() => update('experiences', [...data.experiences, emptyExperience])} remove={(index) => removeRow('experiences', index)} render={(row, index) => <><input style={field} value={row.organization} onChange={(e) => updateRow('experiences', index, { organization: e.target.value })} placeholder="Организация" /><input style={field} value={row.position} onChange={(e) => updateRow('experiences', index, { position: e.target.value })} placeholder="Должность" /><input style={field} type="date" value={row.startDate || ''} onChange={(e) => updateRow('experiences', index, { startDate: e.target.value })} /><input style={field} type="date" disabled={row.isCurrent} value={row.endDate || ''} onChange={(e) => updateRow('experiences', index, { endDate: e.target.value })} /><label><input type="checkbox" checked={row.isCurrent} onChange={(e) => updateRow('experiences', index, { isCurrent: e.target.checked, endDate: '' })} /> Работаю сейчас</label><textarea style={{ ...field, minHeight: 80 }} value={row.description || ''} onChange={(e) => updateRow('experiences', index, { description: e.target.value })} placeholder="Обязанности и достижения" /></>} />}
        {step === 3 && <Repeatable title="Образование" rows={data.educations} empty={emptyEducation} add={() => update('educations', [...data.educations, emptyEducation])} remove={(index) => removeRow('educations', index)} render={(row, index) => <>{['university', 'faculty', 'specialty', 'degree', 'startYear', 'endYear', 'country', 'city'].map((key) => <input key={key} style={field} type={key.includes('Year') ? 'number' : 'text'} value={row[key] || ''} onChange={(e) => updateRow('educations', index, { [key]: key.includes('Year') ? Number(e.target.value) : e.target.value })} placeholder={key} />)}</>} />}
        {step === 4 && <div style={{ display: 'grid', gap: 16 }}><Repeatable title="Сертификаты" rows={data.certificates} empty={emptyCertificate} add={() => update('certificates', [...data.certificates, emptyCertificate])} remove={(index) => removeRow('certificates', index)} render={(row, index) => <>{['title', 'organization', 'issuedAt', 'credentialUrl'].map((key) => <input key={key} style={field} type={key === 'issuedAt' ? 'date' : 'text'} value={row[key] || ''} onChange={(e) => updateRow('certificates', index, { [key]: e.target.value })} placeholder={key} />)}</>} /><div style={card}><select value={docType} onChange={(e) => setDocType(e.target.value)} style={field}><option value="license">Лицензия</option><option value="diploma">Диплом</option><option value="certificate">Сертификат</option><option value="id">Удостоверение</option></select><input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple onChange={(e) => Promise.all([...e.target.files].map(uploadDocument)).then(() => lawyerService.verification.getDocuments()).then((response) => setDocs(response.documents || []))} /><p>Загружено документов: {docs.length}</p></div></div>}
        {step === 5 && <div style={{ ...card, display: 'grid', gap: 12 }}><h2>{data.name}</h2><strong>{data.professionalTitle}</strong><p>{data.description}</p><p>{data.specializations.join(' · ')}</p><p>{data.location}{data.region ? `, ${data.region}` : ''} · {data.languages.join(', ')}</p><p>{Number(data.price).toLocaleString()} сум · {data.experience} лет</p><h3>Опыт</h3>{data.experiences.map((item) => <p key={`${item.organization}-${item.position}`}>{item.position} — {item.organization}</p>)}<h3>Образование</h3>{data.educations.map((item) => <p key={`${item.university}-${item.specialty}`}>{item.university}, {item.specialty}</p>)}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)}>{t('onboarding.back')}</button>}
          <button type="button" disabled={saving} onClick={() => saveDraft(step)}>{saving ? t('onboarding.saving') : 'Сохранить черновик'}</button>
          {step < 5 ? <button type="button" onClick={next}>{t('onboarding.next')}</button> : <button type="button" onClick={submit}>Отправить на проверку</button>}
          {savedAt && <span style={{ color: 'var(--text3)', alignSelf: 'center' }}>Сохранено {new Date(savedAt).toLocaleTimeString()}</span>}
        </div>
      </div>
    </div>
  );
};

const Repeatable = ({ title, rows, add, remove, render }) => (
  <div style={{ display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{title}</h2><button type="button" onClick={add}>+ Добавить</button></div>
    {rows.map((row, index) => <div key={index} style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>{render(row, index)}<button type="button" onClick={() => remove(index)}>Удалить</button></div>)}
    {!rows.length && <div style={card}>Раздел пока не заполнен</div>}
  </div>
);

export default OnboardingWizard;
