import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  Dashboard,
  Gavel,
  VideoCall,
  Description,
  Person,
} from '@mui/icons-material';
import { axelionColors } from '../../theme/axelionTheme';
import { useTranslation } from '../../i18n';

const NAV_ITEMS = [
  { path: '/dashboard', tKey: 'nav.dashboard', icon: Dashboard },
  { path: '/lawyers', tKey: 'nav.lawyers', icon: Gavel },
  { path: '/consultations', tKey: 'nav.consultations', icon: VideoCall },
  { path: '/documents', tKey: 'nav.documents', icon: Description },
  { path: '/profile', tKey: 'nav.profile', icon: Person },
];

const MobileBottomNav = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <Box
      sx={{
        display: { xs: 'flex', md: 'none' },
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        bgcolor: axelionColors.bgLight,
        borderTop: `1px solid ${axelionColors.borderLight}`,
        zIndex: 1200,
        justifyContent: 'space-around',
        alignItems: 'center',
        px: 0.5,
        boxShadow: '0 -2px 8px rgba(26, 26, 26, 0.06)',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.path);
        const Icon = item.icon;

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
                color: active ? axelionColors.gold : axelionColors.textMuted,
                transition: 'color 0.2s ease',
                mb: 0.25,
              }}
            />
            <Typography
              sx={{
                fontSize: '0.6rem',
                fontWeight: active ? 600 : 400,
                color: active ? axelionColors.gold : axelionColors.textMuted,
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
