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
  makeMember,
  makeApplicant,
  makeApprovedOperator,
  makeSuspendedOperator,
  makeAdmin,
  models,
} = require('./helpers');

const { Consultation, LawyerProfile } = models;

function tokenFor(user, authLevel = 'primary') {
  return jwt.sign({
    id: user.id,
    role: user.role,
    authLevel,
    passwordState: String(user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0),
    ...(authLevel === 'mfa' ? { twoFactorVersion: user.twoFactorVersion } : {}),
  }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function auth(user, mode, authLevel = 'primary') {
  return {
    Authorization: `Bearer ${tokenFor(user, authLevel)}`,
    'X-Maslaxat-Mode': mode,
  };
}

async function makeConsultation(clientId, lawyerId, question) {
  return Consultation.create({
    clientId,
    lawyerId,
    question,
    problems: [{ text: question, categories: [] }],
    status: 'accepted',
  });
}

function signalingHarness() {
  let middleware;
  let onConnection;
  const io = {
    use: jest.fn((handler) => { middleware = handler; }),
    on: jest.fn((event, handler) => { if (event === 'connection') onConnection = handler; }),
    in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([]) })),
    to: jest.fn(() => ({ emit: jest.fn() })),
    sockets: { sockets: new Map() },
  };
  initSignaling(io);
  return { io, middleware, onConnection };
}

function fakeSocket(token, mode) {
  const handlers = {};
  return {
    id: 'socket-1',
    handshake: { auth: { token, ...(mode === undefined ? {} : { mode }) } },
    rooms: new Set(),
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    on: jest.fn((event, handler) => { handlers[event] = handler; }),
    handlers,
  };
}

async function runSocketMiddleware(middleware, socket) {
  return new Promise((resolve) => middleware(socket, (error) => resolve(error || null)));
}

describe('P2 Task 3 multi-role route compatibility', () => {
  beforeEach(resetDb);

  test('one MFA token lists consultations from the explicit client or lawyer perspective', async () => {
    const { user: shared } = await makeApprovedOperator('shared-routes@test.uz');
    const { user: otherLawyer } = await makeApprovedOperator('other-lawyer@test.uz');
    const client = await makeMember('other-client@test.uz');
    await shared.update({ twoFactorEnabled: true });
    await makeConsultation(shared.id, otherLawyer.id, 'client-side');
    await makeConsultation(client.id, shared.id, 'lawyer-side');

    const asClient = await request(app).get('/api/consultations').set(auth(shared, 'client', 'mfa'));
    const asLawyer = await request(app).get('/api/consultations').set(auth(shared, 'lawyer', 'mfa'));

    expect(asClient.status).toBe(200);
    expect(asClient.body.consultations.map((row) => row.question)).toEqual(['client-side']);
    expect(asLawyer.status).toBe(200);
    expect(asLawyer.body.consultations.map((row) => row.question)).toEqual(['lawyer-side']);
  });

  test('a shared approved lawyer can book another lawyer in client mode but cannot self-book', async () => {
    const { user: shared } = await makeApprovedOperator('shared-booking@test.uz');
    const { user: otherLawyer } = await makeApprovedOperator('book-target@test.uz');
    await shared.update({ twoFactorEnabled: true });
    const payload = { question: 'Need advice', useFreePromo: true };

    const other = await request(app)
      .post(`/api/lawyers/${otherLawyer.id}/book`)
      .set(auth(shared, 'client', 'mfa'))
      .send(payload);
    const self = await request(app)
      .post(`/api/lawyers/${shared.id}/book`)
      .set(auth(shared, 'client', 'mfa'))
      .send(payload);

    expect(other.status).toBe(201);
    expect(other.body.consultation).toMatchObject({ clientId: shared.id, lawyerId: otherLawyer.id });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_BOOKING_FORBIDDEN');
    expect(await Consultation.count({ where: { clientId: shared.id, lawyerId: shared.id } })).toBe(0);
  });

  test.each([
    ['applicant', makeApplicant],
    ['suspended operator', makeSuspendedOperator],
  ])('%s cannot access lawyer operations', async (_label, factory) => {
    const { user } = await factory(`denied-${_label.replace(/\s/g, '-')}@test.uz`);
    await user.update({ twoFactorEnabled: true });
    const headers = auth(user, 'lawyer', 'mfa');

    const responses = await Promise.all([
      request(app).get('/api/lawyer/consultation-requests').set(headers),
      request(app).get('/api/payments/balance').set(headers),
      request(app).get('/api/lawyer/promotions').set(headers),
      request(app).get('/api/dashboard/lawyer/stats').set(headers),
    ]);

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403]);
  });

  test('authorization disagreement denies and emits only sanitized mismatch telemetry', async () => {
    const { user } = await makeApplicant('mismatch@test.uz');
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);

    try {
      const response = await request(app)
        .get('/api/lawyer/consultation-requests')
        .set(auth(user, 'lawyer'));
      const telemetryCall = info.mock.calls.find(([event]) => event === 'auth_capability_mismatch');

      expect(response.status).toBe(403);
      expect(telemetryCall).toBeTruthy();
      expect(telemetryCall[1]).toEqual({
        channel: 'http',
        route: 'HTTP GET /api/lawyer/consultation-requests',
        mode: 'lawyer',
        legacyAllowed: true,
        capabilityAllowed: false,
      });
      expect(Object.keys(telemetryCall[1]).sort()).toEqual([
        'capabilityAllowed', 'channel', 'legacyAllowed', 'mode', 'route',
      ]);
    } finally {
      info.mockRestore();
    }
  });

  test('mismatch telemetry normalizes resource identifiers out of route names', async () => {
    const { user } = await makeApplicant('mismatch-resource@test.uz');
    const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
    const consultationId = '11111111-1111-4111-8111-111111111111';

    try {
      const response = await request(app)
        .post(`/api/lawyer/consultation-requests/${consultationId}/accept`)
        .set(auth(user, 'lawyer'));
      const telemetryCall = info.mock.calls.find(([event]) => event === 'auth_capability_mismatch');

      expect(response.status).toBe(403);
      expect(telemetryCall[1].route).toBe('HTTP POST /api/lawyer/consultation-requests/:id/accept');
      expect(JSON.stringify(telemetryCall[1])).not.toContain(consultationId);
    } finally {
      info.mockRestore();
    }
  });

  test('verification submission is forbidden until applicant 2FA is enabled', async () => {
    const { user } = await makeApplicant('submit-no-2fa@test.uz');

    const response = await request(app)
      .post('/api/lawyer/verification/submit')
      .set(auth(user, 'lawyer'));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('TWO_FACTOR_REQUIRED');
  });

  test('admin approval conflicts without applicant 2FA and enables an MFA-ready profile', async () => {
    const admin = await makeAdmin('approval-admin@test.uz');
    const { user: applicant, lp } = await makeApplicant('approval-applicant@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const headers = auth(admin, 'admin', 'mfa');

    const disabled = await request(app)
      .post(`/api/admin/lawyers/${applicant.id}/approve`)
      .set(headers);
    await applicant.update({ twoFactorEnabled: true, twoFactorSecret: authenticator.generateSecret() });
    const enabled = await request(app)
      .post(`/api/admin/lawyers/${applicant.id}/approve`)
      .set(headers);
    await lp.reload();

    expect(disabled.status).toBe(409);
    expect(disabled.body.code).toBe('LAWYER_2FA_REQUIRED');
    expect(enabled.status).toBe(200);
    expect(lp).toMatchObject({ verificationStatus: 'approved', operatingStatus: 'enabled' });
  });

  test('admin approval rejects an inconsistent enabled flag without a configured factor', async () => {
    const admin = await makeAdmin('approval-invalid-admin@test.uz');
    const { user: applicant } = await makeApplicant('approval-invalid-applicant@test.uz');
    await Promise.all([
      admin.update({ twoFactorEnabled: true }),
      applicant.update({ twoFactorEnabled: true, twoFactorSecret: null }),
    ]);

    const response = await request(app)
      .post(`/api/admin/lawyers/${applicant.id}/approve`)
      .set(auth(admin, 'admin', 'mfa'));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LAWYER_2FA_REQUIRED');
  });

  test('admin business routes require an MFA session', async () => {
    const admin = await makeAdmin('primary-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });

    const response = await request(app)
      .get('/api/admin/users')
      .set(auth(admin, 'admin', 'primary'));

    expect(response.status).toBe(403);
  });

  test('disabling 2FA suspends an approved lawyer profile', async () => {
    const { user, lp } = await makeApprovedOperator('disable-operator@test.uz');
    const secret = authenticator.generateSecret();
    await user.update({ twoFactorEnabled: true, twoFactorSecret: secret });

    const response = await request(app)
      .post('/api/2fa/disable')
      .set(auth(user, 'lawyer', 'mfa'))
      .send({ token: authenticator.generate(secret) });
    await lp.reload();

    expect(response.status).toBe(200);
    expect(lp.operatingStatus).toBe('suspended');
    expect(lp.isAvailable).toBe(false);
  });
});

