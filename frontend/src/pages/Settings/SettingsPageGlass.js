import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Slider, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import {
  NotificationsNoneOutlined,
  LockOutlined,
  LanguageOutlined,
  DarkModeOutlined,
  TextFieldsOutlined,
  LogoutOutlined,
  CheckOutlined,
  RestartAltOutlined,
  CloseOutlined,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { logout } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';
import GlassShell from '../../components/GlassKit/GlassShell';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import api from '../../services/api';

/*
  ─────────────────────────────────────────────────────────────
  SETTINGS  (/settings)
  Ported 1:1 from ClaudeDesign → client/12_SETTINGS_light_stub.html.
  Sections: Уведомления · Приватность · Язык · Тема · Отображение.
  Data wiring (kept from previous implementation):
   • appSettings (email/push, privacy, showEmail/Phone, dataSharing,
     fontSize, compactMode) ← persisted to localStorage 'appSettings'.
     Backend persistence (PUT /api/users/profile settings) is a
     SEPARATE task — not wired here yet.
   • Тема toggle → same mechanism as GlassShell: localStorage 'theme'
     + document.documentElement[data-theme] so glass.css dark vars
     apply globally and stay in sync with the topbar toggle.
   • Язык → useTranslation().setLanguage (persists to 'language').
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
  padding: 24,
};

const sectionTitle = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text)',
};

const iconBox = {
  width: 34,
  height: 34,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius)',
  background: 'var(--canvas)',
  border: '1px solid var(--border)',
  color: 'var(--accent)',
};

// ── Custom glass toggle (matches mockup <button><knob/></button>) ──
const Toggle = ({ on, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    style={{
      width: 46,
      height: 26,
      flexShrink: 0,
      borderRadius: 13,
      border: 'none',
      cursor: 'pointer',
      padding: 3,
      background: on ? 'var(--accent)' : 'var(--border-strong)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: on ? 'flex-end' : 'flex-start',
      transition: 'background 0.22s',
    }}
  >
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: '#FFFFFF',
        boxShadow: '0 1px 3px rgba(0,0,0,0.28)',
        transition: 'all 0.22s',
      }}
    />
  </button>
);

const Section = ({ icon, title, subtitle, children }) => (
  <div style={glassCard}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <span style={iconBox}>{icon}</span>
      <div>
        <div style={sectionTitle}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3, textTransform: 'none', letterSpacing: 0 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
    {children}
  </div>
);

const Row = ({ label, description, control, last }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      padding: '14px 0',
      borderBottom: last ? 'none' : '1px solid var(--border)',
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
      {description && (
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3 }}>{description}</div>
      )}
    </div>
    {control}
  </div>
);

const SettingsPageGlass = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { role } = useSelector((s) => s.auth);
  const { t } = useTranslation();

  // ── appSettings: local-only preferences (NOT theme/language) ──
  const defaultSettings = {
    emailNotifications: true,
    pushNotifications: true,
    profileVisibility: 'public',
    dataSharing: false,
    showEmail: true,
    showPhone: false,
    fontSize: 16,
    compactMode: false,
  };

  const loadSettings = () => {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
      try {
        return { ...defaultSettings, ...JSON.parse(saved) };
      } catch (e) {
        return defaultSettings;
      }
    }
    return defaultSettings;
  };

  const [settings, setSettings] = useState(loadSettings);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // ── Тема: wired to the SAME mechanism as GlassShell's toggle ──
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const toggleDark = () =>
    setDark((prev) => {
      const next = !prev;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      return next;
    });

  useEffect(() => {
    const saved = loadSettings();
    setHasChanges(JSON.stringify(saved) !== JSON.stringify(settings));
  }, [settings]);

  // Загружаем настройки с сервера при открытии страницы (сервер — источник истины)
  useEffect(() => {
    let ignore = false;
    api.get('/users/settings')
      .then((res) => {
        const serverSettings = res.data?.settings;
        if (!ignore && serverSettings && Object.keys(serverSettings).length) {
          const merged = { ...defaultSettings, ...serverSettings };
          setSettings(merged);
          localStorage.setItem('appSettings', JSON.stringify(merged));
        }
      })
      .catch(() => { /* офлайн/ошибка — остаёмся на локальных настройках */ });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = (key) =>
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleSaveSettings = async () => {
    // Локальный кэш — чтобы настройки применялись мгновенно и работали офлайн
    localStorage.setItem('appSettings', JSON.stringify(settings));
    try {
      await api.put('/users/settings', { settings });
      setHasChanges(false);
      toast.success(t('settings.saved'), { position: 'bottom-center', autoClose: 2000 });
    } catch (e) {
      toast.error(t('settings.saveErrorLocal'), { position: 'bottom-center', autoClose: 3000 });
    }
  };

  const handleResetToDefaults = () => {
    setSettings(defaultSettings);
    toast.success(t('settings.resetDefaults'), { position: 'bottom-center', autoClose: 2000 });
  };

  const handleLogout = () => {
    dispatch(logout());
    toast.success(t('settings.loggedOut'));
    navigate('/login');
  };

  const visOptions = [
    { value: 'public', label: t('settings.visPublic'), desc: t('settings.visPublicDesc') },
    { value: 'contacts', label: t('settings.visContacts'), desc: t('settings.visContactsDesc') },
    { value: 'private', label: t('settings.visPrivate'), desc: t('settings.visPrivateDesc') },
  ];

  const accentSlider = {
    color: 'var(--accent)',
    '& .MuiSlider-thumb': { backgroundColor: 'var(--accent)', boxShadow: '0 2px 6px rgba(184,149,110,0.35)' },
    '& .MuiSlider-track': { backgroundColor: 'var(--accent)', border: 'none' },
    '& .MuiSlider-rail': { backgroundColor: 'var(--border)' },
    '& .MuiSlider-mark': { backgroundColor: 'var(--text3)' },
    '& .MuiSlider-markLabel': { color: 'var(--text3)', fontSize: '0.72rem', fontWeight: 500 },
  };

  return (
    <GlassShell active="/settings" title={t('settings.title')} subtitle={t('settings.subtitle')} role={role || 'client'}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* ── Уведомления ── */}
        <Section
          icon={<NotificationsNoneOutlined sx={{ fontSize: 20 }} />}
          title={t('settings.notifications')}
          subtitle={t('settings.notificationsSub')}
        >
          <Row
            label={t('settings.emailNotif')}
            description={t('settings.emailNotifDesc')}
            control={<Toggle on={settings.emailNotifications} onClick={() => handleToggle('emailNotifications')} />}
          />
          <Row
            label={t('settings.pushNotif')}
            description={t('settings.pushNotifDesc')}
            control={<Toggle on={settings.pushNotifications} onClick={() => handleToggle('pushNotifications')} />}
            last
          />
        </Section>

        {/* ── Приватность ── */}
        <Section
          icon={<LockOutlined sx={{ fontSize: 20 }} />}
          title={t('settings.privacy')}
          subtitle={t('settings.privacySub')}
        >
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginBottom: 12 }}>
            {t('settings.profileVisibility')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {visOptions.map((o) => {
              const active = settings.profileVisibility === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSettings((prev) => ({ ...prev, profileVisibility: o.value }))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    width: '100%',
                    textAlign: 'left',
                    padding: '13px 15px',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    background: active ? 'var(--canvas)' : 'transparent',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all 0.2s',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: '50%',
                      border: `2px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {active && (
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                    )}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{o.label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ height: 18 }} />

          <Row
            label={t('settings.showEmail')}
            description={t('settings.showEmailDesc')}
            control={<Toggle on={settings.showEmail} onClick={() => handleToggle('showEmail')} />}
          />
          <Row
            label={t('settings.showPhone')}
            description={t('settings.showPhoneDesc')}
            control={<Toggle on={settings.showPhone} onClick={() => handleToggle('showPhone')} />}
          />
          <Row
            label={t('settings.dataSharing')}
            description={t('settings.dataSharingDesc')}
            control={<Toggle on={settings.dataSharing} onClick={() => handleToggle('dataSharing')} />}
            last
          />
        </Section>

        {/* ── Язык интерфейса ── */}
        <Section
          icon={<LanguageOutlined sx={{ fontSize: 20 }} />}
          title={t('settings.language')}
          subtitle={t('settings.languageSub')}
        >
          <LanguageSwitcher variant="dropdown" />
        </Section>

        {/* ── Тема ── */}
        <Section
          icon={<DarkModeOutlined sx={{ fontSize: 20 }} />}
          title={t('settings.theme')}
          subtitle={t('settings.themeSub')}
        >
          <Row
            label={t('settings.darkTheme')}
            description={t('settings.darkThemeDesc')}
            control={<Toggle on={dark} onClick={toggleDark} />}
            last
          />
          <div
            style={{
              marginTop: 16,
              padding: 18,
              borderRadius: 'var(--radius)',
              background: 'var(--canvas)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{t('settings.themePreview')}</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--accent), var(--accent-dark))',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>eMaslaXat</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  {t('settings.themePreviewCard')}
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Отображение ── */}
        <Section
          icon={<TextFieldsOutlined sx={{ fontSize: 20 }} />}
          title={t('settings.display')}
          subtitle={t('settings.displaySub')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{t('settings.fontSize')}</div>
            <div
              style={{
                background: 'var(--canvas)',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                padding: '4px 12px',
                borderRadius: 'var(--radius)',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {settings.fontSize}px
            </div>
          </div>
          <div style={{ padding: '0 6px' }}>
            <Slider
              value={settings.fontSize}
              onChange={(e, v) => setSettings((prev) => ({ ...prev, fontSize: v }))}
              min={12}
              max={24}
              step={1}
              marks={[
                { value: 12, label: '12px' },
                { value: 16, label: '16px' },
                { value: 20, label: '20px' },
                { value: 24, label: '24px' },
              ]}
              sx={accentSlider}
            />
          </div>
          <div
            style={{
              marginTop: 12,
              marginBottom: 6,
              padding: 18,
              borderRadius: 'var(--radius)',
              background: 'var(--canvas)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: `${settings.fontSize}px`, color: 'var(--text)', fontWeight: 500 }}>
              {t('settings.fontSizePreview')}
            </div>
          </div>

          <Row
            label={t('settings.compactMode')}
            description={t('settings.compactModeDesc')}
            control={<Toggle on={settings.compactMode} onClick={() => handleToggle('compactMode')} />}
            last
          />
        </Section>

        {/* ── Действия: Сохранить / Сбросить ── */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleSaveSettings}
            disabled={!hasChanges}
            style={{
              flex: '1 1 240px',
              padding: 15,
              borderRadius: 'var(--radius)',
              border: 'none',
              cursor: hasChanges ? 'pointer' : 'default',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#FFFFFF',
              background: hasChanges
                ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))'
                : 'var(--border)',
              opacity: hasChanges ? 1 : 0.7,
              transition: 'all 0.2s',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <CheckOutlined sx={{ fontSize: 18 }} /> {t('settings.saveChanges')}
            </span>
          </button>
          <button
            type="button"
            onClick={handleResetToDefaults}
            style={{
              flexShrink: 0,
              padding: '15px 24px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text2)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              transition: 'all 0.2s',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <RestartAltOutlined sx={{ fontSize: 18 }} /> {t('settings.reset')}
            </span>
          </button>
        </div>
        {hasChanges && (
          <div style={{ fontSize: 12, color: 'var(--accent)', textAlign: 'center', fontWeight: 500 }}>
            {t('settings.unsaved')}
          </div>
        )}

        {/* ── Выход из аккаунта ── */}
        <div style={{ ...glassCard, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <LogoutOutlined sx={{ fontSize: 20, color: 'var(--error)' }} />
              <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{t('settings.logout')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
              {t('settings.logoutDesc')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDialog(true)}
            style={{
              flexShrink: 0,
              padding: '13px 26px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--error)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              transition: 'all 0.2s',
            }}
          >
            {t('settings.logoutBtn')}
          </button>
        </div>

        {/* ── Info footer ── */}
        <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '4px 0 8px' }}>
          {t('settings.syncNote')}
        </div>
      </div>

      {/* ── Logout confirmation dialog ── */}
      <Dialog
        open={confirmDialog}
        onClose={() => setConfirmDialog(false)}
        PaperProps={{
          sx: {
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--card-shadow)',
            color: 'var(--text)',
          },
        }}
      >
        <DialogTitle sx={{ color: 'var(--text)', fontWeight: 500, letterSpacing: '0.02em' }}>
          {t('settings.logoutConfirmTitle')}
        </DialogTitle>
        <DialogContent>
          <div style={{ color: 'var(--text2)', marginTop: 6, fontSize: 14 }}>
            {t('settings.logoutConfirmText')}
          </div>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <button
            type="button"
            onClick={() => setConfirmDialog(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text2)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <CloseOutlined sx={{ fontSize: 17 }} /> {t('settings.cancel')}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 'var(--radius)',
              border: 'none',
              background: 'var(--error)',
              color: '#FFFFFF',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            <CheckOutlined sx={{ fontSize: 17 }} /> {t('settings.logoutBtn')}
          </button>
        </DialogActions>
      </Dialog>
    </GlassShell>
  );
};

export default SettingsPageGlass;
