import { NAV } from './GlassShell';

test('client desktop navigation contains the eight cabinet destinations in order', () => {
  expect(NAV.client.map((item) => item.key)).toEqual([
    '/dashboard', '/consultations', '/my-lawyers', '/documents',
    '/payments', '/messages', '/deadlines', '/cases',
  ]);
});
