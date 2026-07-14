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
  SettingsOutlined,
  HelpOutlineOutlined,
  LogoutOutlined,
  DarkModeOutlined,
  LightModeOutlined,
  MenuOutlined,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import { useTranslation } from '../../i18n';
import LanguageSwitcher from '../LanguageSwitcher';
import NotificationCenter from '../UI/NotificationCenter';
import AmbientBackground from './AmbientBackground';

/** Nav config per role. key = route, matched against location for active state. */
const NAV = {
  client: [
    { key: '/dashboard', label: 'Дашборд', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/ai-chat', label: 'AI-помощник', icon: <AutoAwesomeOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyers', label: 'Юристы', icon: <GavelOutlined sx={{ fontSize: 20 }} /> },
    { key: '/consultations', label: 'Консультации', icon: <CalendarMonthOutlined sx={{ fontSize: 20 }} /> },
    { key: '/documents', label: 'Документы', icon: <DescriptionOutlined sx={{ fontSize: 20 }} /> },
    { key: '/portfolio', label: 'Досье', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
    { key: '/favorites', label: 'Избранное', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
  ],
  lawyer: [
    { key: '/lawyer/dashboard', label: 'Дашборд', icon: <GridViewOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/schedule', label: 'Расписание', icon: <CalendarMonthOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/reviews', label: 'Отзывы', icon: <FavoriteBorderOutlined sx={{ fontSize: 20 }} /> },
    { key: '/lawyer/profile/edit', label: 'Профиль', icon: <WorkOutlineOutlined sx={{ fontSize: 20 }} /> },
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

const navBtnStyle = (active) => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 14px',
  background: active ? 'var(--accent)' : 'transparent',
  border: 'none',
  borderRadius: 'var(--radius)',
  fontFamily: 'inherit',
  fontSize: 14,
  color: active ? '#FFFFFF' : 'var(--text2)',
  cursor: 'pointer',
  letterSpacing: '0.01em',
  fontWeight: active ? 500 : 400,
  transition: 'background 0.2s, color 0.2s',
});

/**
 * GlassShell — persistent sidebar + topbar chrome from the ClaudeDesign mockups.
 * Every migrated client page renders its content inside <GlassShell>.
 */
const GlassShell = ({ active, title, subtitle, role = 'client', children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { user } = useSelector((s) => s.auth);
  const { t } = useTranslation();
  const isDesktop = useMediaQuery('(min-width:1024px)');
  const [dark, toggleDark] = useDarkMode();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = NAV[role] || NAV.client;
  const activeKey = active || location.pathname;

  const go = (key) => { navigate(key); setDrawerOpen(false); };
  const handleLogout = () => { dispatch(logout()); navigate('/login'); };

  const sidebar = (
    <aside
      style={{
        zIndex: 3, width: 248, flexShrink: 0,
        background: 'var(--card-glass)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)',
        borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100vh',
        position: isDesktop ? 'sticky' : 'fixed', top: 0, left: 0,
      }}
    >
      <div style={{ padding: '26px 24px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
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
            <button key={n.key} onClick={() => go(n.key)} style={navBtnStyle(isActive)}>
              <span style={{ display: 'flex', width: 20, height: 20 }}>{n.icon}</span>
              <span>{n.label}</span>
            </button>
          );
        })}
      </nav>
      <div style={{ padding: '16px 14px', borderTop: '1px solid var(--border)' }}>
        <button onClick={() => go('/settings')} style={navBtnStyle(activeKey === '/settings')}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><SettingsOutlined sx={{ fontSize: 20 }} /></span><span>Настройки</span>
        </button>
        <button onClick={() => go('/help')} style={navBtnStyle(activeKey === '/help')}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><HelpOutlineOutlined sx={{ fontSize: 20 }} /></span><span>Поддержка</span>
        </button>
        <button onClick={handleLogout} style={{ ...navBtnStyle(false), color: '#B07070' }}>
          <span style={{ display: 'flex', width: 20, height: 20 }}><LogoutOutlined sx={{ fontSize: 20 }} /></span><span>{t('nav.logout') || 'Выйти'}</span>
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
              <button onClick={() => setDrawerOpen(true)} style={{ width: 42, height: 42, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
                <MenuOutlined />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 300, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
              {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', letterSpacing: '0.03em', marginTop: 2 }}>{subtitle}</div>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={toggleDark} title="Тема" style={{ width: 42, height: 42, borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', cursor: 'pointer' }}>
              {dark ? <LightModeOutlined sx={{ fontSize: 19 }} /> : <DarkModeOutlined sx={{ fontSize: 19 }} />}
            </button>
            {isDesktop && <LanguageSwitcher variant="buttons" />}
            <NotificationCenter />
            <button onClick={() => navigate('/profile')} style={{ display: 'flex', alignItems: 'center', gap: 11, paddingLeft: 6, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #B8956E, #8B7355)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: 500 }}>
                {(user?.name?.charAt(0) || 'К').toUpperCase()}
              </div>
            </button>
          </div>
        </header>

        {/* SCROLLABLE CONTENT */}
        <main className="screen" style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 48px' }}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default GlassShell;
