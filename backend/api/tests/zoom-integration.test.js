const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/server');
const secretBox = require('../src/services/secretBox');
const zoomMeetingService = require('../src/services/zoomMeetingService');
const zoomConnectionService = require('../src/services/zoomConnectionService');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const originalFetch = global.fetch;
beforeAll(() => {
  process.env.ZOOM_CLIENT_ID = 'zoom-client';
  process.env.ZOOM_CLIENT_SECRET = 'zoom-secret';
  process.env.ZOOM_REDIRECT_URI = 'http://localhost/api/zoom/oauth/callback';
  process.env.ZOOM_WEBHOOK_SECRET = 'zoom-webhook-secret';
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});
beforeEach(async () => { await resetDb(); global.fetch = jest.fn(); });
afterAll(() => { global.fetch = originalFetch; });

async function connectionFor(lawyerId) {
  return models.ZoomConnection.create({
    userId: lawyerId, zoomUserId: `zoom-${lawyerId}`, zoomEmail: 'zoom@test.uz',
    accessTokenEncrypted: secretBox.encrypt('access-token', `zoom:${lawyerId}:access`),
    refreshTokenEncrypted: secretBox.encrypt('refresh-token', `zoom:${lawyerId}:refresh`),
    tokenExpiresAt: new Date(Date.now() + 3600000), status: 'connected',
  });
}

