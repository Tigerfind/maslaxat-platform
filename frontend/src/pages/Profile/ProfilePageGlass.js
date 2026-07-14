import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'react-toastify';
import { PhotoCameraOutlined, HistoryOutlined } from '@mui/icons-material';
import { updateProfile } from '../../store/slices/authSlice';
import api from '../../services/api';
import clientService from '../../services/clientService';
import GlassShell from '../../components/GlassKit/GlassShell';

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

const TABS = ['Личная информация', 'Безопасность', 'История активности'];

const ProfilePageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);

  const user = useSelector((state) => state.auth.user);

  const [activeTab, setActiveTab] = useState(0);
  const [isEditMode, setIsEditMode] = useState(false);
  const [stats, setStats] = useState(null);

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
      toast.info('Изменения отменены');
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
      toast.error('Размер файла не должен превышать 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({ ...prev, avatar: reader.result, avatarFile: file }));
      toast.success('Фото выбрано. Нажмите «Сохранить» для обновления');
    };
    reader.readAsDataURL(file);
  };

  const handleSaveChanges = async () => {
    if (!formData.name.trim()) {
      toast.error('Имя не может быть пустым');
      return;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      toast.error('Введите корректный email');
      return;
    }
    try {
      const payload = new FormData();
      payload.append('name', formData.name);
      payload.append('phone', formData.phone || '');
      if (formData.avatarFile) payload.append('avatar', formData.avatarFile);

      const response = await api.put('/client/users/profile', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      dispatch(updateProfile(response.data.user));
      setIsEditMode(false);
      toast.success('Профиль успешно обновлён!');
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error(error.response?.data?.error || 'Ошибка обновления профиля');
    }
  };

  const handlePasswordSubmit = async () => {
    if (!passwordData.oldPassword) {
      toast.error('Введите текущий пароль');
      return;
    }
    if (!passwordData.newPassword) {
      toast.error('Введите новый пароль');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      toast.error('Пароль должен содержать минимум 6 символов');
      return;
    }
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    try {
      await api.put('/client/users/password', {
        oldPassword: passwordData.oldPassword,
        newPassword: passwordData.newPassword,
      });
      toast.success('Пароль успешно изменён!');
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error changing password:', error);
      toast.error(error.response?.data?.error || 'Ошибка изменения пароля');
    }
  };

  const fields = [
    { label: 'Полное имя', name: 'name', value: formData.name, type: 'text' },
    { label: 'Email', name: 'email', value: formData.email, type: 'email' },
    { label: 'Телефон', name: 'phone', value: formData.phone, type: 'tel' },
    { label: 'Адрес', name: 'address', value: formData.address, type: 'text' },
  ];

  // Real stat fields returned by GET /api/dashboard/client/stats (no fabricated «rating»)
  const accountStats = [
    { num: stats?.activeConsultations ?? '—', label: 'Активные' },
    { num: stats?.completedConsultations ?? '—', label: 'Завершено' },
    { num: stats?.documents ?? '—', label: 'Документы' },
    { num: stats?.aiChats ?? '—', label: 'AI-чаты' },
  ];

  return (
    <GlassShell active="/profile" title="Мой профиль" subtitle="Управление вашей учётной записью">
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
              {formData.name || 'Пользователь'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 4 }}>{formData.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 20, background: 'rgba(122,154,107,0.16)', color: '#5E7A50' }}>
                ● Активный
              </span>
              <span style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '5px 12px', borderRadius: 20, background: 'rgba(184,149,110,0.14)', color: 'var(--accent-dark)' }}>
                Клиент
              </span>
            </div>
          </div>
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((label, idx) => (
            <button key={label} onClick={() => handleTabChange(idx)} style={tabBtnStyle(activeTab === idx)}>
              {label}
            </button>
          ))}
        </div>

        {/* Tab 0 — Personal info */}
        {activeTab === 0 && (
          <>
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={sectionTitle}>Личная информация</div>
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
                  {isEditMode ? 'Отмена' : 'Редактировать'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="prof-grid">
                {fields.map((f) => (
                  <div key={f.name}>
                    <div style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--text3)', marginBottom: 7 }}>{f.label}</div>
                    <input
                      name={f.name}
                      type={f.type}
                      value={f.value}
                      onChange={handleInputChange}
                      disabled={!isEditMode}
                      style={{ ...inputStyle, opacity: isEditMode ? 1 : 0.7, cursor: isEditMode ? 'text' : 'default' }}
                    />
                  </div>
                ))}
              </div>

              {isEditMode && (
                <button onClick={handleSaveChanges} style={{ ...primaryBtn, marginTop: 22 }}>
                  Сохранить
                </button>
              )}
            </div>

            {/* Account statistics */}
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 20 }}>Статистика аккаунта</div>
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
              <div style={{ ...sectionTitle, marginBottom: 20 }}>Смена пароля</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <input
                  name="oldPassword"
                  type="password"
                  placeholder="Текущий пароль"
                  value={passwordData.oldPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
                <input
                  name="newPassword"
                  type="password"
                  placeholder="Новый пароль (минимум 6 символов)"
                  value={passwordData.newPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
                <input
                  name="confirmPassword"
                  type="password"
                  placeholder="Повторите новый пароль"
                  value={passwordData.confirmPassword}
                  onChange={handlePasswordChange}
                  style={inputStyle}
                />
              </div>
              <button onClick={handlePasswordSubmit} style={{ ...primaryBtn, marginTop: 22 }}>
                Обновить пароль
              </button>
            </div>

            {/* Security tips */}
            <div style={{ ...glassCard, padding: 26 }}>
              <div style={{ ...sectionTitle, marginBottom: 14 }}>Советы по безопасности</div>
              {[
                'Используйте комбинацию букв, цифр и специальных символов',
                'Не используйте один и тот же пароль на разных сайтах',
                'Регулярно меняйте пароль для повышения безопасности',
              ].map((tip) => (
                <div key={tip} style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text2)', marginBottom: 6 }}>
                  • {tip}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Tab 2 — Activity history (no real data source → honest empty state) */}
        {activeTab === 2 && (
          <div style={{ ...glassCard, padding: '48px 26px', textAlign: 'center' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(184,149,110,0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 18px',
                color: 'var(--accent)',
              }}
            >
              <HistoryOutlined sx={{ fontSize: 30 }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 400, color: 'var(--text)', marginBottom: 6 }}>Пока нет активности</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 22, maxWidth: 360, margin: '0 auto 22px' }}>
              Здесь появится история ваших действий на платформе — консультации, документы и запросы к AI.
            </div>
            <button
              onClick={() => navigate('/lawyers')}
              style={{
                background: 'var(--accent)',
                color: '#FFFFFF',
                border: 'none',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                padding: '12px 22px',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Найти юриста →
            </button>
          </div>
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
