jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/services/socialAuthService', () => ({
  config: jest.fn(() => ({
    google: { enabled: true, clientId: 'test-google-client' },
    telegram: { enabled: true, botUsername: 'test_bot' },
  })),
  googleEnabled: jest.fn(() => true),
  telegramEnabled: jest.fn(() => true),
  verifyGoogleToken: jest.fn(),
  verifyTelegramAuth: jest.fn(),
}));

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../src/server');
const socialAuth = require('../src/services/socialAuthService');
const twoFactor = require('../src/services/twoFactorService');
const {
  authenticate,
  deriveCapabilities,
  requireCapability,
} = require('../src/middleware/auth');
const {
  resetDb,
  makeMember,
  makeApplicant,
  makeApprovedOperator,
  makeSuspendedOperator,
  makeAdmin,
  models,
} = require('./helpers');

const { AuthChallenge, PhoneOtp } = models;

function passwordState(user) {
  return String(user.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0);
}

function fullToken(user, authLevel = 'primary') {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      authLevel,
      passwordState: passwordState(user),
      ...(authLevel === 'mfa' ? { twoFactorVersion: user.twoFactorVersion } : {}),
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function challengeToken(user) {
  return jwt.sign(
    { id: user.id, twofa: 'pending' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

function capabilityApp() {
  const app = express();
  app.get('/client', authenticate, requireCapability('client'), (req, res) => {
    res.json({ mode: req.accountMode, capabilities: req.capabilities, authLevel: req.authLevel });
  });
  app.get('/lawyer', authenticate, requireCapability('lawyer'), (req, res) => {
    res.json({ mode: req.accountMode, capabilities: req.capabilities, authLevel: req.authLevel });
  });
  app.get('/applicant', authenticate, requireCapability('lawyerApplicant'), (req, res) => {
    res.json({ mode: req.accountMode, capabilities: req.capabilities, authLevel: req.authLevel });
  });
  app.get('/admin', authenticate, requireCapability('admin'), (req, res) => {
    res.json({ mode: req.accountMode, capabilities: req.capabilities, authLevel: req.authLevel });
  });
  return app;
}

describe('database-derived account capabilities', () => {
  beforeEach(resetDb);

  test('derives member and applicant capabilities without trusting legacy role', async () => {
    const member = await makeMember('cap-member@test.uz', { role: 'lawyer' });
    const { user: applicant, lp } = await makeApplicant('cap-applicant@test.uz');

    expect(deriveCapabilities(member, null, 'mfa')).toEqual(['client']);
    expect(deriveCapabilities(applicant, lp, 'primary')).toEqual(['client', 'lawyerApplicant']);
  });

  test('grants lawyer only to an approved enabled 2FA account in an MFA session', async () => {
    const { user, lp } = await makeApprovedOperator('cap-operator@test.uz');
    await user.update({ twoFactorEnabled: true });

    expect(deriveCapabilities(user, lp, 'primary')).toEqual(['client', 'lawyerApplicant']);
    expect(deriveCapabilities(user, lp, 'mfa')).toEqual(['client', 'lawyerApplicant', 'lawyer']);

    await user.update({ twoFactorEnabled: false });
    expect(deriveCapabilities(user, lp, 'mfa')).toEqual(['client', 'lawyerApplicant']);
  });

  test('does not use catalog availability as lawyer authorization', async () => {
    const { user, lp } = await makeApprovedOperator('cap-offline@test.uz', { isAvailable: false });
    await user.update({ twoFactorEnabled: true });

    expect(deriveCapabilities(user, lp, 'mfa')).toContain('lawyer');
  });

  test('denies lawyer capability to suspended operators and admin capability to primary sessions', async () => {
    const { user: suspended, lp } = await makeSuspendedOperator('cap-suspended@test.uz');
    await suspended.update({ twoFactorEnabled: true });
    const admin = await makeAdmin('cap-admin@test.uz');
    await admin.update({ twoFactorEnabled: true });

    expect(deriveCapabilities(suspended, lp, 'mfa')).toEqual(['client', 'lawyerApplicant']);
    expect(deriveCapabilities(admin, null, 'primary')).toEqual([]);
    expect(deriveCapabilities(admin, null, 'mfa')).toEqual(['admin']);
  });
});

describe('capability mode validation', () => {
  beforeEach(resetDb);

  test('defaults a single-capability member to client mode', async () => {
    const member = await makeMember('mode-client@test.uz');
    const response = await request(capabilityApp())
      .get('/client')
      .set('Authorization', `Bearer ${fullToken(member)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ mode: 'client', capabilities: ['client'], authLevel: 'primary' });
  });

  test('requires an explicit mode for dual-mode members', async () => {
    const { user } = await makeApplicant('mode-dual@test.uz');
    const response = await request(capabilityApp())
      .get('/applicant')
      .set('Authorization', `Bearer ${fullToken(user)}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('MODE_REQUIRED');
  });

  test('denies valid but unavailable spoofed modes', async () => {
    const member = await makeMember('mode-spoof@test.uz');
    const response = await request(capabilityApp())
      .get('/client')
      .set('Authorization', `Bearer ${fullToken(member)}`)
      .set('X-Maslaxat-Mode', 'admin');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MODE_FORBIDDEN');
  });

  test('rejects malformed modes instead of silently defaulting', async () => {
    const member = await makeMember('mode-invalid@test.uz');
    const response = await request(capabilityApp())
      .get('/client')
      .set('Authorization', `Bearer ${fullToken(member)}`)
      .set('X-Maslaxat-Mode', 'root');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_MODE');
  });

  test('allows an offline operator in lawyer mode after MFA', async () => {
    const { user } = await makeApprovedOperator('mode-offline@test.uz', { isAvailable: false });
    await user.update({ twoFactorEnabled: true });
    const response = await request(capabilityApp())
      .get('/lawyer')
      .set('Authorization', `Bearer ${fullToken(user, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('lawyer');
  });

  test('denies lawyer capability guards while a dual-capability account is in client mode', async () => {
    const { user } = await makeApprovedOperator('mode-lawyer-as-client@test.uz');
    await user.update({ twoFactorEnabled: true });

    const response = await request(capabilityApp())
      .get('/lawyer')
      .set('Authorization', `Bearer ${fullToken(user, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'client');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MODE_CAPABILITY_MISMATCH');
  });

  test('denies client capability guards while a dual-capability account is in lawyer mode', async () => {
    const { user } = await makeApprovedOperator('mode-client-as-lawyer@test.uz');
    await user.update({ twoFactorEnabled: true });

    const response = await request(capabilityApp())
      .get('/client')
      .set('Authorization', `Bearer ${fullToken(user, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MODE_CAPABILITY_MISMATCH');
  });

  test('never accepts a 2FA challenge token as a protected-route token', async () => {
    const admin = await makeAdmin('mode-challenge@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const response = await request(capabilityApp())
      .get('/admin')
      .set('Authorization', `Bearer ${challengeToken(admin)}`)
      .set('X-Maslaxat-Mode', 'admin');

    expect(response.status).toBe(401);
  });
});

describe('shared primary and MFA login finalization', () => {
  beforeEach(async () => {
    await resetDb();
    socialAuth.verifyGoogleToken.mockReset();
    socialAuth.verifyTelegramAuth.mockReset();
  });

  test('password login explicitly issues a primary JWT to a member', async () => {
    await makeMember('login-primary@test.uz');

    const response = await request(app).post('/api/auth/login').send({
      email: 'login-primary@test.uz',
      password: 'passw0rd',
    });

    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.token, process.env.JWT_SECRET).authLevel).toBe('primary');
  });

  test('admin without enabled 2FA receives only a primary JWT with no admin capability', async () => {
    const admin = await makeAdmin('login-admin-primary@test.uz');

    const response = await request(app).post('/api/auth/login').send({
      email: admin.email,
      password: 'passw0rd',
    });
    const payload = jwt.verify(response.body.token, process.env.JWT_SECRET);

    expect(payload.authLevel).toBe('primary');
    expect(deriveCapabilities(admin, null, payload.authLevel)).toEqual([]);
  });

  test('password login returns only a challenge for an enabled-2FA operator', async () => {
    const { user } = await makeApprovedOperator('login-password-mfa@test.uz');
    await user.update({ twoFactorEnabled: true, twoFactorSecret: authenticator.generateSecret() });

    const response = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'passw0rd',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ twoFactorRequired: true });
    expect(response.body.token).toBeUndefined();
    expect(jwt.verify(response.body.tempToken, process.env.JWT_SECRET).twofa).toBe('pending');
  });

  test('phone login uses the same challenge finalizer for an enabled-2FA operator', async () => {
    const { user } = await makeApprovedOperator('login-phone-mfa@test.uz');
    await user.update({
      phone: '+998901112233',
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
    });
    await PhoneOtp.create({
      phone: user.phone,
      code: '123456',
      expiresAt: new Date(Date.now() + 60_000),
      attempts: 0,
    });

    const response = await request(app).post('/api/auth/phone/verify').send({
      phone: user.phone,
      code: '123456',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ twoFactorRequired: true });
    expect(response.body.token).toBeUndefined();
  });

  test('Google login uses the same challenge finalizer for an enabled-2FA admin', async () => {
    const admin = await makeAdmin('login-google-mfa@test.uz');
    await admin.update({
      googleId: 'google-admin-1',
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
    });
    socialAuth.verifyGoogleToken.mockResolvedValue({
      googleId: admin.googleId,
      email: admin.email,
      name: admin.name,
      avatar: null,
    });

    const response = await request(app).post('/api/auth/google').send({ credential: 'verified-google-token' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ twoFactorRequired: true });
    expect(response.body.token).toBeUndefined();
  });

  test('Telegram login uses the same challenge finalizer for an enabled-2FA admin', async () => {
    const admin = await makeAdmin('login-telegram-mfa@test.uz');
    await admin.update({
      telegramId: 'telegram-admin-1',
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
    });
    socialAuth.verifyTelegramAuth.mockReturnValue({
      telegramId: admin.telegramId,
      name: admin.name,
      username: 'admin',
      avatar: null,
    });

    const response = await request(app).post('/api/auth/telegram').send({ hash: 'verified-telegram-payload' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ twoFactorRequired: true });
    expect(response.body.token).toBeUndefined();
  });

  test('reuses an unconsumed Google assertion challenge and rejects it after consumption', async () => {
    const admin = await makeAdmin('login-google-replay@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ googleId: 'google-replay-1', twoFactorEnabled: true, twoFactorSecret: secret });
    socialAuth.verifyGoogleToken.mockResolvedValue({
      googleId: admin.googleId,
      email: admin.email,
      name: admin.name,
      avatar: null,
    });

    const first = await request(app).post('/api/auth/google').send({ credential: '  same-google-assertion  ' });
    const repeated = await request(app).post('/api/auth/google').send({ credential: 'same-google-assertion' });
    const verified = await request(app).post('/api/auth/login/2fa').send({
      tempToken: first.body.tempToken,
      code: authenticator.generate(secret),
    });
    const replay = await request(app).post('/api/auth/google').send({ credential: 'same-google-assertion' });

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body.tempToken).toBe(first.body.tempToken);
    expect(verified.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_ASSERTION_REPLAY');
    expect(await AuthChallenge.count({ where: { userId: admin.id } })).toBe(1);
  });

  test('does not rebind an unconsumed social challenge to a newer factor version', async () => {
    const admin = await makeAdmin('login-google-version-replay@test.uz');
    await admin.update({
      googleId: 'google-version-replay-1',
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
      twoFactorVersion: 8,
    });
    socialAuth.verifyGoogleToken.mockResolvedValue({
      googleId: admin.googleId,
      email: admin.email,
      name: admin.name,
      avatar: null,
    });

    const first = await request(app).post('/api/auth/google').send({ credential: 'version-bound-assertion' });
    await admin.update({ twoFactorVersion: 9 });
    const replay = await request(app).post('/api/auth/google').send({ credential: 'version-bound-assertion' });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_ASSERTION_REPLAY');
  });

  test('normalizes Telegram assertion fields for replay-safe challenge reuse', async () => {
    const admin = await makeAdmin('login-telegram-replay@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ telegramId: 'telegram-replay-1', twoFactorEnabled: true, twoFactorSecret: secret });
    socialAuth.verifyTelegramAuth.mockReturnValue({
      telegramId: admin.telegramId,
      name: admin.name,
      username: 'admin',
      avatar: null,
    });
    const authDate = String(Math.floor(Date.now() / 1000));

    const first = await request(app).post('/api/auth/telegram').send({
      id: admin.telegramId,
      auth_date: authDate,
      hash: 'same-telegram-hash',
    });
    const repeated = await request(app).post('/api/auth/telegram').send({
      hash: 'same-telegram-hash',
      auth_date: authDate,
      id: admin.telegramId,
    });
    await request(app).post('/api/auth/login/2fa').send({
      tempToken: first.body.tempToken,
      code: authenticator.generate(secret),
    });
    const replay = await request(app).post('/api/auth/telegram').send({
      auth_date: authDate,
      id: admin.telegramId,
      hash: 'same-telegram-hash',
    });

    expect(repeated.body.tempToken).toBe(first.body.tempToken);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_ASSERTION_REPLAY');
    expect(await AuthChallenge.count({ where: { userId: admin.id } })).toBe(1);
  });

  test('allows a Google assertion to mint only one primary JWT', async () => {
    const member = await makeMember('login-google-primary-replay@test.uz', {
      googleId: 'google-primary-replay-1',
    });
    socialAuth.verifyGoogleToken.mockResolvedValue({
      googleId: member.googleId,
      email: member.email,
      name: member.name,
      avatar: null,
    });

    const first = await request(app).post('/api/auth/google').send({ credential: 'one-primary-google-assertion' });
    const replay = await request(app).post('/api/auth/google').send({ credential: 'one-primary-google-assertion' });

    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_ASSERTION_REPLAY');
  });

  test('allows a Telegram assertion to mint only one primary JWT', async () => {
    const member = await makeMember('login-telegram-primary-replay@test.uz', {
      telegramId: 'telegram-primary-replay-1',
    });
    socialAuth.verifyTelegramAuth.mockReturnValue({
      telegramId: member.telegramId,
      name: member.name,
      username: 'member',
      avatar: null,
    });
    const assertion = { id: member.telegramId, auth_date: '1234567890', hash: 'one-primary-telegram-hash' };

    const first = await request(app).post('/api/auth/telegram').send(assertion);
    const replay = await request(app).post('/api/auth/telegram').send(assertion);

    expect(first.status).toBe(200);
    expect(first.body.token).toBeTruthy();
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_ASSERTION_REPLAY');
  });

  test('TOTP challenge completion issues an MFA JWT with operational capability', async () => {
    const { user, lp } = await makeApprovedOperator('login-totp-mfa@test.uz');
    const secret = authenticator.generateSecret();
    await user.update({ twoFactorEnabled: true, twoFactorSecret: secret });
    const login = await request(app).post('/api/auth/login').send({
      email: user.email,
      password: 'passw0rd',
    });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });
    const payload = jwt.verify(response.body.token, process.env.JWT_SECRET);

    expect(response.status).toBe(200);
    expect(payload.authLevel).toBe('mfa');
    expect(deriveCapabilities(user, lp, payload.authLevel)).toContain('lawyer');
  });

  test('one-time recovery challenge completion issues an MFA JWT and consumes the code', async () => {
    const admin = await makeAdmin('login-recovery-mfa@test.uz');
    const secret = authenticator.generateSecret();
    const backupCodes = twoFactor.generateBackupCodes();
    await admin.update({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: backupCodes.hashes,
    });
    const login = await request(app).post('/api/auth/login').send({
      email: admin.email,
      password: 'passw0rd',
    });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: backupCodes.plain[0],
    });
    await admin.reload();

    expect(response.status).toBe(200);
    expect(jwt.verify(response.body.token, process.env.JWT_SECRET).authLevel).toBe('mfa');
    expect(admin.twoFactorBackupCodes).toHaveLength(backupCodes.hashes.length - 1);
  });

  test('persists a nonce challenge and binds the resulting MFA JWT to the factor version', async () => {
    const admin = await makeAdmin('login-versioned-mfa@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret, twoFactorVersion: 4 });

    const login = await request(app).post('/api/auth/login').send({
      email: admin.email,
      password: 'passw0rd',
    });
    const challengePayload = jwt.verify(login.body.tempToken, process.env.JWT_SECRET);
    const verify = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });
    const mfaPayload = jwt.verify(verify.body.token, process.env.JWT_SECRET);

    expect(challengePayload.nonce).toBeTruthy();
    expect(challengePayload.twoFactorVersion).toBe(4);
    expect(challengePayload.passwordState).toBe(passwordState(admin));
    const challenge = await AuthChallenge.findOne({ where: { userId: admin.id } });
    expect(challenge).toMatchObject({
      factorVersion: 4,
      passwordState: passwordState(admin),
    });
    expect(mfaPayload.twoFactorVersion).toBe(4);
    expect(mfaPayload.passwordState).toBe(passwordState(admin));
  });

  test('fails closed when challenge persistence is unavailable', async () => {
    const admin = await makeAdmin('login-challenge-db-failure@test.uz');
    await admin.update({
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
    });
    const create = jest.spyOn(AuthChallenge, 'create').mockRejectedValueOnce(new Error('challenge persistence unavailable'));

    try {
      const response = await request(app).post('/api/auth/login').send({
        email: admin.email,
        password: 'passw0rd',
      });

      expect(response.status).toBe(500);
      expect(response.body.token).toBeUndefined();
      expect(response.body.tempToken).toBeUndefined();
    } finally {
      create.mockRestore();
    }
  });

  test('rejects an MFA JWT when the current factor version changes', async () => {
    const admin = await makeAdmin('login-stale-mfa@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret, twoFactorVersion: 2 });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    const verify = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });
    await admin.update({ twoFactorVersion: 3 });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verify.body.token}`)
      .set('X-Maslaxat-Mode', 'admin');

    expect(response.status).toBe(401);
  });

  test('rejects challenge exchange after the user is deactivated', async () => {
    const admin = await makeAdmin('login-deactivated-challenge@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    await admin.update({ isActive: false });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });

    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
  });

  test('rejects challenge exchange after a password change', async () => {
    const admin = await makeAdmin('login-password-revoked-challenge@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    await admin.update({ passwordChangedAt: new Date(Date.now() + 1000) });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });

    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
  });

  test('accepts a challenge created after a password change in the same second', async () => {
    const admin = await makeAdmin('login-post-password-change@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      passwordChangedAt: new Date(),
    });

    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeTruthy();
  });

  test('rejects challenge exchange after the factor version changes', async () => {
    const admin = await makeAdmin('login-version-revoked-challenge@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret, twoFactorVersion: 6 });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    await admin.update({ twoFactorVersion: 7 });

    const response = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(secret),
    });

    expect(response.status).toBe(401);
    expect(response.body.token).toBeUndefined();
  });

  test('consumes one TOTP challenge exactly once under concurrent exchange', async () => {
    const admin = await makeAdmin('login-concurrent-totp@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({ twoFactorEnabled: true, twoFactorSecret: secret });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    const body = { tempToken: login.body.tempToken, code: authenticator.generate(secret) };

    const responses = await Promise.all([
      request(app).post('/api/auth/login/2fa').send(body),
      request(app).post('/api/auth/login/2fa').send(body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await AuthChallenge.count({ where: { userId: admin.id, consumedAt: { [require('sequelize').Op.ne]: null } } })).toBe(1);
  });

  test('consumes one recovery code exactly once under concurrent exchange', async () => {
    const admin = await makeAdmin('login-concurrent-recovery@test.uz');
    const backupCodes = twoFactor.generateBackupCodes();
    await admin.update({
      twoFactorEnabled: true,
      twoFactorSecret: authenticator.generateSecret(),
      twoFactorBackupCodes: backupCodes.hashes,
    });
    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    const body = { tempToken: login.body.tempToken, code: backupCodes.plain[0] };

    const responses = await Promise.all([
      request(app).post('/api/auth/login/2fa').send(body),
      request(app).post('/api/auth/login/2fa').send(body),
    ]);
    await admin.reload();

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(admin.twoFactorBackupCodes).toHaveLength(backupCodes.hashes.length - 1);
  });
});

describe('2FA bootstrap and current-session compatibility', () => {
  beforeEach(resetDb);

  test('a current applicant can access status and setup even if the legacy role says client', async () => {
    const { user } = await makeApplicant('twofa-applicant@test.uz');
    await user.update({ role: 'client' });
    const authorization = `Bearer ${fullToken(user)}`;

    const status = await request(app)
      .get('/api/2fa/status')
      .set('Authorization', authorization)
      .set('X-Maslaxat-Mode', 'lawyer');
    const setup = await request(app)
      .post('/api/2fa/setup')
      .set('Authorization', authorization)
      .set('X-Maslaxat-Mode', 'lawyer');

    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: false, available: true });
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();
  });

  test('a profile-less member cannot bootstrap 2FA even if the legacy role says lawyer', async () => {
    const member = await makeMember('twofa-spoofed-role@test.uz', { role: 'lawyer' });

    const response = await request(app)
      .post('/api/2fa/setup')
      .set('Authorization', `Bearer ${fullToken(member)}`)
      .set('X-Maslaxat-Mode', 'client');

    expect(response.status).toBe(403);
  });

  test('an admin primary session has no admin capability but can bootstrap 2FA', async () => {
    const admin = await makeAdmin('twofa-admin-primary@test.uz');
    const authorization = `Bearer ${fullToken(admin)}`;

    const status = await request(app).get('/api/2fa/status').set('Authorization', authorization);
    const setup = await request(app).post('/api/2fa/setup').set('Authorization', authorization);
    const business = await request(capabilityApp())
      .get('/admin')
      .set('Authorization', authorization)
      .set('X-Maslaxat-Mode', 'admin');

    expect(status.status).toBe(200);
    expect(status.body.available).toBe(true);
    expect(setup.status).toBe(200);
    expect(business.status).toBe(403);
  });

  test('increments factor version on setup reset, enable, and disable', async () => {
    const admin = await makeAdmin('twofa-version-transitions@test.uz');
    const authorization = `Bearer ${fullToken(admin)}`;

    const firstSetup = await request(app).post('/api/2fa/setup').set('Authorization', authorization);
    await admin.reload();
    expect(admin.twoFactorVersion).toBe(1);

    const resetSetup = await request(app).post('/api/2fa/setup').set('Authorization', authorization);
    await admin.reload();
    expect(admin.twoFactorVersion).toBe(2);

    const enable = await request(app)
      .post('/api/2fa/enable')
      .set('Authorization', authorization)
      .send({ token: authenticator.generate(resetSetup.body.secret) });
    await admin.reload();
    expect(enable.status).toBe(200);
    expect(admin.twoFactorVersion).toBe(3);

    const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: 'passw0rd' });
    const verified = await request(app).post('/api/auth/login/2fa').send({
      tempToken: login.body.tempToken,
      code: authenticator.generate(resetSetup.body.secret),
    });
    const oldMfaToken = verified.body.token;
    const disable = await request(app)
      .post('/api/2fa/disable')
      .set('Authorization', `Bearer ${oldMfaToken}`)
      .send({ token: authenticator.generate(resetSetup.body.secret) });
    await admin.reload();
    expect(disable.status).toBe(200);
    expect(admin.twoFactorVersion).toBe(4);

    const newSetup = await request(app).post('/api/2fa/setup').set('Authorization', authorization);
    await request(app)
      .post('/api/2fa/enable')
      .set('Authorization', authorization)
      .send({ token: authenticator.generate(newSetup.body.secret) });
    await admin.reload();
    expect(admin.twoFactorVersion).toBe(6);

    const staleSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldMfaToken}`)
      .set('X-Maslaxat-Mode', 'admin');
    expect(staleSession.status).toBe(401);

    expect(firstSetup.body.secret).not.toBe(resetSetup.body.secret);
  });

  test('/auth/me returns current capabilities and a validated preferred mode with legacy role', async () => {
    const member = await makeMember('auth-me-member@test.uz', { preferredMode: 'lawyer' });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${fullToken(member)}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'client',
      accountType: 'member',
      capabilities: ['client'],
      preferredMode: 'client',
      user: { id: member.id, role: 'client', accountType: 'member' },
    });
  });

  test('rejects a legacy token without iat when password state cannot be verified', async () => {
    const member = await makeMember('legacy-password-state@test.uz', {
      passwordChangedAt: new Date(),
    });
    const unverifiable = jwt.sign(
      { id: member.id, role: member.role, authLevel: 'primary' },
      process.env.JWT_SECRET,
      { noTimestamp: true }
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${unverifiable}`);

    expect(response.status).toBe(401);
  });

  test('/auth/me reflects current profile and MFA state rather than JWT role claims', async () => {
    const { user } = await makeApprovedOperator('auth-me-operator@test.uz');
    await user.update({ twoFactorEnabled: true, preferredMode: 'lawyer' });
    const forgedLegacyRoleToken = jwt.sign(
      {
        id: user.id,
        role: 'admin',
        authLevel: 'mfa',
        twoFactorVersion: user.twoFactorVersion,
        passwordState: passwordState(user),
      },
      process.env.JWT_SECRET
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forgedLegacyRoleToken}`)
      .set('X-Maslaxat-Mode', 'lawyer');

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('lawyer');
    expect(response.body.capabilities).toEqual(['client', 'lawyerApplicant', 'lawyer']);
    expect(response.body.preferredMode).toBe('lawyer');
  });

  test('same-second password change rejects the old token and accepts the exact-state replacement', async () => {
    const member = await makeMember('password-token-level@test.uz');
    const fixedNow = Math.floor(Date.now() / 1000) * 1000 + 777;
    const now = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    try {
      const login = await request(app).post('/api/auth/login').send({
        email: member.email,
        password: 'passw0rd',
      });
      const response = await request(app)
        .put('/api/users/password')
        .set('Authorization', `Bearer ${login.body.token}`)
        .set('X-Maslaxat-Mode', 'client')
        .send({ oldPassword: 'passw0rd', newPassword: 'new-passw0rd' });
      const oldPayload = jwt.verify(login.body.token, process.env.JWT_SECRET);
      const replacementPayload = jwt.verify(response.body.token, process.env.JWT_SECRET);
      const oldSession = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.token}`);
      const replacementSession = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${response.body.token}`);

      expect(response.status).toBe(200);
      expect(oldPayload.iat).toBe(replacementPayload.iat);
      expect(replacementPayload).toMatchObject({
        authLevel: 'primary',
        passwordState: String(fixedNow),
      });
      expect(oldSession.status).toBe(401);
      expect(replacementSession.status).toBe(200);
    } finally {
      now.mockRestore();
    }
  });

  test('same-second password reset rejects the old full token and pending challenge', async () => {
    const admin = await makeAdmin('password-reset-state@test.uz');
    const secret = authenticator.generateSecret();
    await admin.update({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      resetToken: 'same-second-reset-token',
      resetTokenExpiry: new Date(Date.now() + 60_000),
    });
    const login = await request(app).post('/api/auth/login').send({
      email: admin.email,
      password: 'passw0rd',
    });
    const fixedNow = jwt.decode(login.body.tempToken).iat * 1000 + 888;
    const now = jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    try {
      const oldFullToken = fullToken(admin, 'mfa');
      const reset = await request(app).post('/api/auth/reset-password').send({
        token: 'same-second-reset-token',
        password: 'reset-passw0rd',
      });
      await admin.reload();
      const oldSession = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldFullToken}`)
        .set('X-Maslaxat-Mode', 'admin');
      const oldChallenge = await request(app).post('/api/auth/login/2fa').send({
        tempToken: login.body.tempToken,
        code: authenticator.generate(secret),
      });

      expect(reset.status).toBe(200);
      expect(passwordState(admin)).toBe(String(fixedNow));
      expect(jwt.decode(oldFullToken).iat).toBe(jwt.decode(login.body.tempToken).iat);
      expect(oldSession.status).toBe(401);
      expect(oldChallenge.status).toBe(401);
    } finally {
      now.mockRestore();
    }
  });
});
