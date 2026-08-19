import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useMediaQuery } from '@mui/material';
import {
  GridViewOutlined,
  AutoAwesomeOutlined,
  GavelOutlined,
  CalendarMonthOutlined,
  DescriptionOutlined,
  WorkOutlineOutlined,
  FavoriteBorderOutlined,
  ReceiptLongOutlined,
  InsightsOutlined,
  ForumOutlined,
  SettingsOutlined,
  HelpOutlineOutlined,
  LogoutOutlined,
  DarkModeOutlined,
  LightModeOutlined,
  MenuOutlined,
  CampaignOutlined,
} from '@mui/icons-material';
import { getHomePath, logout, switchMode } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';
import NotificationCenter from '../UI/NotificationCenter';
import AmbientBackground from './AmbientBackground';

/** Nav config per role. key = route, matched against location for active state. */
const NAV = {
  client: [
    { key: '/dashboard', tKey: 'nav.dashboard', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/ai-chat', tKey: 'nav.aiChat', icon: <AutoAwesomeOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyers', tKey: 'nav.lawyers', icon: <GavelOutlined sx={{ fontSize: 20 }} /> },
    { key: '/consultations', tKey: 'nav.consultations', icon: <CalendarMonthOutlined sx={{ fontSize: 20 }} /> },
    { key: '/documents', tKey: 'nav.documents', icon: <DescriptionOutlined sx={{ fontSize: 20 }} /> },
    { key: '/portfolio', tKey: 'nav.portfolio', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
    { key: '/favorites', tKey: 'nav.favorites', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/payments', tKey: 'nav.payments', icon: <ReceiptLongOutlined sx={{ fontSize: 20 }} /> },
  ],
  lawyer: [
    { key: '/lawyer/dashboard', tKey: 'nav.dashboard', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/consultations', tKey: 'nav.consultations', icon: <ForumOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/schedule', tKey: 'nav.schedule', icon: <CalendarMonthOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/analytics', tKey: 'nav.analytics', icon: <InsightsOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/promotions', tKey: 'nav.promotions', icon: <CampaignOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/reviews', tKey: 'nav.reviews', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/profile/edit', tKey: 'nav.profile', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
  ],
  lawyerApplicant: [
    { key: '/lawyer/onboarding', tKey: 'nav.dashboard', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/profile/edit', tKey: 'nav.profile', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/imports', tKey: 'nav.documents', icon: <DescriptionOutlined sx={{ fontSize: 20 }} /> },
    { key: '/settings#two-factor', label: '2FA', icon: <SettingsOutlined sx={{ fontSize: 20 }} /> },
  ],
  admin: [
    { key: '/admin/dashboard', tKey: 'nav.dashboard', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/users', tKey: 'admin.manageUsers', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/lawyers', tKey: 'admin.manageLawyers', icon: <GavelOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/specializations', tKey: 'admin.specializations', icon: <DescriptionOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/promos', tKey: 'admin.promos', icon: <ReceiptLongOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/promotions', tKey: 'nav.promotions', icon: <CampaignOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/reviews', tKey: 'admin.reviews', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/support', tKey: 'admin.support', icon: <HelpOutlineOutlined sx={{ fontSize: 20 }} /> },
  ],
};

export const canShowMemberModeSwitcher = ({ accountType, capabilities = [] }) => (
  accountType === 'member'
  && capabilities.includes('client')
  && (capabilities.includes('lawyerApplicant') || capabilities.includes('lawyer'))
);

export const MODE_SWITCH_MIN_SIZE = 44;

const navRoleForAuth = ({ activeMode, capabilities = [] }) => (
  activeMode === 'lawyer' && !capabilities.includes('lawyer') ? 'lawyerApplicant' : activeMode
);

export const navKeysForAuth = (auth) => [
  ...(NAV[navRoleForAuth(auth)] || []).map((item) => item.key),
  '/settings',
  '/help',
];

function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, () => setDark((d) => !d)];
}

// «Золотая аврора»: активный пункт — карточка, выступающая из золотого градиента.
const navBtnStyle = (active, dark) => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 14px',
  minHeight: 44,
  background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-dark))' : 'transparent',
  border: 'none',
  borderRadius: 'var(--radius)',
  fontFamily: 'inherit',
  fontSize: 14,
  color: active ? '#FFFFFF' : (dark ? '#C7BAA6' : '#5E4F3B'),
  cursor: 'pointer',
  letterSpacing: '0.01em',
  fontWeight: active ? 600 : 400,
  boxShadow: active ? '0 6px 18px rgba(184,149,110,0.42)' : 'none',
  transition: 'background 0.18s, color 0.18s, box-shadow 0.18s',
});

