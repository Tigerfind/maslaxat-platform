const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/server');
const secretBox = require('../src/services/secretBox');
const { resetDb, models, makeClient, makeLawyer, makeAdmin, tokenFor } = require('./helpers');

const originalFetch = global.fetch;
beforeAll(() => {
  process.env.ZOOM_CLIENT_ID = 'meeting-sdk-client';
  process.env.ZOOM_CLIENT_SECRET = 'meeting-sdk-secret';
  process.env.ZOOM_REDIRECT_URI = 'http://localhost/zoom';
  process.env.ZOOM_MEETING_SDK_ENABLED = '1';
  process.env.MEETING_PARTICIPANT_SECRET = 'test-participant-secret-32-bytes';
  process.env.ZOOM_WEBHOOK_SECRET = 'test-zoom-webhook-secret';
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
});
beforeEach(async () => { await resetDb(); global.fetch = jest.fn(); });
afterAll(() => { global.fetch = originalFetch; });

async function fixture(offsetMinutes = 5) {
  const client = await makeClient(`sdk-client-${offsetMinutes}@test.uz`);
  const outsider = await makeClient(`sdk-outsider-${offsetMinutes}@test.uz`);
  const { user: lawyer } = await makeLawyer(`sdk-lawyer-${offsetMinutes}@test.uz`);
  const connection = await models.ZoomConnection.create({
    userId: lawyer.id, zoomUserId: `zoom-${lawyer.id}`,
    accessTokenEncrypted: secretBox.encrypt('access', `zoom:${lawyer.id}:access`),
    refreshTokenEncrypted: secretBox.encrypt('refresh', `zoom:${lawyer.id}:refresh`),
    tokenExpiresAt: new Date(Date.now() + 3600000), status: 'connected',
  });
  const start = new Date(Date.now() + offsetMinutes * 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'SDK', type: 'video', meetingProvider: 'zoom',
    status: 'accepted', lifecycleStatus: 'ready', isFree: true, duration: 60,
    scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 3600000), scheduleTimezone: 'Asia/Tashkent',
  });
  const meeting = await models.ConsultationMeeting.create({ consultationId: consultation.id, zoomConnectionId: connection.id, provider: 'zoom', externalMeetingId: '987654321', status: 'ready' });
  await meeting.update({ passcodeEncrypted: secretBox.encrypt('pass', `meeting:${meeting.id}:passcode`), joinUrlEncrypted: secretBox.encrypt('https://zoom.us/j/987654321', `meeting:${meeting.id}:join`) });
  return { client, outsider, lawyer, consultation };
}

test('client получает role 0 signature без ZAK и без секретных URL', async () => {
  const { client, outsider, consultation } = await fixture();
  const response = await request(app).post(`/api/zoom/consultations/${consultation.id}/sdk-access`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body).not.toHaveProperty('url');
  expect(response.body).not.toHaveProperty('zak');
  expect(jwt.verify(response.body.signature, process.env.ZOOM_CLIENT_SECRET)).toMatchObject({ mn: '987654321', role: 0, appKey: 'meeting-sdk-client' });
  expect((await request(app).post(`/api/zoom/consultations/${consultation.id}/sdk-access`).set('Authorization', `Bearer ${tokenFor(outsider)}`)).status).toBe(403);
});

test('lawyer получает host signature и свежий ZAK только в разрешённом окне', async () => {
  const { lawyer, consultation } = await fixture();
  global.fetch.mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ token: 'short-lived-zak' }) });
  const response = await request(app).post(`/api/zoom/consultations/${consultation.id}/sdk-access`).set('Authorization', `Bearer ${tokenFor(lawyer)}`);
  expect(response.status).toBe(200);
  expect(response.body.zak).toBe('short-lived-zak');
  expect(jwt.verify(response.body.signature, process.env.ZOOM_CLIENT_SECRET).role).toBe(1);
});

test('equipment preflight доступен заранее, но join остаётся закрыт до десяти минут', async () => {
  const { client, consultation } = await fixture(60);
  const preflight = await request(app).get(`/api/zoom/consultations/${consultation.id}/preflight`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(preflight.status).toBe(200);
  expect(preflight.body.access).toMatchObject({ canJoin: false, reason: 'TOO_EARLY' });
  expect((await request(app).post(`/api/zoom/consultations/${consultation.id}/sdk-access`).set('Authorization', `Bearer ${tokenFor(client)}`)).status).toBe(403);
});

test('admin diagnostics не раскрывает encrypted URL или OAuth tokens', async () => {
  const { consultation } = await fixture();
  const admin = await makeAdmin('zoom-diagnostics-admin@test.uz');
  const response = await request(app).get(`/api/admin/consultations/${consultation.id}/meeting-diagnostics`).set('Authorization', `Bearer ${tokenFor(admin)}`);
  expect(response.status).toBe(200);
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.toContain('joinUrlEncrypted');
  expect(serialized).not.toContain('accessTokenEncrypted');
  expect(serialized).not.toContain('https://zoom.us');
});

test('client не может подтвердить платную Zoom-консультацию без attendance evidence', async () => {
  const { client, consultation } = await fixture(-5);
  const response = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('ATTENDANCE_UNVERIFIED');
});

test('meeting.started и external access не заменяют подтверждённую посещаемость обоих участников', async () => {
  const { client, consultation } = await fixture(-5);
  const meeting = await models.ConsultationMeeting.findOne({ where: { consultationId: consultation.id } });
  await meeting.update({ status: 'started', startedAt: new Date() });
  const access = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(access.status).toBe(200);
  const completed = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(completed.status).toBe(409);
  expect(completed.body.code).toBe('ATTENDANCE_UNVERIFIED');
  await consultation.reload();
  expect(consultation.status).toBe('accepted');
});

test.each(['no_show_client', 'no_show_lawyer', 'no_show_both'])('all direct Zoom access paths deny %s', async (lifecycleStatus) => {
  const { client, consultation } = await fixture(-5);
  await consultation.update({ lifecycleStatus, noShowCheckedAt: new Date() });
  const auth = `Bearer ${tokenFor(client)}`;
  const preflight = await request(app).get(`/api/zoom/consultations/${consultation.id}/preflight`).set('Authorization', auth);
  const external = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', auth);
  const sdk = await request(app).post(`/api/zoom/consultations/${consultation.id}/sdk-access`).set('Authorization', auth);
  expect(preflight.body.access.canJoin).toBe(false);
  expect(preflight.body.access.reason).toBe(lifecycleStatus === 'no_show_both' ? 'BOTH_NO_SHOW' : lifecycleStatus === 'no_show_lawyer' ? 'LAWYER_NO_SHOW' : 'CLIENT_NO_SHOW');
  expect(external.status).toBe(409);
  expect(sdk.status).toBe(409);
});

test('preflight returns authoritative configurable grace deadline', async () => {
  const { client, consultation } = await fixture(-5);
  const response = await request(app).get(`/api/zoom/consultations/${consultation.id}/preflight`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(new Date(response.body.graceEndsAt).getTime() - new Date(response.body.scheduledEndAt).getTime())
    .toBe(require('../src/services/consultationAccessService').GRACE_MINUTES * 60000);
  expect(response.body.joinExpiresAt).toBe(response.body.graceEndsAt);
});
