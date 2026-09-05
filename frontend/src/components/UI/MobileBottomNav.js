import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  Dashboard,
  Gavel,
  VideoCall,
  Description,
  Person,
  CalendarMonth,
  Insights,
  People,
  AccountBalanceWallet,
  Settings,
} from '@mui/icons-material';
import { useSelector } from 'react-redux';
import { useTranslation } from '../../i18n';
import { getMobileNavItems } from './mobileNavConfig';

const ICONS = {
  dashboard: Dashboard,
  lawyers: Gavel,
  consultations: VideoCall,
  documents: Description,
  profile: Person,
  schedule: CalendarMonth,
  analytics: Insights,
  users: People,
  finance: AccountBalanceWallet,
  settings: Settings,
};

const MobileBottomNav = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useSelector((state) => state.auth.role);
  const navItems = getMobileNavItems(role);

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <Box
      component="nav"
      aria-label={t('nav.mobileNavigation')}
      data-testid="mobile-bottom-nav"
      sx={{
        display: 'flex',
        '@media (min-width:1024px)': { display: 'none' },
        position: 'fixed',
        bottom: 0,
        left: 'env(safe-area-inset-left)',
        right: 'env(safe-area-inset-right)',
        minHeight: 'var(--mobile-bottom-nav-height)',
        height: 'calc(var(--mobile-bottom-nav-height) + env(safe-area-inset-bottom))',
        pb: 'env(safe-area-inset-bottom)',
        bgcolor: 'var(--card-glass)',
        color: 'var(--text2)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        zIndex: 1200,
        justifyContent: 'space-around',
        alignItems: 'center',
        px: 0.5,
        boxShadow: '0 -2px 8px rgba(26, 26, 26, 0.06)',
      }}
    >
      {navItems.map((item) => {
        const active = isActive(item.path);
        const Icon = ICONS[item.icon];

        return (
          <Box
            component="button"
            key={item.path}
            onClick={() => navigate(item.path)}
            aria-label={t(item.tKey)}
            aria-current={active ? 'page' : undefined}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              minWidth: 44,
              minHeight: 44,
              py: 1,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              fontFamily: 'inherit',
              transition: 'all 0.2s ease',
              '-webkit-tap-highlight-color': 'transparent',
            }}
          >
            <Icon
              sx={{
                fontSize: 22,
                color: active ? 'var(--accent)' : 'var(--text3)',
                transition: 'color 0.2s ease',
                mb: 0.25,
              }}
            />
            <Typography
              sx={{
                fontSize: '0.6rem',
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text3)',
                letterSpacing: '0.02em',
                lineHeight: 1,
              }}
            >
              {t(item.tKey)}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
};

export default MobileBottomNav;