describe('P2 Task 3 socket authorization', () => {
  beforeEach(resetDb);

  test('handshake requires an explicit current mode for a dual-mode account', async () => {
    const { user } = await makeApprovedOperator('socket-mode-required@test.uz');
    await user.update({ twoFactorEnabled: true });
    const harness = signalingHarness();
    const socket = fakeSocket(tokenFor(user, 'mfa'));

    const error = await runSocketMiddleware(harness.middleware, socket);

    expect(error).toBeTruthy();
    expect(error.message).toBe('MODE_REQUIRED');
  });

  test('handshake rejects lawyer mode when current DB capability is applicant or suspended', async () => {
    const { user } = await makeApplicant('socket-applicant@test.uz');
    const harness = signalingHarness();
    const socket = fakeSocket(tokenFor(user), 'lawyer');

    const error = await runSocketMiddleware(harness.middleware, socket);

    expect(error).toBeTruthy();
    expect(error.message).toBe('MODE_FORBIDDEN');
  });

  test('client-mode socket cannot join a consultation owned only from lawyer perspective', async () => {
    const { user: shared } = await makeApprovedOperator('socket-shared@test.uz');
    const client = await makeMember('socket-client@test.uz');
    await shared.update({ twoFactorEnabled: true });
    const consultation = await makeConsultation(client.id, shared.id, 'lawyer-owned');
    const harness = signalingHarness();
    const socket = fakeSocket(tokenFor(shared, 'mfa'), 'client');

    const error = await runSocketMiddleware(harness.middleware, socket);
    expect(error).toBeNull();
    harness.onConnection(socket);
    await socket.handlers['join-room']({ consultationId: consultation.id });

    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
    expect(socket.join).not.toHaveBeenCalledWith(`consultation:${consultation.id}`);
  });

  test('socket rejects a legacy token issued before the current password state', async () => {
    const member = await makeMember('socket-password-state@test.uz');
    const legacyToken = jwt.sign({ id: member.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await member.update({ passwordChangedAt: new Date(Date.now() + 1000) });
    const harness = signalingHarness();
    const socket = fakeSocket(legacyToken, 'client');

    const error = await runSocketMiddleware(harness.middleware, socket);

    expect(error).toBeTruthy();
    expect(error.message).toBe('Invalid token');
  });
});
