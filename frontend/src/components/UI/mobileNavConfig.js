export const MOBILE_NAV_ITEMS = {
  client: [
    { path: '/dashboard', tKey: 'nav.overview', icon: 'dashboard' },
    { path: '/consultations', tKey: 'nav.consultations', icon: 'consultations' },
    { path: '/my-lawyers', tKey: 'nav.myLawyers', icon: 'lawyers' },
    { path: '/messages', tKey: 'nav.messages', icon: 'messages' },
    { path: '#more', tKey: 'nav.more', icon: 'more' },
  ],
  lawyer: [
    { path: '/lawyer/dashboard', tKey: 'nav.dashboard', icon: 'dashboard' },
    { path: '/lawyer/consultations', tKey: 'nav.consultations', icon: 'consultations' },
    { path: '/lawyer/schedule', tKey: 'nav.schedule', icon: 'schedule' },
    { path: '/lawyer/analytics', tKey: 'nav.analytics', icon: 'analytics' },
    { path: '/lawyer/profile/edit', tKey: 'nav.profile', icon: 'profile' },
  ],
  admin: [
    { path: '/admin/dashboard', tKey: 'nav.dashboard', icon: 'dashboard' },
    { path: '/admin/users', tKey: 'admin.manageUsers', icon: 'users' },
    { path: '/admin/lawyers', tKey: 'admin.manageLawyers', icon: 'lawyers' },
    { path: '/admin/finance', tKey: 'adminFinance.title', icon: 'finance' },
    { path: '/settings', tKey: 'nav.settings', icon: 'settings' },
  ],
};

export const getMobileNavItems = (role) => MOBILE_NAV_ITEMS[role] || MOBILE_NAV_ITEMS.client;
