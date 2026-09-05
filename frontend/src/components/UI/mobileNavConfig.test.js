import { getMobileNavItems } from './mobileNavConfig';

describe('mobile navigation by role', () => {
  test.each([
    ['client', ['/dashboard', '/lawyers', '/consultations', '/documents', '/profile']],
    ['lawyer', ['/lawyer/dashboard', '/lawyer/consultations', '/lawyer/schedule', '/lawyer/analytics', '/lawyer/profile/edit']],
    ['admin', ['/admin/dashboard', '/admin/users', '/admin/lawyers', '/admin/finance', '/settings']],
  ])('%s receives the expected five destinations', (role, paths) => {
    expect(getMobileNavItems(role).map((item) => item.path)).toEqual(paths);
  });

  test('unknown roles fall back to client navigation', () => {
    expect(getMobileNavItems('unknown')).toBe(getMobileNavItems('client'));
  });
});
