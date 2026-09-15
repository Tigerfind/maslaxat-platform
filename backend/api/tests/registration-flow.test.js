jest.mock('../src/services/emailService', () => ({
  isEmailConfigured: jest.fn(() => true),
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor } = require('./helpers');
const emailService = require('../src/services/emailService');

const { User, LawyerProfile } = models;
const legal = { acceptedTerms: true, legalVersion: '2026-08-13' };
const payload = (overrides = {}) => ({
  name: 'Test User',
  email: 'registration@example.uz',
  password: 'StrongPass123!',
  role: 'client',
  ...legal,
  ...overrides,
});

beforeAll(async () => { await resetDb(); });
beforeEach(() => {
  emailService.sendVerificationEmail.mockReset();
  emailService.sendVerificationEmail.mockResolvedValue({ sent: true });
});

describe('email registration integrity', () => {
  test('normalizes fields, sends a six-digit code and stores only its hash', async () => {
    const response = await request(app).post('/api/auth/register').send(payload({
      name: '  Test User  ',
      email: '  Registration@Example.UZ  ',
    }));

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ verificationRequired: true, verificationDelivery: 'sent' });
    expect(response.body.user).toMatchObject({
      name: 'Test User', email: 'registration@example.uz', role: 'client', isVerified: false,
    });
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('verificationToken');
    expect(response.body.user).not.toHaveProperty('verificationAttempts');

    const code = emailService.sendVerificationEmail.mock.calls[0][1];
    expect(code).toMatch(/^\d{6}$/);
    const user = await User.findOne({ where: { email: 'registration@example.uz' } });
    expect(user.verificationToken).toMatch(/^otp:v1:[a-f0-9]{64}$/);
    expect(user.verificationToken).not.toContain(code);
    expect(user.verificationTokenExpiry.getTime()).toBeGreaterThan(Date.now());
    expect(user.verificationSentAt).toBeTruthy();
  });

  test('keeps the account but clears OTP state when delivery fails', async () => {
    emailService.sendVerificationEmail.mockResolvedValueOnce({ skipped: true });
    const response = await request(app).post('/api/auth/register').send(payload({ email: 'delivery-failed@example.uz' }));
    expect(response.status).toBe(201);
    expect(response.body.verificationDelivery).toBe('failed');
    const user = await User.findOne({ where: { email: 'delivery-failed@example.uz' } });
    expect(user.verificationToken).toBeNull();
    expect(user.verificationSentAt).toBeNull();
  });

  test('rejects whitespace names and passwords beyond bcrypt byte limit', async () => {
    const whitespace = await request(app).post('/api/auth/register').send(payload({ email: 'whitespace@example.uz', name: '   ' }));
    expect(whitespace.status).toBe(400);
    const oversized = await request(app).post('/api/auth/register').send(payload({ email: 'oversized@example.uz', password: 'я'.repeat(40) }));
    expect(oversized.status).toBe(400);
  });

  test('requires a specialization for lawyers', async () => {
    const response = await request(app).post('/api/auth/register').send(payload({ email: 'lawyer-no-spec@example.uz', role: 'lawyer' }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SPECIALIZATION_REQUIRED');
    expect(await User.count({ where: { email: 'lawyer-no-spec@example.uz' } })).toBe(0);
  });

  test('rolls the user back when lawyer profile creation fails', async () => {
    const createProfile = jest.spyOn(LawyerProfile, 'create').mockRejectedValueOnce(new Error('profile failed'));
    const response = await request(app).post('/api/auth/register').send(payload({
      email: 'lawyer-rollback@example.uz', role: 'lawyer', specializations: ['Гражданское право'],
    }));
    createProfile.mockRestore();
    expect(response.status).toBe(500);
    expect(await User.count({ where: { email: 'lawyer-rollback@example.uz' } })).toBe(0);
  });

  test('concurrent duplicate registration returns one success and one conflict', async () => {
    const responses = await Promise.all([
      request(app).post('/api/auth/register').send(payload({ email: 'race@example.uz' })),
      request(app).post('/api/auth/register').send(payload({ email: 'race@example.uz' })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await User.count({ where: { email: 'race@example.uz' } })).toBe(1);
  });
});

describe('email verification lifecycle', () => {
  const register = async (email) => {
    const response = await request(app).post('/api/auth/register').send(payload({ email }));
    const user = await User.findOne({ where: { email } });
    const code = emailService.sendVerificationEmail.mock.calls[0][1];
    return { response, user, code, authorization: `Bearer ${response.body.token}` };
  };

  test('verifies the authenticated account once with the emailed code', async () => {
    const registration = await register('verify-code@example.uz');
    const first = await request(app).post('/api/auth/verify-email')
      .set('Authorization', registration.authorization).send({ code: registration.code });
    expect(first.status).toBe(200);
    expect(first.body.user.isVerified).toBe(true);
    await registration.user.reload();
    expect(registration.user.verificationToken).toBeNull();
    expect(registration.user.verificationTokenExpiry).toBeNull();
  });

  test('rejects malformed and wrong codes and invalidates after five failures', async () => {
    const registration = await register('wrong-code@example.uz');
    const malformed = await request(app).post('/api/auth/verify-email')
      .set('Authorization', registration.authorization).send({ code: '12ab' });
    expect(malformed.status).toBe(400);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app).post('/api/auth/verify-email')
        .set('Authorization', registration.authorization).send({ code: '000000' });
      expect(response.status).toBe(attempt === 5 ? 429 : 400);
    }
    await registration.user.reload();
    expect(registration.user.verificationAttempts).toBe(5);
    expect(registration.user.verificationToken).toBeNull();
  });

  test('rejects an expired code', async () => {
    const registration = await register('expired-code@example.uz');
    await registration.user.update({ verificationTokenExpiry: new Date(Date.now() - 1000) });
    const response = await request(app).post('/api/auth/verify-email')
      .set('Authorization', registration.authorization).send({ code: registration.code });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('OTP_EXPIRED');
  });

  test('resend rotates the code and enforces a one-minute cooldown', async () => {
    const registration = await register('resend-code@example.uz');
    await registration.user.update({ verificationSentAt: new Date(Date.now() - 61_000) });
    emailService.sendVerificationEmail.mockClear();
    const resent = await request(app).post('/api/auth/resend-verification').set('Authorization', registration.authorization);
    expect(resent.status).toBe(200);
    const newCode = emailService.sendVerificationEmail.mock.calls[0][1];
    expect(newCode).toMatch(/^\d{6}$/);

    const oldCode = await request(app).post('/api/auth/verify-email')
      .set('Authorization', registration.authorization).send({ code: registration.code });
    expect(oldCode.status).toBe(400);
    const cooldown = await request(app).post('/api/auth/resend-verification').set('Authorization', registration.authorization);
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.code).toBe('OTP_RESEND_COOLDOWN');
  });

  test('clears a newly issued code when resend delivery fails', async () => {
    const user = await User.create({
      name: 'Failed Resend', email: 'failed-resend@example.uz', password: 'StrongPass123!', role: 'client',
    });
    emailService.sendVerificationEmail.mockResolvedValueOnce({ skipped: true });
    const response = await request(app).post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(response.status).toBe(503);
    await user.reload();
    expect(user.verificationToken).toBeNull();
    expect(user.verificationSentAt).toBeNull();
  });

  test('keeps old one-time verification links compatible', async () => {
    const user = await User.create({
      name: 'Legacy User', email: 'legacy-token@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'legacy-token', verificationTokenExpiry: new Date(Date.now() + 60_000),
    });
    const first = await request(app).get('/api/auth/verify-email/legacy-token');
    const second = await request(app).get('/api/auth/verify-email/legacy-token');
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    await user.reload();
    expect(user.isVerified).toBe(true);
  });
});
