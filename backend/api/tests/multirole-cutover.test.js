const express = require('express');
const request = require('supertest');
const {
  authorizeCompat,
  evaluateAuthorizationDecision,
} = require('../src/middleware/auth');
const {
  profileWhereFor,
  userWhereFor,
} = require('../src/services/catalogRankingService');
const app = require('../src/server');
const { initSignaling, loadCurrentSocketAuthorization } = require('../src/socket/signaling');
const {
  resetDb,
  makeMember,
  makeApplicant,
  makeApprovedOperator,
  makeAdmin,
  tokenFor,
  models,
} = require('./helpers');

const { Consultation, Message, AuthorizationEvidenceEvent } = models;

function socketHarness() {
  let middleware;
  let onConnection;
  const io = {
    use(handler) { middleware = handler; },
    on(event, handler) { if (event === 'connection') onConnection = handler; },
    in: () => ({ fetchSockets: jest.fn().mockResolvedValue([]), emit: jest.fn() }),
    to: () => ({ emit: jest.fn() }),
    sockets: { sockets: new Map() },
  };
  initSignaling(io);
  return { middleware, onConnection };
}

function connectedSocket(user, mode, authLevel = 'mfa') {
  const handlers = {};
  const rooms = new Set();
  return {
    id: `socket-${user.id}`,
    handshake: { auth: { token: tokenFor(user, authLevel), mode } },
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

function handshake(middleware, socket) {
  return new Promise((resolve) => middleware(socket, (error) => resolve(error || null)));
}

function testApp({ mode, role, capabilities, accountMode, recorder }) {
  const app = express();
  app.get('/protected', (req, _res, next) => {
    req.userRole = role;
    req.capabilities = capabilities;
    req.accountMode = accountMode;
    next();
  }, authorizeCompat({
    legacyRoles: ['lawyer'],
    capability: 'lawyer',
    telemetryName: 'http.lawyer',
    authorizationMode: () => mode,
    recordDecision: recorder,
    surfaceResolver: () => 'HTTP GET /api/dashboard/lawyer/stats',
  }), (_req, res) => res.json({ ok: true }));
  return app;
}

test('compatibility authority denies disagreement and records the sanitized denominator', async () => {
  const events = [];
  const response = await request(testApp({
    mode: 'compatibility', role: 'lawyer', capabilities: ['lawyerApplicant'], accountMode: 'lawyer',
    recorder: async (event) => events.push(event),
  })).get('/protected').set('X-Maslaxat-Mode', 'lawyer');

  expect(response.status).toBe(403);
  expect(response.body.code).toBe('AUTH_CAPABILITY_MISMATCH');
  expect(events).toEqual([{
    channel: 'http', surface: 'HTTP GET /api/dashboard/lawyer/stats', mode: 'lawyer',
    legacyAllowed: true, capabilityAllowed: false,
  }]);
  expect(JSON.stringify(events)).not.toMatch(/user|role|request|email|phone/i);
});

test('capability_only ignores a denying legacy mutation but keeps the legacy decision in shadow telemetry', async () => {
  const events = [];
  const response = await request(testApp({
    mode: 'capability_only', role: 'client', capabilities: ['client', 'lawyerApplicant', 'lawyer'],
    accountMode: 'lawyer', recorder: async (event) => events.push(event),
  })).get('/protected').set('X-Maslaxat-Mode', 'lawyer');

  expect(response.status).toBe(200);
  expect(events[0]).toEqual(expect.objectContaining({ legacyAllowed: false, capabilityAllowed: true }));
});

test('capability_only denies a legacy grant when current capability is absent', async () => {
  const response = await request(testApp({
    mode: 'capability_only', role: 'lawyer', capabilities: ['client', 'lawyerApplicant'],
    accountMode: 'lawyer', recorder: async () => {},
  })).get('/protected').set('X-Maslaxat-Mode', 'lawyer');

  expect(response.status).toBe(403);
});

test('authorization refuses before route side effects when durable telemetry is unavailable', async () => {
  const response = await request(testApp({
    mode: 'compatibility', role: 'lawyer', capabilities: ['lawyer'], accountMode: 'lawyer',
    recorder: async () => { throw new Error('database unavailable'); },
  })).get('/protected').set('X-Maslaxat-Mode', 'lawyer');

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('AUTHORIZATION_TELEMETRY_UNAVAILABLE');
});

test('decision helper preserves mode as an authorization boundary in capability_only', async () => {
  const decisions = [];
  const result = await evaluateAuthorizationDecision({
    authorizationMode: 'capability_only', channel: 'socket', surface: 'SOCKET handshake',
    mode: 'client', legacyAllowed: true, capabilityAllowed: false,
    recordDecision: async (event) => decisions.push(event),
  });

  expect(result).toEqual({ allowed: false, mismatch: true });
  expect(decisions).toHaveLength(1);
});

test('catalog capability_only authority requires member, 2FA, approved and enabled state without role', () => {
  expect(userWhereFor({}, 'compatibility')).toMatchObject({ role: 'lawyer', isActive: true });
  expect(userWhereFor({}, 'capability_only')).toMatchObject({
    accountType: 'member', isActive: true, twoFactorEnabled: true,
  });
  expect(userWhereFor({}, 'capability_only')).not.toHaveProperty('role');
  expect(profileWhereFor({}, 'capability_only')).toMatchObject({
    verificationStatus: 'approved', operatingStatus: 'enabled',
  });
});

test('unknown surface is refused before an authorization decision can run', async () => {
  await expect(evaluateAuthorizationDecision({
    authorizationMode: 'compatibility', channel: 'http', surface: 'HTTP GET /api/not-mounted',
    mode: 'lawyer', legacyAllowed: true, capabilityAllowed: true, recordDecision: async () => {},
  })).rejects.toThrow(/surface/i);
});

describe('capability-only full application preparation', () => {
  beforeEach(async () => {
    process.env.AUTHORIZATION_MODE = 'capability_only';
    await resetDb();
  });

  afterEach(() => {
    delete process.env.AUTHORIZATION_MODE;
  });

  test('legacy role mutation cannot deny current lawyer or admin capability', async () => {
    const { user: lawyer } = await makeApprovedOperator('cutover-lawyer@test.uz');
    await lawyer.update({ role: 'client', twoFactorEnabled: true });
    const admin = await makeAdmin('cutover-admin@test.uz');
    await admin.update({ role: 'client', twoFactorEnabled: true });

    const lawyerResponse = await request(app)
      .get('/api/dashboard/lawyer/stats')
      .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');
    const adminResponse = await request(app)
      .get('/api/support')
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin');

    expect(lawyerResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
    expect(await AuthorizationEvidenceEvent.count({ where: { type: 'decision' } })).toBeGreaterThanOrEqual(2);
  });

  test('legacy lawyer role cannot grant operational access without current capability', async () => {
    const member = await makeMember('cutover-legacy-grant@test.uz', {
      role: 'lawyer', preferredMode: 'lawyer', twoFactorEnabled: true,
    });

    const response = await request(app)
      .get('/api/dashboard/lawyer/stats')
      .set('Authorization', `Bearer ${tokenFor(member, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');

    expect(response.status).toBe(403);
  });

  test('participant ownership remains required after capability authority succeeds', async () => {
    const client = await makeMember('cutover-owner-client@test.uz');
    const outsider = await makeMember('cutover-owner-outsider@test.uz');
    const { user: lawyer } = await makeApprovedOperator('cutover-owner-lawyer@test.uz');
    await lawyer.update({ twoFactorEnabled: true });
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, date: '2026-09-10', time: '12:00',
      type: 'video', status: 'accepted', price: 100000, question: 'Ownership test',
    });

    const response = await request(app)
      .get(`/api/chat/${consultation.id}/messages`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`)
      .set('X-Maslaxat-Mode', 'client');

    expect(response.status).toBe(403);
  });

  test('catalog uses capability eligibility while legacy role remains shadow-only', async () => {
    const { user: valid } = await makeApprovedOperator('cutover-catalog-valid@test.uz');
    await valid.update({ role: 'client', twoFactorEnabled: true });
    const { user: legacyOnly, lp } = await makeApprovedOperator('cutover-catalog-legacy@test.uz');
    await Promise.all([
      legacyOnly.update({ twoFactorEnabled: false }),
      lp.update({ operatingStatus: 'suspended' }),
    ]);

    const response = await request(app).get('/api/lawyers');
    expect(response.status).toBe(200);
    const ids = response.body.lawyers.map((lawyer) => lawyer.id);

    expect(ids).toContain(valid.id);
    expect(ids).not.toContain(legacyOnly.id);
    const decisions = await AuthorizationEvidenceEvent.findAll({
      where: { surface: 'CATALOG GET /api/lawyers' }, raw: true,
    });
    expect(decisions.map(({ legacyAllowed, capabilityAllowed }) => [legacyAllowed, capabilityAllowed]))
      .toEqual(expect.arrayContaining([[false, true], [true, false]]));
    expect(decisions.every((decision) => decision.authorizationMode === 'capability_only')).toBe(true);
  });

  test('socket handshake uses capability authority and records legacy disagreement', async () => {
    const { user } = await makeApprovedOperator('cutover-socket@test.uz');
    await user.update({ role: 'client', twoFactorEnabled: true });
    const socket = {
      handshake: { auth: { token: tokenFor(user, 'mfa'), mode: 'lawyer' } },
      accountMode: undefined,
    };

    const authorization = await loadCurrentSocketAuthorization(socket, {
      allowDefaultMode: true, eventName: 'handshake',
    });

    expect(authorization.accountMode).toBe('lawyer');
    expect(authorization.capabilities).toContain('lawyer');
    const event = await AuthorizationEvidenceEvent.findOne({ where: { surface: 'SOCKET handshake' }, raw: true });
    expect(event).toMatchObject({ authorizationMode: 'capability_only' });
  });

  test('sensitive socket event reloads capability and revokes a mid-connection suspension immediately', async () => {
    const client = await makeMember('cutover-socket-revoke-client@test.uz');
    const { user, lp } = await makeApprovedOperator('cutover-socket-revoke-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });
    const consultation = await Consultation.create({
      clientId: client.id, lawyerId: user.id, date: '2026-09-11', time: '12:00',
      type: 'video', status: 'accepted', price: 100000, question: 'Socket revoke',
    });
    const harness = socketHarness();
    const socket = connectedSocket(user, 'lawyer');
    expect(await handshake(harness.middleware, socket)).toBeNull();
    harness.onConnection(socket);
    await socket.handlers['join-chat']({ consultationId: consultation.id });
    await lp.update({ operatingStatus: 'suspended' });

    await socket.handlers['send-message']({ consultationId: consultation.id, text: 'blocked' });

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(await Message.count({ where: { consultationId: consultation.id } })).toBe(0);
  });

  test('admin lawyer list uses member profile targets and excludes legacy-role-only users', async () => {
    const admin = await makeAdmin('cutover-target-list-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const { user: applicant } = await makeApplicant('cutover-target-list-applicant@test.uz');
    await applicant.update({ role: 'client' });
    const legacyOnly = await makeMember('cutover-target-list-legacy@test.uz', { role: 'lawyer' });

    const response = await request(app)
      .get('/api/admin/lawyers')
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin');
    const ids = response.body.lawyers.map((lawyer) => lawyer.id);

    expect(response.status).toBe(200);
    expect(ids).toContain(applicant.id);
    expect(ids).not.toContain(legacyOnly.id);
    const targetEvents = await AuthorizationEvidenceEvent.findAll({
      where: { surface: 'HTTP GET /api/admin/lawyers#target' }, raw: true,
    });
    expect(targetEvents.map(({ legacyAllowed, capabilityAllowed }) => [legacyAllowed, capabilityAllowed]))
      .toEqual(expect.arrayContaining([[false, true], [true, false]]));
  });

  test('admin can approve and reject a role-mutated lawyer applicant by current profile capability', async () => {
    const admin = await makeAdmin('cutover-target-review-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const { user: applicant, lp } = await makeApplicant('cutover-target-review-applicant@test.uz');
    await applicant.update({ role: 'client', twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    const headers = {
      Authorization: `Bearer ${tokenFor(admin, 'mfa')}`,
      'X-Maslaxat-Mode': 'admin',
    };

    const approved = await request(app).post(`/api/admin/lawyers/${applicant.id}/approve`).set(headers);
    const rejected = await request(app).post(`/api/admin/lawyers/${applicant.id}/reject`).set(headers)
      .send({ reason: 'Needs correction' });

    expect([approved.status, rejected.status]).toEqual([200, 200]);
    await lp.reload();
    expect(lp.verificationStatus).toBe('rejected');
  });

  test('admin promotion pilot control targets a role-mutated approved member profile', async () => {
    const admin = await makeAdmin('cutover-target-pilot-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const { user } = await makeApprovedOperator('cutover-target-pilot-lawyer@test.uz');
    await user.update({ role: 'client', twoFactorEnabled: true });

    const response = await request(app)
      .patch(`/api/admin/lawyers/${user.id}/promotion-pilot`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .send({ enabled: false, reason: 'Cutover target test' });

    expect(response.status).toBe(200);
  });
});
