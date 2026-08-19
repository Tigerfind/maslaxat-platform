jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../src/server');
const logger = require('../src/config/logger');
const { initSignaling } = require('../src/socket/signaling');
const {
  resetDb,
  tokenFor,
  makeMember,
  makeApplicant,
  makeApprovedOperator,
  makeSuspendedOperator,
  makeAdmin,
  models,
} = require('./helpers');

const {
  Consultation,
  LawyerProfile,
  Message,
  Payment,
  SupportTicket,
} = models;

const headersFor = (user, mode, authLevel = 'primary') => ({
  Authorization: `Bearer ${tokenFor(user, authLevel)}`,
  'X-Maslaxat-Mode': mode,
});

async function consultation(clientId, lawyerId, status = 'accepted') {
  return Consultation.create({
    clientId,
    lawyerId,
    question: 'Round one authorization',
    problems: [{ text: 'Round one authorization', categories: [] }],
    status,
    price: 1000,
    commissionRateBps: 0,
    grossAmountTiyin: 100000,
    lawyerNetAmountTiyin: 100000,
  });
}

function signalingHarness(reportException) {
  let middleware;
  let onConnection;
  const io = {
    use: jest.fn((handler) => { middleware = handler; }),
    on: jest.fn((event, handler) => { if (event === 'connection') onConnection = handler; }),
    in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([]), emit: jest.fn() })),
    to: jest.fn(() => ({ emit: jest.fn() })),
    sockets: { sockets: new Map() },
  };
  initSignaling(io, { reportException });
  return { io, middleware, onConnection };
}

test('socket handler reports swallowed failures with event and operational IDs only', async () => {
  await resetDb();
  const member = await makeMember('socket-report@test.uz');
  const reportException = jest.fn();
  const harness = signalingHarness(reportException);
  const socket = await connect(harness, member, 'client');
  const error = new Error('private socket/provider payload');
  jest.spyOn(Consultation, 'findByPk').mockRejectedValueOnce(error);

  await socket.handlers['join-room']({ consultationId: 'consultation-42' });

  expect(reportException).toHaveBeenCalledWith(error, {
    operation: 'socket_event',
    event: 'join-room',
    consultationId: 'consultation-42',
    userId: member.id,
  });
});

function fakeSocket(token, mode) {
  const handlers = {};
  const rooms = new Set();
  return {
    id: `socket-${Math.random()}`,
    handshake: { auth: { token, mode } },
    rooms,
    join: jest.fn((room) => rooms.add(room)),
    leave: jest.fn((room) => rooms.delete(room)),
    disconnect: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    handlers,
  };
}

const runHandshake = (middleware, socket) => new Promise((resolve) => {
  middleware(socket, (error) => resolve(error || null));
});

async function connect(harness, user, mode, authLevel = 'primary') {
  const socket = fakeSocket(tokenFor(user, authLevel), mode);
  expect(await runHandshake(harness.middleware, socket)).toBeNull();
  harness.onConnection(socket);
  return socket;
}

