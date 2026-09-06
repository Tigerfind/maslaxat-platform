const request = require('supertest');
const app = require('../src/server');
const { resetDb, makeLawyer } = require('./helpers');
const presence = require('../src/services/presenceService');

beforeEach(async () => {
  presence.resetForTests();
  await resetDb();
});

test('multi-tab остаётся online до отключения последнего socket', () => {
  const first = { id: 'socket-1', data: { userId: 'lawyer-1', userRole: 'lawyer' } };
  const second = { id: 'socket-2', data: { userId: 'lawyer-1', userRole: 'lawyer' } };
  expect(presence.registerSocket(first)).toBe(true);
  expect(presence.registerSocket(second)).toBe(false);
  expect(presence.unregisterSocket(first)).toBeNull();
  expect(presence.getPresence('lawyer-1').online).toBe(true);
  const offline = presence.unregisterSocket(second);
  expect(offline.online).toBe(false);
  expect(offline.lastSeenAt).toBeTruthy();
});

test('snapshot остаётся согласованным при disconnect во время HTTP-запроса', async () => {
  const socket = { id: 'snapshot-socket', data: { userId: 'lawyer-1', userRole: 'lawyer' } };
  presence.registerSocket(socket);
  const snapshot = await presence.getSnapshot('lawyer');
  presence.unregisterSocket(socket);
  expect(presence.getPresenceFromSnapshot('lawyer-1', snapshot).online).toBe(true);
  expect(presence.getPresence('lawyer-1').online).toBe(false);
});

test('onlineOnly использует socket presence, а не isAvailable', async () => {
  const online = await makeLawyer('online-presence@test.uz', { isAvailable: false });
  const bookableOffline = await makeLawyer('bookable-offline@test.uz', { isAvailable: true });
  presence.registerSocket({ id: 'online-socket', data: { userId: online.user.id, userRole: 'lawyer' } });

  const response = await request(app).get('/api/lawyers?onlineOnly=true');
  expect(response.status).toBe(200);
  expect(response.body.lawyers.map((lawyer) => lawyer.id)).toEqual([online.user.id]);
  expect(response.body.lawyers[0].profile.isAvailable).toBe(false);
  expect(response.body.lawyers[0].presence.online).toBe(true);
  expect(response.body.lawyers.some((lawyer) => lawyer.id === bookableOffline.user.id)).toBe(false);
  expect(response.body.facets.online).toBe(1);
});

test('online sockets сортируются выше offline независимо от booking availability', async () => {
  const online = await makeLawyer('online-sort@test.uz', { isAvailable: false, location: 'PresenceCity' });
  const offline = await makeLawyer('offline-sort@test.uz', { isAvailable: true, location: 'PresenceCity' });
  presence.registerSocket({ id: 'sort-socket', data: { userId: online.user.id, userRole: 'lawyer' } });

  const response = await request(app).get('/api/lawyers?location=PresenceCity');
  expect(response.status).toBe(200);
  expect(response.body.lawyers.map((lawyer) => lawyer.id)).toEqual([online.user.id, offline.user.id]);
});

test('публичный профиль возвращает presence snapshot', async () => {
  const { user } = await makeLawyer('presence-profile@test.uz');
  const response = await request(app).get(`/api/lawyers/${user.id}`);
  expect(response.status).toBe(200);
  expect(response.body.lawyer.presence).toMatchObject({ online: false, lastSeenAt: null });
});
