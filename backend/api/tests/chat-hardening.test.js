jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { initSignaling } = require('../src/socket/signaling');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Message, Notification } = models;
const WRITABLE = ['accepted', 'in_progress'];
const READ_ONLY = ['payment_pending', 'payment_expired', 'pending', 'rejected', 'completed', 'cancelled'];

let client;
let lawyer;
let outsider;

const makeConsultation = (status, extra = {}) => Consultation.create({
  clientId: client.id,
  lawyerId: lawyer.id,
  type: 'chat',
  status,
  question: `chat ${status}`,
  ...extra,
});

beforeAll(async () => {
  await resetDb();
  client = await makeClient('chat-hard-client@test.uz');
  ({ user: lawyer } = await makeLawyer('chat-hard-lawyer@test.uz', { greeting: 'Позвоните +998 90 123 45 67' }));
  outsider = await makeClient('chat-hard-outsider@test.uz');
});

test.each(WRITABLE)('REST permits chat writes in %s', async (status) => {
  const consultation = await makeConsultation(status);
  const response = await request(app)
    .post(`/api/chat/${consultation.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ text: 'Мой email client@example.com', clientMessageId: `write-${status}-token` });
  expect(response.status).toBe(201);
  expect(response.body.text).toBe('Мой email ***');
});

test.each(READ_ONLY)('REST rejects chat writes but permits history in %s', async (status) => {
  const consultation = await makeConsultation(status);
  const write = await request(app)
    .post(`/api/chat/${consultation.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ text: 'blocked', clientMessageId: `blocked-${status}` });
  expect(write.status).toBe(409);
  expect(write.body.code).toBe('CONSULTATION_READ_ONLY');
  expect((await request(app).get(`/api/chat/${consultation.id}/messages`).set('Authorization', `Bearer ${tokenFor(client)}`)).status).toBe(200);
});