function signedWebhook(payload, requestId) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `v0=${crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  return request(app).post('/api/zoom/webhook')
    .set('Content-Type', 'application/json')
    .set('x-zm-request-id', requestId)
    .set('x-zm-request-timestamp', timestamp)
    .set('x-zm-signature', signature)
    .send(body);
}

test('создаёт Zoom meeting идемпотентно для принятой бесплатной консультации', async () => {
  const client = await makeClient('zoom-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-lawyer@test.uz');
  await connectionFor(lawyer.id);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom',
    status: 'accepted', question: 'Zoom', duration: 60, isFree: true,
    scheduledStartAt: new Date(Date.now() + 3600000), scheduledEndAt: new Date(Date.now() + 7200000), scheduleTimezone: 'Asia/Tashkent',
  });
  global.fetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 12345, join_url: 'https://zoom.us/join/client', start_url: 'https://zoom.us/start/host', password: 'pass' }) });
  const [first, second] = await Promise.all([zoomMeetingService.maybeProvision(consultation.id), zoomMeetingService.maybeProvision(consultation.id)]);
  expect(first || second).toBeTruthy();
  expect(await models.ConsultationMeeting.count({ where: { consultationId: consultation.id } })).toBe(1);
  const meeting = await models.ConsultationMeeting.findOne({ where: { consultationId: consultation.id } });
  expect(meeting.status).toBe('ready');
  expect(meeting.joinUrlEncrypted).not.toContain('zoom.us');
});

test('start_url доступен только юристу, join_url только клиенту, outsider запрещён', async () => {
  const client = await makeClient('zoom-access-client@test.uz');
  const outsider = await makeClient('zoom-access-outsider@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-access-lawyer@test.uz');
  const connection = await connectionFor(lawyer.id);
  const start = new Date(Date.now() + 5 * 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted',
    question: 'Zoom access', duration: 60, scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 3600000), scheduleTimezone: 'Asia/Tashkent',
  });
  const meeting = await models.ConsultationMeeting.create({ consultationId: consultation.id, zoomConnectionId: connection.id, provider: 'zoom', externalMeetingId: 'meeting-1', status: 'ready' });
  await meeting.update({ joinUrlEncrypted: secretBox.encrypt('https://zoom.us/join/client', `meeting:${meeting.id}:join`) });
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ start_url: 'https://zoom.us/start/host' }) });

  const clientResponse = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', `Bearer ${tokenFor(client)}`);
  const lawyerResponse = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', `Bearer ${tokenFor(lawyer)}`);
  const denied = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', `Bearer ${tokenFor(outsider)}`);
  expect(clientResponse.body).toEqual({ role: 'client', url: 'https://zoom.us/join/client' });
  expect(lawyerResponse.body).toEqual({ role: 'lawyer', url: 'https://zoom.us/start/host' });
  expect(clientResponse.body.url).not.toContain('/start/');
  expect(denied.status).toBe(403);
  expect(clientResponse.headers['cache-control']).toBe('no-store');
});

test('Zoom webhook проверяет подпись и обновляет meeting status', async () => {
  const client = await makeClient('zoom-webhook-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-webhook-lawyer@test.uz');
  const connection = await connectionFor(lawyer.id);
  const start = new Date(Date.now() - 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted',
    question: 'Webhook lifecycle', duration: 60, isFree: true, scheduledStartAt: start,
    scheduledEndAt: new Date(start.getTime() + 3600000), scheduleTimezone: 'Asia/Tashkent',
  });
  const meeting = await models.ConsultationMeeting.create({
    consultationId: consultation.id, zoomConnectionId: connection.id, provider: 'zoom',
    externalMeetingId: 'webhook-meeting', status: 'ready',
  });
  await meeting.update({ joinUrlEncrypted: secretBox.encrypt('https://zoom.us/join/client', `meeting:${meeting.id}:join`) });
  const startedPayload = { event: 'meeting.started', payload: { object: { id: 'webhook-meeting' } } };
  const response = await signedWebhook(startedPayload, 'zoom-request-1');
  expect(response.status).toBe(204);
  await meeting.reload();
  expect(meeting.status).toBe('started');
  await consultation.reload();
  expect(consultation.status).toBe('accepted');
  expect(consultation.callStartedAt).toBeNull();

  const access = await request(app).post(`/api/zoom/consultations/${consultation.id}/access`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(access.body.url).toBe('https://zoom.us/join/client');

  const replay = await signedWebhook(startedPayload, 'zoom-request-1');
  expect(replay.status).toBe(204);
  expect(await models.ZoomWebhookEvent.count()).toBe(1);

  const ended = await signedWebhook({ event: 'meeting.ended', payload: { object: { id: 'webhook-meeting' } } }, 'zoom-request-2');
  expect(ended.status).toBe(204);
  await consultation.reload();
  expect(consultation.status).toBe('accepted');

  const bad = await request(app).post('/api/zoom/webhook').set('Content-Type', 'application/json').set('x-zm-request-id', 'zoom-request-bad').set('x-zm-request-timestamp', String(Math.floor(Date.now() / 1000))).set('x-zm-signature', 'bad').send(JSON.stringify(startedPayload));
  expect(bad.status).toBe(401);
});

test('ручное отключение блокируется при будущей встрече, deauthorization включает fallback', async () => {
  const client = await makeClient('zoom-disconnect-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-disconnect-lawyer@test.uz');
  const connection = await connectionFor(lawyer.id);
  const start = new Date(Date.now() + 3600000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted',
    question: 'Disconnect', duration: 60, isFree: true, scheduledStartAt: start,
    scheduledEndAt: new Date(start.getTime() + 3600000), scheduleTimezone: 'Asia/Tashkent',
  });
  const meeting = await models.ConsultationMeeting.create({
    consultationId: consultation.id, zoomConnectionId: connection.id, provider: 'zoom',
    externalMeetingId: 'disconnect-meeting', status: 'ready',
  });
  global.fetch.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });

  const response = await request(app).delete('/api/zoom/connection').set('Authorization', `Bearer ${tokenFor(lawyer)}`);
  expect(response.status).toBe(409);
  await consultation.reload();
  expect(consultation.meetingProvider).toBe('zoom');

  const result = await zoomConnectionService.disconnect(lawyer.id, { allowFallback: true, revokeRemote: false, reason: 'app_deauthorized' });
  expect(result.affectedConsultations).toBe(1);
  await Promise.all([consultation.reload(), meeting.reload(), connection.reload()]);
  expect(consultation.meetingProvider).toBe('webrtc');
  expect(meeting.status).toBe('cancelled');
  expect(connection.status).toBe('revoked');
  expect(connection.accessTokenEncrypted).toBe('');
});

test('failed webhook можно безопасно обработать повторно с тем же request id', async () => {
  const client = await makeClient('zoom-retry-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-retry-lawyer@test.uz');
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted',
    question: 'Webhook retry', duration: 60, isFree: true,
  });
  const meeting = await models.ConsultationMeeting.create({
    consultationId: consultation.id, provider: 'zoom', externalMeetingId: 'retry-meeting', status: 'ready',
  });
  const update = jest.spyOn(models.ConsultationMeeting.prototype, 'update').mockRejectedValueOnce(new Error('temporary db error'));
  const payload = { event: 'meeting.started', payload: { object: { id: 'retry-meeting' } } };
  expect((await signedWebhook(payload, 'zoom-request-retry')).status).toBe(500);
  expect((await models.ZoomWebhookEvent.findOne({ where: { requestId: 'zoom-request-retry' } })).status).toBe('failed');
  update.mockRestore();
  expect((await signedWebhook(payload, 'zoom-request-retry')).status).toBe(204);
  await meeting.reload();
  expect(meeting.status).toBe('started');
  expect((await models.ZoomWebhookEvent.findOne({ where: { requestId: 'zoom-request-retry' } })).status).toBe('processed');
});

test('reconciliation находит уже созданную Zoom-встречу и не создаёт дубль после DB-сбоя', async () => {
  const client = await makeClient('zoom-reconcile-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-reconcile-lawyer@test.uz');
  await connectionFor(lawyer.id);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'accepted',
    question: 'Reconcile create', duration: 60, isFree: true,
    scheduledStartAt: new Date(Date.now() + 3600000), scheduledEndAt: new Date(Date.now() + 7200000),
    scheduleTimezone: 'Asia/Tashkent',
  });
  const remote = {
    id: 777, agenda: `emaslaxat:${consultation.id}`, join_url: 'https://zoom.us/join/777',
    start_url: 'https://zoom.us/start/777', password: 'pass',
  };
  global.fetch
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ meetings: [] }) })
    .mockResolvedValueOnce({ ok: true, status: 201, json: async () => remote });
  const update = jest.spyOn(models.ConsultationMeeting.prototype, 'update').mockRejectedValueOnce(new Error('temporary local write failure'));
  await expect(zoomMeetingService.maybeProvision(consultation.id)).rejects.toThrow('temporary local write failure');
  update.mockRestore();

  global.fetch.mockReset()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ meetings: [remote] }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => remote });
  expect(await zoomMeetingService.reconcilePendingMeetings()).toBe(1);
  const meeting = await models.ConsultationMeeting.findOne({ where: { consultationId: consultation.id } });
  expect(meeting.status).toBe('ready');
  expect(global.fetch.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});

test('reconciliation повторяет неудавшееся удаление Zoom-встречи', async () => {
  const client = await makeClient('zoom-cancel-retry-client@test.uz');
  const { user: lawyer } = await makeLawyer('zoom-cancel-retry-lawyer@test.uz');
  const connection = await connectionFor(lawyer.id);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, type: 'video', meetingProvider: 'zoom', status: 'cancelled',
    question: 'Reconcile cancel', duration: 60, isFree: true,
  });
  const meeting = await models.ConsultationMeeting.create({
    consultationId: consultation.id, zoomConnectionId: connection.id, provider: 'zoom',
    externalMeetingId: 'cancel-retry', status: 'ready',
  });
  global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
  await zoomMeetingService.cancelMeeting(consultation.id);
  await meeting.reload();
  expect(meeting.status).toBe('cancellation_pending');

  global.fetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
  expect(await zoomMeetingService.reconcilePendingMeetings()).toBe(1);
  await meeting.reload();
  expect(meeting.status).toBe('cancelled');
});
