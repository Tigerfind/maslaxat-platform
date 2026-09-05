import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Drawer, useMediaQuery } from '@mui/material';
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
  AccountBalanceWalletOutlined,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';
import NotificationCenter from '../UI/NotificationCenter';
import AmbientBackground from './AmbientBackground';
import MobileBottomNav from '../UI/MobileBottomNav';
import SupportFAB from '../UI/SupportFAB';

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
    { key: '/lawyer/reviews', tKey: 'nav.reviews', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/profile/edit', tKey: 'nav.profile', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
  ],
  admin: [
    { key: '/admin/dashboard', tKey: 'nav.dashboard', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/users', tKey: 'admin.manageUsers', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/lawyers', tKey: 'admin.manageLawyers', icon: <GavelOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/specializations', tKey: 'admin.specializations', icon: <DescriptionOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/consultations', tKey: 'adminConsult.title', icon: <CalendarMonthOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/finance', tKey: 'adminFinance.title', icon: <AccountBalanceWalletOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/promos', tKey: 'admin.promos', icon: <ReceiptLongOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/reviews', tKey: 'admin.reviews', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/admin/support', tKey: 'admin.support', icon: <HelpOutlineOutlined sx={{ fontSize: 20 }} /> },
  ],
};

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
const GlassShell = ({ active, title, subtitle, role: roleProp = 'client', children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user, role: authRole } = useSelector((s) => s.auth);
  const { t } = useTranslation();
  const isDesktop = useMediaQuery('(min-width:1024px)');
  const [dark, toggleDark] = useDarkMode();
  const role = authRole || roleProp;
  // Профиль по роли (у юриста своя страница, у клиента — /profile)
  const profilePath = role === 'lawyer' ? '/lawyer/profile/edit' : role === 'admin' ? '/admin/dashboard' : '/profile';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = NAV[role] || NAV.client;
  const activeKey = active || location.pathname;

  // Фон сайдбара = фон страницы (var(--canvas)) — единый цвет с контентом.
  // Разделение даёт тонкий правый бордер, а не другой цвет.
  const auroraBg = 'var(--canvas)';
  const sideBorder = dark ? 'rgba(255,255,255,0.08)' : 'rgba(140,110,70,0.18)';

  const go = (key) => { navigate(key); setDrawerOpen(false); };
  const handleLogout = () => { dispatch(logout()); navigate('/login'); };

  const sidebar = (
    <aside
      style={{
        zIndex: 3, width: isDesktop ? 248 : '100%', flexShrink: 0,
        background: auroraBg,
        borderRight: `1px solid ${sideBorder}`, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
        position: isDesktop ? 'sticky' : 'relative', top: 0, left: 0,
        paddingTop: isDesktop ? 'env(safe-area-inset-top)' : 0,
        paddingLeft: isDesktop ? 'env(safe-area-inset-left)' : 0,
      }}
    >
      <div style={{ padding: '26px 24px 22px', borderBottom: `1px solid ${sideBorder}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 38, height: 38, border: '1.5px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 300, fontSize: 21 }}>M</div>
        <div style={{ lineHeight: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text)' }}>eMaslaXat</div>
          <div style={{ fontSize: 8, fontWeight: 500, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text3)', marginTop: 3 }}>Legal Platform</div>
        </div>
      </div>
      <nav aria-label={t('nav.mainNavigation')} style={{ flex: 1, minHeight: 0, padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
        {navItems.map((n) => {
          const isActive = activeKey === n.key;
          return (
            <button
              key={n.key}
              onClick={() => go(n.key)}
              style={navBtnStyle(isActive, dark)}
              onMouseEnter={(e) => navHoverIn(e, isActive, dark)}
              onMouseLeave={(e) => navHoverOut(e, isActive)}
              aria-current={isActive ? 'page' : undefined}
            >
              <span style={{ display: 'flex', width: 20, height: 20 }}>{n.icon}</span>
              <span>{t(n.tKey)}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ padding: '16px 14px', borderTop: `1px solid ${sideBorder}` }}>
        <button onClick={() => go('/settings')} aria-current={activeKey === '/settings' ? 'page' : undefined} style={navBtnStyle(activeKey === '/settings', dark)}
          onMouseEnter={(e) => navHoverIn(e, activeKey === '/settings', dark)} onMouseLeave={(e) => navHoverOut(e, activeKey === '/settings')}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><SettingsOutlined sx={{ fontSize: 20 }} /></span><span>{t('nav.settings')}</span>
        </button>
        <button onClick={() => go('/help')} aria-current={activeKey === '/help' ? 'page' : undefined} style={navBtnStyle(activeKey === '/help', dark)}
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
    <div className="glass-shell" style={{ position: 'relative', display: 'flex', overflow: 'hidden', background: 'var(--canvas)', '--mobile-bottom-nav-height': '64px' }}>
      <AmbientBackground />

      {isDesktop && sidebar}
      {!isDesktop && (
        <Drawer
          id="glass-shell-navigation"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            sx: {
              width: 'min(280px, 100vw)',
              boxSizing: 'border-box',
              pt: 'env(safe-area-inset-top)',
              pl: 'env(safe-area-inset-left)',
              pr: 'env(safe-area-inset-right)',
              pb: 'env(safe-area-inset-bottom)',
              bgcolor: 'var(--canvas)',
            },
          }}
        >
          {sidebar}
        </Drawer>
      )}

      {/* MAIN COLUMN */}
      <div style={{ position: 'relative', zIndex: 2, flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <header className="glass-shell-header"
          style={{
            minHeight: 72, flexShrink: 0, background: 'var(--card-glass)',
            backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)',
            borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 20,
            padding: 'calc(14px + env(safe-area-inset-top)) calc(32px + env(safe-area-inset-right)) 14px calc(32px + env(safe-area-inset-left))',
          }}
        >
          <div className="glass-shell-title" style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
            {!isDesktop && (
              <button onClick={() => setDrawerOpen(true)} aria-label={t('nav.menu')} aria-expanded={drawerOpen} aria-controls="glass-shell-navigation" style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
                <MenuOutlined />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.03em', marginTop: 2 }}>{subtitle}</div>}
            </div>
          </div>
          <div className="glass-shell-actions" style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <button className="glass-shell-theme" onClick={toggleDark} aria-label={t('nav.theme')} aria-pressed={dark} title={t('nav.theme')} style={{ width: 44, height: 44, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
              {dark ? <LightModeOutlined sx={{ fontSize: 19 }} /> : <DarkModeOutlined sx={{ fontSize: 19 }} />}
            </button>
            {isDesktop && <LanguageSwitcher variant="dropdown" />}
            <NotificationCenter />
            <button onClick={() => navigate(profilePath)} aria-label={t('nav.profile')} style={{ display: 'flex', alignItems: 'center', gap: 11, paddingLeft: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #B8956E, #8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: 500 }}>
                {(user?.name?.charAt(0) || 'К').toUpperCase()}
              </div>
            </button>
          </div>
        </header>

        {/* SCROLLABLE CONTENT */}
        <main className="screen" aria-label={title} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', padding: '28px 32px 48px' }}>
          {children}
        </main>
      </div>

      <SupportFAB />
      <MobileBottomNav />

      {/* На мобиле оставляем место под фиксированную нижнюю панель (MobileBottomNav ~64px),
          чтобы последний ряд контента не уходил под неё. */}
      <style>{`@media (max-width: 1023px){ .screen { padding: 20px max(16px, env(safe-area-inset-right)) calc(var(--mobile-bottom-nav-height) + 24px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)) !important; overflow-x:hidden; } } @media(max-width:480px){.glass-shell-header{gap:4px !important;padding:calc(8px + env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) 8px max(8px, env(safe-area-inset-left)) !important}.glass-shell-title{gap:4px !important}.glass-shell-title>div:last-child>div:first-child{font-size:15px !important;letter-spacing:.03em !important}.glass-shell-title>div:last-child>div:last-child{display:none}.glass-shell-actions{gap:2px !important}} @media(max-width:350px){.glass-shell-theme{display:none !important}}`}</style>
    </div>
  );
};

export default GlassShell;