test('archived accepted consultation is read-only', async () => {
  const consultation = await makeConsultation('accepted', { archivedAt: new Date() });
  const response = await request(app)
    .post(`/api/chat/${consultation.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ text: 'blocked', clientMessageId: 'archived-message-token' });
  expect(response.status).toBe(409);
});

test('read-only history read never creates an automatic greeting', async () => {
  for (const state of [
    { status: 'payment_pending' }, { status: 'payment_expired' }, { status: 'pending' },
    { status: 'rejected' }, { status: 'completed' }, { status: 'cancelled' },
    { status: 'accepted', archivedAt: new Date() },
  ]) {
    const consultation = await makeConsultation(state.status, state);
    const response = await request(app)
      .get(`/api/chat/${consultation.id}/messages`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ messages: [], nextCursor: null, hasMore: false });
    expect(await Message.count({ where: { consultationId: consultation.id } })).toBe(0);
  }
});

test('concurrent REST retry creates one message and one notification', async () => {
  const consultation = await makeConsultation('accepted');
  const notificationsBefore = await Notification.count({ where: { userId: lawyer.id, type: 'chat_message' } });
  const path = `/api/chat/${consultation.id}/messages`;
  const send = () => request(app).post(path).set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ text: 'один раз', clientMessageId: 'same-retry-token' });
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((item) => item.status).sort()).toEqual([200, 201]);
  expect(await Message.count({ where: { consultationId: consultation.id, clientMessageId: 'same-retry-token' } })).toBe(1);
  expect(await Notification.count({ where: { userId: lawyer.id, type: 'chat_message' } })).toBe(notificationsBefore + 1);
});

test('REST outsider is denied and invalid clientMessageId is rejected', async () => {
  const consultation = await makeConsultation('accepted');
  const outsiderResponse = await request(app).post(`/api/chat/${consultation.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`).send({ text: 'no', clientMessageId: 'outsider-token' });
  expect(outsiderResponse.status).toBe(403);
  expect((await request(app).get(`/api/chat/${consultation.id}/messages`).set('Authorization', `Bearer ${tokenFor(outsider)}`)).status).toBe(403);
  const invalid = await request(app).post(`/api/chat/${consultation.id}/messages`)
    .set('Authorization', `Bearer ${tokenFor(client)}`).send({ text: 'no', clientMessageId: 'x' });
  expect(invalid.status).toBe(400);
  expect(invalid.body.code).toBe('INVALID_CLIENT_MESSAGE_ID');
});

test('history uses a bounded stable cursor envelope and marks incoming messages read', async () => {
  const consultation = await makeConsultation('accepted');
  const base = Date.now() - 10000;
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    rows.push(await Message.create({
      consultationId: consultation.id,
      senderId: index % 2 ? client.id : lawyer.id,
      text: `message-${index}`,
      isRead: false,
      createdAt: new Date(base + index * 1000),
      updatedAt: new Date(base + index * 1000),
    }));
  }
  const auth = `Bearer ${tokenFor(client)}`;
  const recent = await request(app).get(`/api/chat/${consultation.id}/messages?limit=2`).set('Authorization', auth);
  expect(recent.status).toBe(200);
  expect(recent.body.messages.map((message) => message.text)).toEqual(['message-3', 'message-4']);
  expect(recent.body).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
  const earlier = await request(app).get(`/api/chat/${consultation.id}/messages?limit=2&cursor=${encodeURIComponent(recent.body.nextCursor)}`).set('Authorization', auth);
  expect(earlier.body.messages.map((message) => message.text)).toEqual(['message-1', 'message-2']);
  expect(new Set([...recent.body.messages, ...earlier.body.messages].map((message) => message.id)).size).toBe(4);
  expect(await Message.count({ where: { consultationId: consultation.id, senderId: lawyer.id, isRead: false } })).toBe(0);
  expect(rows).toHaveLength(5);
});

function socketHarness(user) {
  const handlers = {};
  const roomEmit = jest.fn();
  const peerEmit = jest.fn();
  let connectionHandler;
  const io = {
    use: jest.fn(),
    on: jest.fn((event, handler) => { if (event === 'connection') connectionHandler = handler; }),
    emit: jest.fn(),
    in: jest.fn(() => ({ emit: roomEmit, fetchSockets: jest.fn().mockResolvedValue([]) })),
    to: jest.fn(() => ({ emit: jest.fn() })),
    sockets: { sockets: new Map() },
  };
  initSignaling(io);
  const socket = {
    id: `socket-${user.id}`,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    userAvatar: null,
    data: { userId: user.id, userRole: user.role, publicPresence: false },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: peerEmit })),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
  };
  connectionHandler(socket);
  return { socket, handlers, roomEmit, peerEmit };
}

test('socket send acknowledgement denies outsider with a stable code', async () => {
  const consultation = await makeConsultation('accepted');
  const { handlers } = socketHarness(outsider);
  const ack = jest.fn();
  await handlers['send-message']({ consultationId: consultation.id, text: 'no', clientMessageId: 'socket-outsider' }, ack);
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'ACCESS_DENIED' }));
  expect(await Message.count({ where: { consultationId: consultation.id } })).toBe(0);
});

test('socket retry acknowledges the existing message and emits once', async () => {
  const consultation = await makeConsultation('accepted');
  const { handlers, roomEmit } = socketHarness(client);
  const payload = { consultationId: consultation.id, text: 'retry', clientMessageId: 'socket-retry-token' };
  const firstAck = jest.fn();
  const retryAck = jest.fn();
  await handlers['send-message'](payload, firstAck);
  await handlers['send-message'](payload, retryAck);
  expect(firstAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true, duplicate: false }));
  expect(retryAck).toHaveBeenCalledWith(expect.objectContaining({ ok: true, duplicate: true }));
  expect(roomEmit).toHaveBeenCalledTimes(1);
});

test('typing is relayed only while participant consultation is writable', async () => {
  const consultation = await makeConsultation('accepted');
  const { handlers, peerEmit } = socketHarness(client);
  await handlers['join-chat']({ consultationId: consultation.id });
  await handlers.typing({ consultationId: consultation.id });
  expect(peerEmit).toHaveBeenCalledWith('user-typing', expect.objectContaining({ userId: client.id }));
  peerEmit.mockClear();
  await consultation.update({ status: 'completed' });
  await handlers.typing({ consultationId: consultation.id });
  expect(peerEmit).not.toHaveBeenCalled();

  const outsiderSocket = socketHarness(outsider);
  await outsiderSocket.handlers['join-chat']({ consultationId: consultation.id });
  await outsiderSocket.handlers.typing({ consultationId: consultation.id });
  expect(outsiderSocket.peerEmit).not.toHaveBeenCalled();
});
