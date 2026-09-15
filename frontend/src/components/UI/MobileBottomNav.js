import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, Drawer, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
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
  Forum,
  MoreHoriz,
  ReceiptLong,
  EventNote,
  FolderShared,
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
  messages: Forum,
  more: MoreHoriz,
};

const MORE_ITEMS = [
  { path: '/documents', tKey: 'nav.documents', icon: Description },
  { path: '/payments', tKey: 'nav.payments', icon: ReceiptLong },
  { path: '/deadlines', tKey: 'nav.deadlines', icon: EventNote },
  { path: '/cases', tKey: 'nav.cases', icon: FolderShared },
  { path: '/profile', tKey: 'nav.profile', icon: Person },
];

const MobileBottomNav = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useSelector((state) => state.auth.role);
  const navItems = getMobileNavItems(role);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  const moreActive = MORE_ITEMS.some((item) => isActive(item.path));
  return (<>
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
        const active = item.path === '#more' ? moreActive : isActive(item.path);
        const Icon = ICONS[item.icon];

        return (
          <Box
            component="button"
            key={item.path}
            onClick={() => item.path === '#more' ? setMoreOpen(true) : navigate(item.path)}
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
    {role === 'client' && (
      <Drawer
        anchor="bottom"
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        PaperProps={{ sx: { bgcolor: 'var(--surface)', color: 'var(--text)', borderRadius: '18px 18px 0 0', pb: 'calc(12px + env(safe-area-inset-bottom))' } }}
      >
        <Box sx={{ width: 44, height: 4, borderRadius: 2, bgcolor: 'var(--border-strong)', mx: 'auto', mt: 1.5 }} />
        <Typography variant="h6" sx={{ px: 2.5, pt: 2, pb: 1 }}>{t('nav.more')}</Typography>
        <List aria-label={t('nav.more')}>
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return <ListItemButton key={item.path} selected={isActive(item.path)} onClick={() => { setMoreOpen(false); navigate(item.path); }} sx={{ minHeight: 52, mx: 1, borderRadius: 2 }}>
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}><Icon /></ListItemIcon>
              <ListItemText primary={t(item.tKey)} />
            </ListItemButton>;
          })}
        </List>
      </Drawer>
    )}
  </>
  );
};

export default MobileBottomNav;
