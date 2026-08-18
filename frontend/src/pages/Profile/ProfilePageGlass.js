import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { PhotoCameraOutlined, HistoryOutlined } from '@mui/icons-material';
import { updateProfile, updateToken } from '../../store/slices/authSlice';
import api from '../../services/api';
import clientService from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';
import { useTranslation } from '../../i18n';

/*
  ─────────────────────────────────────────────────────────────
  CLIENT PROFILE  (/profile)
  Ported 1:1 from ClaudeDesign → client/11_MY_PROFILE.html.
  What it shows / how it works:
   • Header card: avatar (image or initials), name, email, chips «Активный / Клиент»
   • Tabs: Личная информация | Безопасность | История активности
   • Личная информация  → editable name/email/phone/address + avatar upload
                          Save → PUT /client/users/profile (multipart) → Redux updateProfile
   • Статистика аккаунта ← clientService.dashboard.getStats() (real BE fields)
   • Безопасность        → change password → PUT /client/users/password  (+ security tips)
   • История активности  → no real data source yet → inline empty state (no fabricated rows)
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

// Оформление событий ленты активности по типу
const ACT_META = {
  consultation: { dot: '⚖', color: 'var(--accent)', bg: 'rgba(184,149,110,0.14)' },
  document: { dot: '📄', color: '#6A8A9A', bg: 'rgba(106,138,154,0.14)' },
  review: { dot: '★', color: '#C4A35A', bg: 'rgba(196,163,90,0.16)' },
};

const fmtActDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const sectionTitle = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text)',
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontSize: 14,
  color: 'var(--text)',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
  outline: 'none',
};

const primaryBtn = {
  background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
  color: '#FFFFFF',
  border: 'none',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '14px 28px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const tabBtnStyle = (active) => ({
  padding: '10px 20px',
  borderRadius: 'var(--radius)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent)' : 'var(--card-glass)',
  backdropFilter: active ? 'none' : 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: active ? 'none' : 'blur(24px) saturate(180%)',
  color: active ? '#FFFFFF' : 'var(--text2)',
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.03em',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const initialsOf = (name = '') =>
  name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '—';

const TABS = ['tabPersonal', 'tabSecurity', 'tabActivity'];

const ProfilePageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const fileInputRef = useRef(null);

  const user = useSelector((state) => state.auth.user);

  const [activeTab, setActiveTab] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);

  // Подтверждение телефона (SMS-код) для залогиненного клиента.
  const [phoneInput, setPhoneInput] = useState(user?.phone || '');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSending, setOtpSending] = useState(false);
  const [otpConfirming, setOtpConfirming] = useState(false);
  const [devCode, setDevCode] = useState('');

  // Телефон-аккаунт с email-плейсхолдером → предлагаем привязать настоящий email.
  const isPhoneAccount = (user?.email || '').endsWith('@phone.maslaxat.uz');
  // Клиент без подтверждённого контакта — предлагаем подтвердить телефон (нужно для брони).
  const needsVerify = user?.role === 'client' && !user?.isVerified;

  const requestOtp = async () => {
    setOtpSending(true); setDevCode('');
    try {
      const res = await api.post('/auth/phone/request', { phone: phoneInput });
      setOtpSent(true);
      if (res.data?.devCode) setDevCode(res.data.devCode); // dev без Eskiz — код виден
      toast.success(t('profile.otpSent'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('profile.otpError'));
    } finally { setOtpSending(false); }
  };
  const confirmOtp = async () => {
    setOtpConfirming(true);
    try {
      const res = await api.post('/auth/phone/confirm', { phone: phoneInput, code: otpCode.trim() });
      if (res.data?.user) dispatch(updateProfile(res.data.user));
      setOtpSent(false); setOtpCode(''); setDevCode('');
      toast.success(t('profile.phoneVerified'));
    } catch (err) {
      toast.error(err.response?.data?.error || t('profile.otpError'));
    } finally { setOtpConfirming(false); }
  };

  // Personal info — seeded from real user, empty fallback (no placeholder mock)
  const [formData, setFormData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: user?.address || '',
    avatar: user?.avatar || null,
    avatarFile: null,
  });

  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    clientService.dashboard.getStats().then(setStats).catch(() => setStats(null));
  }, []);

  // Лента активности грузим при первом открытии вкладки «История»
  useEffect(() => {
    if (activeTab === 2 && !activityLoaded) {
      clientService.dashboard.getActivity()
        .then((a) => setActivity(Array.isArray(a) ? a : []))
        .finally(() => setActivityLoaded(true));
    }
  }, [activeTab, activityLoaded]);

  const resetForm = () => {
    setFormData({
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      address: user?.address || '',
      avatar: user?.avatar || null,
      avatarFile: null,
    });
  };

  const handleTabChange = (idx) => {
    setActiveTab(idx);
    setIsEditMode(false);
  };

  const handleEditToggle = () => {
    if (isEditMode) {
      resetForm();
      setIsEditMode(false);
      toast.info(t('profile.changesCancelled'));
    } else {
      setIsEditMode(true);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAvatarClick = () => {
    if (isEditMode) fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('profile.fileTooBig'));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({ ...prev, avatar: reader.result, avatarFile: file }));
      toast.success(t('profile.photoSelected'));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveChanges = async () => {
    if (!formData.name.trim()) {
      toast.error(t('profile.nameEmpty'));
      return;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      toast.error(t('profile.emailInvalid'));
      return;
    }
    try {
      const payload = new FormData();
      payload.append('name', formData.name);
      payload.append('phone', formData.phone || '');
      payload.append('address', formData.address || '');
      if (formData.avatarFile) payload.append('avatar', formData.avatarFile);

      const response = await api.put('/client/users/profile', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      dispatch(updateProfile(response.data.user));
      setIsEditMode(false);
      toast.success(t('profile.profileSaved'));
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error(error.response?.data?.error || t('profile.profileError'));
    }
  };

  const handlePasswordSubmit = async () => {
    if (!passwordData.oldPassword) {
      toast.error(t('profile.enterCurrentPassword'));
      return;
    }
    if (!passwordData.newPassword) {
      toast.error(t('profile.enterNewPassword'));
      return;
    }
    if (passwordData.newPassword.length < 6) {
      toast.error(t('profile.passwordTooShort'));
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error(t('profile.passwordsMismatch'));
      return;
    }
    try {
      const res = await api.put('/client/users/password', {
        oldPassword: passwordData.oldPassword,
        newPassword: passwordData.newPassword,
      });
      // Смена пароля инвалидирует старые токены (другие сессии выпадут). Сервер выдал
      // свежий токен для ТЕКУЩЕЙ сессии — сохраняем его, иначе следующий запрос → 401.
      if (res.data?.token) {
        dispatch(updateToken(res.data.token));
      }
      toast.success(t('profile.passwordChanged'));
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error(error.response?.data?.error || t('profile.passwordError'));
    }
  };

  const handleSaveEmail = async () => {
    const email = emailInput.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast.error(t('profile.emailInvalid')); return; }
    setEmailSaving(true);
    try {
      const res = await api.put('/client/users/email', { email });
      if (res.data?.user) dispatch(updateProfile(res.data.user));
      setEmailInput('');
      toast.success(res.data?.message || t('profile.emailUpdated'));
    } catch (e) {
      toast.error(e.response?.data?.error || t('profile.emailError'));
    } finally { setEmailSaving(false); }
  };

  const fields = [
    { label: t('profile.fullName'), name: 'name', value: formData.name, type: 'text' },
    { label: t('profile.email'), name: 'email', value: formData.email, type: 'email', readOnly: true },
    { label: t('profile.phone'), name: 'phone', value: formData.phone, type: 'tel' },
    { label: t('profile.address'), name: 'address', value: formData.address, type: 'text' },
  ];

  // Real stat fields returned by GET /api/dashboard/client/stats (no fabricated «rating»)
  const accountStats = [
    { num: stats?.activeConsultations ?? '—', label: t('profile.statActive') },
    { num: stats?.completedConsultations ?? '—', label: t('profile.statCompleted') },
    { num: stats?.documents ?? '—', label: t('profile.statDocuments') },
    { num: stats?.aiChats ?? '—', label: t('profile.statAiChats') },
  ];

  return (
    <GlassShell active="/profile" title={t('profile.myProfile')} subtitle={t('profile.subtitle')}>
      <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Header card */}
        <div style={{ ...glassCard, padding: 28, display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              onClick={handleAvatarClick}
              style={{
                width: 84,
                height: 84,
                borderRadius: '50%',
                background: formData.avatar ? undefined : 'linear-gradient(135deg, #B8956E, #8B7355)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                fontSize: 30,
                fontWeight: 300,
                overflow: 'hidden',
                cursor: isEditMode ? 'pointer' : 'default',
              }}
            >
              {formData.avatar ? (
                <img src={formData.avatar} alt={formData.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initialsOf(formData.name)
              )}
            </div>
            {isEditMode && (
              <button
                onClick={handleAvatarClick}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  border: '2px solid var(--surface)',
                  background: 'var(--accent)',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <PhotoCameraOutlined sx={{ fontSize: 15 }} />
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '0.02em', color: 'var(--text)' }}>
              {formData.name || t('profile.userFallback')}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 4 }}>{formData.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 20, background: 'rgba(122,154,107,0.16)', color: '#5E7A50' }}>
                ● {t('profile.statusActive')}
              </span>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 20, background: 'rgba(184,149,110,0.14)', color: 'var(--accent-dark)' }}>
                {t('profile.roleClient')}
              </span>
            </div>
          </div>
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((label, idx) => (
            <button key={label} onClick={() => handleTabChange(idx)} style={tabBtnStyle(activeTab === idx)}>
              {t('profile.' + label)}
            </button>
          ))}
        </div>

        {/* Tab 0 — Personal info */}
        {activeTab === 0 && (
          <>
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={sectionTitle}>{t('profile.personalInfo')}</div>
                <button
                  onClick={handleEditToggle}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--accent)',
                    color: 'var(--accent-dark)',
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    padding: '8px 18px',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {isEditMode ? t('profile.cancel') : t('profile.edit')}
                </button>
              </div>

              {isPhoneAccount && (
                <div style={{ background: 'rgba(184,149,110,0.08)', border: '1px solid rgba(184,149,110,0.25)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{t('profile.attachEmailTitle')}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>{t('profile.attachEmailHint')}</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder={t('profile.attachEmailPlaceholder')}
                      style={{ ...inputStyle, flex: 1, minWidth: 200, opacity: 1, cursor: 'text' }}
                    />
                    <button
                      onClick={handleSaveEmail}
                      disabled={emailSaving || !emailInput.trim()}
                      style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--radius)', cursor: emailSaving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: emailSaving ? 0.7 : 1 }}
                    >
                      {emailSaving ? t('profile.saving') : t('profile.attachEmailSave')}
                    </button>
                  </div>
                </div>
              )}

              {needsVerify && (
                <div style={{ background: 'rgba(196,163,90,0.10)', border: '1px solid rgba(196,163,90,0.35)', borderRadius: 'var(--radius)', padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{t('profile.verifyPhoneTitle')}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>{t('profile.verifyPhoneHint')}</div>
                  {!otpSent ? (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <input value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder="+998 90 123 45 67"
                        style={{ ...inputStyle, flex: 1, minWidth: 200, opacity: 1, cursor: 'text' }} />
                      <button onClick={requestOtp} disabled={otpSending || !phoneInput.trim()}
                        style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--radius)', cursor: otpSending ? 'default' : 'pointer', fontFamily: 'inherit', opacity: otpSending ? 0.7 : 1 }}>
                        {otpSending ? t('profile.saving') : t('profile.otpRequest')}
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} placeholder={t('profile.otpPlaceholder')} inputMode="numeric" maxLength={6}
                          style={{ ...inputStyle, flex: 1, minWidth: 160, opacity: 1, cursor: 'text', letterSpacing: '0.3em' }} />
                        <button onClick={confirmOtp} disabled={otpConfirming || otpCode.trim().length < 4}
                          style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, padding: '10px 20px', borderRadius: 'var(--radius)', cursor: otpConfirming ? 'default' : 'pointer', fontFamily: 'inherit', opacity: otpConfirming ? 0.7 : 1 }}>
                          {otpConfirming ? t('profile.saving') : t('profile.otpConfirm')}
                        </button>
                        <button onClick={() => { setOtpSent(false); setOtpCode(''); setDevCode(''); }}
                          style={{ background: 'transparent', color: 'var(--text3)', border: 'none', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {t('profile.otpChangeNumber')}
                        </button>
                      </div>
                      {devCode && (
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{t('profile.otpDevCode')}: <b style={{ color: 'var(--accent-dark)' }}>{devCode}</b></div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="prof-grid">
                {fields.map((f) => (
                  <div key={f.name}>
                    <div style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--text3)', marginBottom: 7 }}>{f.label}</div>
                    <input
                      name={f.name}
                      type={f.type}
                      value={f.value}
                      onChange={handleInputChange}
                      disabled={!isEditMode || f.readOnly}
                      style={{ ...inputStyle, opacity: (isEditMode && !f.readOnly) ? 1 : 0.7, cursor: (isEditMode && !f.readOnly) ? 'text' : 'default' }}
                    />
                  </div>
                ))}
              </div>

              {isEditMode && (
                <button onClick={handleSaveChanges} style={{ ...primaryBtn, marginTop: 22 }}>
                  {t('profile.save')}
                </button>
              )}
            </div>

            {/* Account statistics */}
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 20 }}>{t('profile.accountStats')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }} className="prof-stats">
                {accountStats.map((s) => (
                  <div key={s.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--accent-dark)' }}>{s.num}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Tab 1 — Security */}
        {activeTab === 1 && (
          <>
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 20 }}>{t('profile.changePassword')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <input
                  name="oldPassword"
                  type="password"
                  placeholder={t('profile.currentPassword')}
                  value={passwordData.oldPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
                <input
                  name="newPassword"
                  type="password"
                  placeholder={t('profile.newPasswordPh')}
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
                <input
                  name="confirmPassword"
                  type="password"
                  placeholder={t('profile.confirmPasswordPh')}
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
              </div>
              <button onClick={handlePasswordSubmit} style={{ ...primaryBtn, marginTop: 22 }}>
                {t('profile.updatePassword')}
              </button>
            </div>

            {/* Security tips */}
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 14 }}>{t('profile.securityTips')}</div>
              {[
                t('profile.tip1'),
                t('profile.tip2'),
                t('profile.tip3'),
              ].map((tip) => (
                <div key={tip} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text2)', marginBottom: 6 }}>
                  • {tip}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab 2 — Реальная лента активности (консультации/документы/отзывы) */}
        {activeTab === 2 && (
          activity.length > 0 ? (
            <div style={{ ...glassCard, padding: '8px 24px' }}>
              {activity.map((e, i) => {
                const meta = ACT_META[e.type] || ACT_META.consultation;
                let title = t('profile.act_' + e.type);
                if (e.name) title += ` — ${e.name}`;
                if (e.type === 'review' && e.rating) title += ` (${e.rating}★)`;
                return (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '14px 0', borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{meta.dot}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{fmtActDate(e.date)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ ...glassCard, padding: '48px 26px', textAlign: 'center' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(184,149,110,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', color: 'var(--accent)' }}>
                <HistoryOutlined sx={{ fontSize: 30 }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>{t('profile.noActivityTitle')}</div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 22, maxWidth: 360, margin: '0 auto 22px' }}>
                {t('profile.noActivitySub')}
              </div>
              <button
                onClick={() => navigate('/lawyers')}
                style={{ background: 'var(--accent)', color: '#FFFFFF', border: 'none', fontSize: 12, fontWeight: 500, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '12px 22px', borderRadius: 'var(--radius)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {t('profile.findLawyer')} →
              </button>
            </div>
          )
        )}
      </div>

      <style>{`
        @media (max-width: 640px){
          .prof-grid { grid-template-columns: 1fr !important; }
          .prof-stats { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </GlassShell>
  );
};

export default ProfilePageGlass;