describe('FixRound1 participant perspective routes', () => {
  beforeEach(resetDb);

  test('suspended lawyer cannot release escrow through client-mode video end on the lawyer side', async () => {
    const client = await makeMember('round1-video-client@test.uz');
    const { user, lp } = await makeSuspendedOperator('round1-video-suspended@test.uz', {
      pendingBalance: 1000,
    });
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id, 'in_progress');
    const payment = await Payment.create({
      userId: client.id,
      consultationId: session.id,
      purpose: 'consultation',
      amount: 1000,
      amountTiyin: 100000,
      currency: 'UZS',
      provider: 'payme',
      status: 'paid',
      escrowReleased: false,
    });

    const response = await request(app)
      .post(`/api/video/consultation/${session.id}/end`)
      .set(headersFor(user, 'client', 'mfa'))
      .send({ durationSeconds: 600 });
    await Promise.all([session.reload(), payment.reload(), lp.reload()]);

    expect(response.status).toBe(403);
    expect(session.status).toBe('in_progress');
    expect(payment.escrowReleased).toBe(false);
    expect(Number(lp.pendingBalance)).toBe(1000);
    expect(Number(lp.balance)).toBe(0);
  });

  test('client mode cannot use chat or case documents from the lawyer side', async () => {
    const client = await makeMember('round1-artifact-client@test.uz');
    const { user } = await makeSuspendedOperator('round1-artifact-suspended@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const auth = headersFor(user, 'client', 'mfa');

    const [chatRead, chatSend, documents] = await Promise.all([
      request(app).get(`/api/chat/${session.id}/messages`).set(auth),
      request(app).post(`/api/chat/${session.id}/messages`).set(auth).send({ text: 'bypass' }),
      request(app).get(`/api/consultations/${session.id}/documents`).set(auth),
    ]);

    expect([chatRead.status, chatSend.status, documents.status]).toEqual([403, 403, 403]);
    expect(await Message.count({ where: { consultationId: session.id } })).toBe(0);
  });

  test('applicant lawyer mode cannot use participant video, chat, or case-document routes', async () => {
    const client = await makeMember('round1-applicant-client@test.uz');
    const { user } = await makeApplicant('round1-applicant@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const auth = headersFor(user, 'lawyer', 'mfa');

    const responses = await Promise.all([
      request(app).get(`/api/video/consultation/${session.id}`).set(auth),
      request(app).get(`/api/chat/${session.id}/messages`).set(auth),
      request(app).get(`/api/consultations/${session.id}/documents`).set(auth),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  test('suspended lawyer remains a valid client participant in explicit client mode', async () => {
    const { user } = await makeSuspendedOperator('round1-genuine-client@test.uz');
    const { user: lawyer } = await makeApprovedOperator('round1-genuine-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(user.id, lawyer.id);
    const auth = headersFor(user, 'client', 'mfa');

    const responses = await Promise.all([
      request(app).get(`/api/video/consultation/${session.id}`).set(auth),
      request(app).get(`/api/chat/${session.id}/messages`).set(auth),
      request(app).get(`/api/consultations/${session.id}/documents`).set(auth),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
  });
});

describe('FixRound1 login mode contract', () => {
  beforeEach(resetDb);

  test('primary login returns validated preferred mode and capabilities independent of legacy role', async () => {
    const { user } = await makeApplicant('round1-login-primary@test.uz');
    await user.update({ preferredMode: 'client' });

    const response = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'passw0rd',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'lawyer',
      accountType: 'member',
      preferredMode: 'client',
      capabilities: ['client', 'lawyerApplicant'],
    });
  });

  test('MFA login returns operational capabilities and the server preferred client mode', async () => {
    const { user } = await makeApprovedOperator('round1-login-mfa@test.uz');
    const secret = authenticator.generateSecret();
    await user.update({
      preferredMode: 'client',
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    });
    const login = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'passw0rd',
    });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });

    expect(response.status).toBe(200);
    expect(response.body.preferredMode).toBe('client');
    expect(response.body.capabilities).toEqual(['client', 'lawyerApplicant', 'lawyer']);
  });
});

describe('FixRound1 support and public lawyer boundaries', () => {
  beforeEach(resetDb);

  test('all admin support reads and mutations require current admin MFA capability', async () => {
    const client = await makeMember('round1-support-client@test.uz');
    const admin = await makeAdmin('round1-support-admin@test.uz');
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    const ticket = await SupportTicket.create({
      userId: client.id,
      subject: 'Private',
      message: 'Do not leak client@example.test',
      status: 'open',
    });
    const primary = { Authorization: `Bearer ${tokenFor(admin, 'primary')}` };

    const responses = await Promise.all([
      request(app).get('/api/support').set(primary),
      request(app).get('/api/admin/support').set(primary),
      request(app).patch(`/api/admin/support/${ticket.id}`).set(primary).send({ status: 'closed' }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    responses.forEach((response) => expect(JSON.stringify(response.body)).not.toContain(client.email));
    await ticket.reload();
    expect(ticket.status).toBe('open');

    const allowed = await request(app).get('/api/support').set(headersFor(admin, 'admin', 'mfa'));
    expect(allowed.status).toBe(200);
  });

  test.each([
    ['inactive', { isActive: false }, { verificationStatus: 'approved', operatingStatus: 'enabled' }],
    ['pending', {}, { verificationStatus: 'pending', operatingStatus: 'suspended' }],
    ['rejected', {}, { verificationStatus: 'rejected', operatingStatus: 'suspended' }],
    ['suspended', {}, { verificationStatus: 'approved', operatingStatus: 'suspended' }],
  ])('public lawyer detail hides %s profiles', async (_label, userChanges, profileChanges) => {
    const { user, lp } = await makeApprovedOperator(`round1-detail-${_label}@test.uz`);
    await Promise.all([user.update(userChanges), lp.update(profileChanges)]);

    const response = await request(app).get(`/api/lawyers/${user.id}`);

    expect(response.status).toBe(404);
  });

  test('public lawyer detail returns an active approved enabled legacy lawyer', async () => {
    const { user } = await makeApprovedOperator('round1-detail-active@test.uz');
    const response = await request(app).get(`/api/lawyers/${user.id}`);
    expect(response.status).toBe(200);
  });

  test('mismatch telemetry uses a fixed portal name and never attacker-controlled path or query data', async () => {
    const { user } = await makeApplicant('round1-telemetry@test.uz');
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const attackerValue = 'client@example.test';

    try {
      const response = await request(app)
        .get(`/api/lawyer/${attackerValue}?secret=${attackerValue}`)
        .set(headersFor(user, 'lawyer'));
      const telemetry = info.mock.calls.find(([event]) => event === 'auth_capability_mismatch')?.[1];

      expect(response.status).toBe(403);
      expect(telemetry).toBeUndefined();
      expect(JSON.stringify(info.mock.calls)).not.toContain(attackerValue);
    } finally {
      info.mockRestore();
    }
  });

  test('route-specific mismatch telemetry uses the Express route template', async () => {
    const client = await makeMember('round1-template-client@test.uz');
    const { user } = await makeApplicant('round1-template-applicant@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);

    try {
      await request(app)
        .patch(`/api/consultations/${session.id}/status?email=private@example.test`)
        .set(headersFor(user, 'lawyer', 'mfa'))
        .send({ status: 'accepted' });
      const telemetry = info.mock.calls.find(([event]) => event === 'auth_capability_mismatch')?.[1];

      expect(telemetry.route).toBe('HTTP PATCH /api/consultations/:id/status');
      expect(JSON.stringify(telemetry)).not.toContain(session.id);
      expect(JSON.stringify(telemetry)).not.toContain('private@example.test');
    } finally {
      info.mockRestore();
    }
  });
});

describe('FixRound1 socket event revalidation', () => {
  beforeEach(resetDb);

  test('2FA-disabled connected lawyer cannot send and is disconnected', async () => {
    const client = await makeMember('round1-socket-send-client@test.uz');
    const { user, lp } = await makeApprovedOperator('round1-socket-send-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const harness = signalingHarness();
    const socket = await connect(harness, user, 'lawyer', 'mfa');
    await socket.handlers['join-chat']({ consultationId: session.id });
    await Promise.all([
      user.update({ twoFactorEnabled: false }),
      lp.update({ operatingStatus: 'suspended', isAvailable: false }),
    ]);

    await socket.handlers['send-message']({ consultationId: session.id, text: 'must not persist' });

    expect(await Message.count({ where: { consultationId: session.id } })).toBe(0);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test('password-changed connected socket cannot call and is disconnected', async () => {
    const client = await makeMember('round1-socket-call-client@test.uz');
    const { user } = await makeApprovedOperator('round1-socket-call-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const harness = signalingHarness();
    const socket = await connect(harness, user, 'lawyer', 'mfa');
    await user.update({ passwordChangedAt: new Date(Date.now() + 1000) });

    await socket.handlers['call-user']({ consultationId: session.id });

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(harness.io.to).not.toHaveBeenCalledWith(`user:${client.id}`);
  });

  test('profile-suspended connected lawyer cannot join and is disconnected', async () => {
    const client = await makeMember('round1-socket-suspended-client@test.uz');
    const { user, lp } = await makeApprovedOperator('round1-socket-suspended-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });
    const session = await consultation(client.id, user.id);
    const harness = signalingHarness();
    const socket = await connect(harness, user, 'lawyer', 'mfa');
    await lp.update({ operatingStatus: 'suspended' });

    await socket.handlers['join-room']({ consultationId: session.id });

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalledWith(`consultation:${session.id}`);
  });

  test('inactive connected user cannot join and is disconnected', async () => {
    const member = await makeMember('round1-socket-inactive@test.uz');
    const { user: lawyer } = await makeApprovedOperator('round1-socket-inactive-lawyer@test.uz');
    const session = await consultation(member.id, lawyer.id);
    const harness = signalingHarness();
    const socket = await connect(harness, member, 'client');
    await member.update({ isActive: false });

    await socket.handlers['join-room']({ consultationId: session.id });

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalledWith(`consultation:${session.id}`);
  });

  test('typing requires revalidation, participant perspective, and the exact joined chat room', async () => {
    const member = await makeMember('round1-socket-typing@test.uz');
    const outsider = await makeMember('round1-socket-typing-outsider@test.uz');
    const { user: lawyer } = await makeApprovedOperator('round1-socket-typing-lawyer@test.uz');
    const own = await consultation(member.id, lawyer.id);
    const other = await consultation(outsider.id, lawyer.id);
    const harness = signalingHarness();
    const socket = await connect(harness, member, 'client');

    await socket.handlers.typing({ consultationId: own.id });
    expect(socket.to).not.toHaveBeenCalled();

    await socket.handlers['join-chat']({ consultationId: own.id });
    socket.to.mockClear();
    await socket.handlers.typing({ consultationId: other.id });
    await socket.handlers['stop-typing']({ consultationId: other.id });
    expect(socket.to).not.toHaveBeenCalled();

    await socket.handlers.typing({ consultationId: own.id });
    await socket.handlers['stop-typing']({ consultationId: own.id });
    expect(socket.to).toHaveBeenCalledTimes(2);
    expect(socket.to).toHaveBeenCalledWith(`chat:${own.id}`);
  });

  test('one sensitive event performs one bounded current-user reload', async () => {
    const member = await makeMember('round1-socket-bounded@test.uz');
    const { user: lawyer } = await makeApprovedOperator('round1-socket-bounded-lawyer@test.uz');
    const session = await consultation(member.id, lawyer.id);
    const harness = signalingHarness();
    const socket = await connect(harness, member, 'client');
    await socket.handlers['join-chat']({ consultationId: session.id });
    const findUser = jest.spyOn(models.User, 'findByPk');

    try {
      await socket.handlers.typing({ consultationId: session.id });
      expect(findUser).toHaveBeenCalledTimes(1);
    } finally {
      findUser.mockRestore();
    }
  });
});