const navHoverIn = (e, active, dark) => {
  if (!active) e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.5)';
};
const navHoverOut = (e, active) => {
  if (!active) e.currentTarget.style.background = 'transparent';
};

/**
 * GlassShell — persistent sidebar + topbar chrome from the ClaudeDesign mockups.
 * Every migrated client page renders its content inside <GlassShell>.
 */
const GlassShell = ({ active, title, subtitle, role = 'client', children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const auth = useSelector((s) => s.auth);
  const { user, activeMode, switchingMode, modeUnavailable } = auth;
  const { t } = useTranslation();
  const isDesktop = useMediaQuery('(min-width:1024px)');
  const [dark, toggleDark] = useDarkMode();
  // Профиль по роли (у юриста своя страница, у клиента — /profile)
  const shellRole = activeMode || role;
  const profilePath = shellRole === 'lawyer' ? '/lawyer/profile/edit' : shellRole === 'admin' ? '/admin/dashboard' : '/profile';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navRole = navRoleForAuth({ activeMode: shellRole, capabilities: auth.capabilities });
  const navItems = NAV[navRole] || NAV.client;
  const activeKey = active || location.pathname;

  // Фон сайдбара = фон страницы (var(--canvas)) — единый цвет с контентом.
  // Разделение даёт тонкий правый бордер, а не другой цвет.
  const auroraBg = 'var(--canvas)';
  const sideBorder = dark ? 'rgba(255,255,255,0.08)' : 'rgba(140,110,70,0.18)';

  const go = (key) => { navigate(key); setDrawerOpen(false); };
  const handleLogout = () => { dispatch(logout()); navigate('/login'); };
  const handleModeSwitch = async (targetMode) => {
    if (switchingMode || targetMode === activeMode) return;
    try {
      const session = await dispatch(switchMode(targetMode));
      navigate(getHomePath(session));
      setDrawerOpen(false);
    } catch (error) {
      // The switch thunk restores the prior validated mode and exposes a clear error.
    }
  };

  const sidebar = (
    <aside
      style={{
        zIndex: 3, width: 248, flexShrink: 0,
        background: auroraBg,
        borderRight: `1px solid ${sideBorder}`, display: 'flex', flexDirection: 'column', height: '100vh',
        position: isDesktop ? 'sticky' : 'fixed', top: 0, left: 0,
      }}
    >
      <div style={{ padding: '26px 24px 22px', borderBottom: `1px solid ${sideBorder}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, border: '1.5px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 300, fontSize: 21 }}>M</div>
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text)' }}>eMaslaXat</div>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: 3 }}>Legal Platform</div>
        </div>
      </div>
      <nav style={{ flex: 1, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {navItems.map((n) => {
          const isActive = activeKey === n.key;
          return (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              style={navBtnStyle(isActive, dark)}
              onMouseEnter={(e) => navHoverIn(e, isActive, dark)}
              onMouseLeave={(e) => navHoverOut(e, isActive)}
            >
              <span style={{ display: 'flex', width: 20, height: 20 }}>{n.icon}</span>
               <span>{n.label || t(n.tKey)}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ padding: '16px 14px', borderTop: `1px solid ${sideBorder}` }}>
        <button onClick={() => go('/settings')} style={navBtnStyle(activeKey === '/settings', dark)}
          onMouseEnter={(e) => navHoverIn(e, activeKey === '/settings', dark)} onMouseLeave={(e) => navHoverOut(e, activeKey === '/settings')}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><SettingsOutlined sx={{ fontSize: 20 }} /></span><span>{t('nav.settings')}</span>
        </button>
        <button onClick={() => go('/help')} style={navBtnStyle(activeKey === '/help', dark)}
          onMouseEnter={(e) => navHoverIn(e, activeKey === '/help', dark)} onMouseLeave={(e) => navHoverOut(e, activeKey === '/help')}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><HelpOutlineOutlined sx={{ fontSize: 20 }} /></span><span>{t('nav.support')}</span>
        </button>
        {/* Выход — обычный минимальный пункт, как остальные */}
        <button
          onClick={handleLogout}
          style={{ ...navBtnStyle(false, dark), marginTop: 2 }}
          onMouseEnter={(e) => navHoverIn(e, false, dark)}
          onMouseLeave={(e) => navHoverOut(e, false)}
        >
          <span style={{ display: 'flex', width: 20, height: 20 }}><LogoutOutlined sx={{ fontSize: 20 }} /></span><span>{t('nav.logout')}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div style={{ position: 'relative', display: 'flex', minHeight: '100vh', maxHeight: '100vh', overflow: 'hidden', background: 'var(--canvas)' }}>
      <AmbientBackground />

      {isDesktop && sidebar}
      {!isDesktop && drawerOpen && (
        <>
          <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2, background: 'rgba(0,0,0,0.35)' }} />
          {sidebar}
        </>
      )}

      {/* MAIN COLUMN */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header
          style={{
            minHeight: 72, flexShrink: 0, background: 'var(--card-glass)',
            backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 20, padding: '14px 32px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            {!isDesktop && (
              <button onClick={() => setDrawerOpen(true)} aria-label={t('nav.menu')} style={{ width: 44, height: 44, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
                <MenuOutlined />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.03em', marginTop: 2 }}>{subtitle}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {canShowMemberModeSwitcher(auth) && (
              <div role="group" aria-label="Режим кабинета" style={{ display: 'flex', padding: 3, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--canvas)' }}>
                {[
                  { mode: 'client', label: 'Клиент' },
                  { mode: 'lawyer', label: 'Юрист' },
                ].map((item) => {
                  const selected = activeMode === item.mode;
                  return (
                    <button
                      type="button"
                      key={item.mode}
                      aria-label={`Режим: ${item.label}`}
                      aria-pressed={selected}
                      disabled={switchingMode}
                      onClick={() => handleModeSwitch(item.mode)}
                      style={{
                        minWidth: MODE_SWITCH_MIN_SIZE, minHeight: MODE_SWITCH_MIN_SIZE,
                        padding: isDesktop ? '7px 12px' : '7px 8px', border: 0,
                        borderRadius: 'calc(var(--radius) - 3px)', background: selected ? 'var(--accent)' : 'transparent',
                        color: selected ? '#fff' : 'var(--text2)', cursor: switchingMode ? 'wait' : 'pointer',
                        fontFamily: 'inherit', fontSize: 12, fontWeight: selected ? 600 : 500,
                      }}
                    >
                      {isDesktop ? item.label : item.label.charAt(0)}
                    </button>
                  );
                })}
              </div>
            )}
            <button onClick={toggleDark} aria-label={t('nav.theme')} title={t('nav.theme')} style={{ width: 44, height: 44, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
              {dark ? <LightModeOutlined sx={{ fontSize: 19 }} /> : <DarkModeOutlined sx={{ fontSize: 19 }} />}
            </button>
            {isDesktop && <LanguageSwitcher variant="dropdown" />}
            <NotificationCenter />
            <button onClick={() => navigate(profilePath)} aria-label={t('nav.profile')} style={{ minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', gap: 11, paddingLeft: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #B8956E, #8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: 500 }}>
                {(user?.name?.charAt(0) || 'К').toUpperCase()}
              </div>
            </button>
          </div>
        </header>
        {modeUnavailable && (
          <div role="alert" style={{ padding: '9px 32px', color: '#8B2F2F', background: 'rgba(180,70,70,0.1)', borderBottom: '1px solid rgba(180,70,70,0.2)', fontSize: 13 }}>
            {modeUnavailable}
          </div>
        )}

        {/* SCROLLABLE CONTENT */}
        <main className="screen" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 48px' }}>
          {children}
        </main>
      </div>

      {/* На мобиле оставляем место под фиксированную нижнюю панель (MobileBottomNav ~64px),
          чтобы последний ряд контента не уходил под неё. */}
      <style>{`@media (max-width: 1023px){ .screen { padding: 20px 16px 88px !important; } }`}</style>
    </div>
  );
};

export default GlassShell;
