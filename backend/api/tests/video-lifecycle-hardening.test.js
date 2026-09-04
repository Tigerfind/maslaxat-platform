const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');
const { callProviderPolicy } = require('../src/services/callProviderPolicy');
const { recordPeerConnected, hasBilateralPeerEvidence, EVENT_TYPE } = require('../src/services/webrtcEvidenceService');
const { canonicalSocket, hasUserSocket } = require('../src/socket/signaling');
const { extensionPaymentsAvailable } = require('../src/routes/video');

beforeEach(resetDb);

async function fixture(overrides = {}) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const client = await makeClient(`peer-client-${suffix}@test.uz`);
  const { user: lawyer } = await makeLawyer(`peer-lawyer-${suffix}@test.uz`);
  const start = new Date(Date.now() - 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'Peer evidence',
    type: 'video', meetingProvider: 'webrtc', status: 'accepted',
    scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 3600000),
    ...overrides,
  });
  return { client, lawyer, consultation };
}

test('provider gate accepts intentional WebRTC video and normalized audio only', () => {
  expect(callProviderPolicy({ type: 'video', meetingProvider: 'webrtc' })).toMatchObject({ allowed: true, mode: 'video' });
  expect(callProviderPolicy({ type: 'phone', meetingProvider: 'none' })).toMatchObject({ allowed: true, mode: 'audio' });
  expect(callProviderPolicy({ type: 'chat', meetingProvider: 'none' })).toMatchObject({ allowed: false, code: 'CHAT_NOT_CALL' });
  expect(callProviderPolicy({ type: 'video', meetingProvider: 'zoom' })).toMatchObject({ allowed: false, code: 'ZOOM_PROVIDER_REQUIRED' });
  expect(callProviderPolicy({ type: 'video', meetingProvider: 'none' })).toMatchObject({ allowed: false, code: 'UNSUPPORTED_CALL_PROVIDER' });
});

test('paid extension capability fails closed in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  expect(extensionPaymentsAvailable()).toBe(false);
  process.env.NODE_ENV = previous;
});

test('room presence cannot start a call; bilateral peer evidence starts it idempotently', async () => {
  const { client, lawyer, consultation } = await fixture();
  const early = await request(app).post(`/api/video/consultation/${consultation.id}/start`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('PEER_NOT_CONNECTED');

  const clientEvidence = await recordPeerConnected(consultation.id, client.id, { socketId: 'client-a', peerSocketId: 'lawyer-a' });
  expect(clientEvidence.bilateral).toBe(false);
  expect((await consultation.reload()).callStartedAt).toBeNull();
  const lawyerEvidence = await recordPeerConnected(consultation.id, lawyer.id, { socketId: 'lawyer-a', peerSocketId: 'client-a' });
  expect(lawyerEvidence.bilateral).toBe(true);
  expect(lawyerEvidence.started).toBe(true);
  expect((await consultation.reload()).status).toBe('in_progress');
  expect(await hasBilateralPeerEvidence(consultation.id)).toBe(true);

  const duplicate = await recordPeerConnected(consultation.id, lawyer.id, { socketId: 'lawyer-b', peerSocketId: 'client-a' });
  expect(duplicate).toMatchObject({ duplicate: true, started: false, bilateral: true });
  expect(await models.MeetingEvent.count({ where: { consultationId: consultation.id, eventType: EVENT_TYPE } })).toBe(2);
});

test('same-user tabs select one deterministic call socket and disconnect only after the last tab', () => {
  const tabs = [
    { id: 'later', data: { userId: 'client', role: 'client', callJoinedAt: 20 } },
    { id: 'first-b', data: { userId: 'client', role: 'client', callJoinedAt: 10 } },
    { id: 'first-a', data: { userId: 'client', role: 'client', callJoinedAt: 10 } },
  ];
  expect(canonicalSocket(tabs).id).toBe('first-a');
  expect(hasUserSocket(tabs.slice(1), 'client')).toBe(true);
  expect(hasUserSocket([{ id: 'lawyer', data: { userId: 'lawyer', role: 'lawyer' } }], 'client')).toBe(false);
});

test('video REST rejects chat and Zoom with stable provider codes', async () => {
  const chat = await fixture({ type: 'chat', meetingProvider: 'none' });
  const zoom = await fixture({ type: 'video', meetingProvider: 'zoom' });
  const chatResponse = await request(app).get(`/api/video/consultation/${chat.consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(chat.client)}`);
  const zoomResponse = await request(app).get(`/api/video/consultation/${zoom.consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(zoom.client)}`);
  expect(chatResponse.body.code).toBe('CHAT_NOT_CALL');
  expect(zoomResponse.body.code).toBe('ZOOM_PROVIDER_REQUIRED');
});

test('completed end acknowledgement is idempotent only with bilateral evidence', async () => {
  const { client, lawyer, consultation } = await fixture();
  await recordPeerConnected(consultation.id, client.id);
  await recordPeerConnected(consultation.id, lawyer.id);
  await consultation.update({ status: 'completed' });
  const response = await request(app).post(`/api/video/consultation/${consultation.id}/end`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ status: 'completed', alreadyCompleted: true });
});

test('lawyer hangup awaits explicit client confirmation and ignores malicious duration', async () => {
  const startedAt = new Date(Date.now() - 125000);
  const { client, lawyer, consultation } = await fixture({ status: 'in_progress', isFree: true, price: 0, callStartedAt: startedAt });
  await recordPeerConnected(consultation.id, client.id);
  await recordPeerConnected(consultation.id, lawyer.id);
  const lawyerEnd = await request(app).post(`/api/video/consultation/${consultation.id}/end`)
    .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ durationSeconds: 999999, summary: 'Работа завершена' });
  expect(lawyerEnd.status).toBe(200);
  expect(lawyerEnd.body.awaitingClientConfirmation).toBe(true);
  await consultation.reload();
  expect(consultation.status).toBe('in_progress');
  expect(consultation.actualDuration).toBeNull();
  expect(consultation.lawyerEndedAt).toBeTruthy();

  const clientConfirm = await request(app).post(`/api/video/consultation/${consultation.id}/end`)
    .set('Authorization', `Bearer ${tokenFor(client)}`).send({ durationSeconds: 1 });
  expect(clientConfirm.status).toBe(200);
  await consultation.reload();
  expect(consultation.status).toBe('completed');
  expect(consultation.actualDuration).toBeGreaterThanOrEqual(120);
  expect(consultation.actualDuration).toBeLessThan(140);
});

test('direct video access fails closed when payment is not confirmed', async () => {
  const { client, consultation } = await fixture({ price: 100000, isFree: false });
  const response = await request(app).get(`/api/video/consultation/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body.access).toMatchObject({ canJoin: false, reason: 'PAYMENT_REQUIRED' });
  expect(response.body.iceServers).toEqual([]);
});
