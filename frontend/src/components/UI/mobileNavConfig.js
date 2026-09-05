export const MOBILE_NAV_ITEMS = {
  client: [
    { path: '/dashboard', tKey: 'nav.dashboard', icon: 'dashboard' },
    { path: '/lawyers', tKey: 'nav.lawyers', icon: 'lawyers' },
    { path: '/consultations', tKey: 'nav.consultations', icon: 'consultations' },
    { path: '/documents', tKey: 'nav.documents', icon: 'documents' },
    { path: '/profile', tKey: 'nav.profile', icon: 'profile' },
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
