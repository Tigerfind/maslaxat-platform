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
beforeEach(() => { emailService.sendVerificationEmail.mockClear(); });

describe('email registration integrity', () => {
  test('normalizes fields, returns a safe user and creates an expiring token', async () => {
    const response = await request(app).post('/api/auth/register').send(payload({
      name: '  Test User  ',
      email: '  Registration@Example.UZ  ',
    }));

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      name: 'Test User',
      email: 'registration@example.uz',
      role: 'client',
      isVerified: false,
    });
    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('verificationToken');
    expect(response.body.user).not.toHaveProperty('verificationTokenExpiry');

    const user = await User.findOne({ where: { email: 'registration@example.uz' } });
    expect(user.verificationToken).toHaveLength(64);
    expect(user.verificationTokenExpiry.getTime()).toBeGreaterThan(Date.now());
  });

  test('rejects whitespace names and passwords beyond bcrypt byte limit', async () => {
    const whitespace = await request(app).post('/api/auth/register').send(payload({
      email: 'whitespace@example.uz', name: '   ',
    }));
    expect(whitespace.status).toBe(400);

    const oversized = await request(app).post('/api/auth/register').send(payload({
      email: 'oversized@example.uz', password: 'я'.repeat(40),
    }));
    expect(oversized.status).toBe(400);
  });

  test('requires a specialization for lawyers', async () => {
    const response = await request(app).post('/api/auth/register').send(payload({
      email: 'lawyer-no-spec@example.uz', role: 'lawyer',
    }));

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
    const requests = await Promise.all([
      request(app).post('/api/auth/register').send(payload({ email: 'race@example.uz' })),
      request(app).post('/api/auth/register').send(payload({ email: 'race@example.uz' })),
    ]);

    expect(requests.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await User.count({ where: { email: 'race@example.uz' } })).toBe(1);
  });
});

describe('email verification lifecycle', () => {
  test('verifies once and rejects a reused token', async () => {
    const user = await User.create({
      name: 'Verify User', email: 'verify@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'valid-token', verificationTokenExpiry: new Date(Date.now() + 60_000),
    });

    const first = await request(app).get('/api/auth/verify-email/valid-token');
    const second = await request(app).get('/api/auth/verify-email/valid-token');
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    await user.reload();
    expect(user.isVerified).toBe(true);
    expect(user.verificationToken).toBeNull();
    expect(user.verificationTokenExpiry).toBeNull();
  });

  test('rejects an expired token', async () => {
    const user = await User.create({
      name: 'Expired User', email: 'expired@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'expired-token', verificationTokenExpiry: new Date(Date.now() - 1000),
    });

    const response = await request(app).get('/api/auth/verify-email/expired-token');
    expect(response.status).toBe(400);
    await user.reload();
    expect(user.isVerified).toBe(false);
  });

  test('rejects legacy tokens without an expiry', async () => {
    await User.create({
      name: 'Legacy User', email: 'legacy-token@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'legacy-token', verificationTokenExpiry: null,
    });

    const response = await request(app).get('/api/auth/verify-email/legacy-token');
    expect(response.status).toBe(400);
  });

  test('resend reuses an unexpired token so an existing link stays valid', async () => {
    const user = await User.create({
      name: 'Resend User', email: 'resend@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'old-token', verificationTokenExpiry: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(response.status).toBe(200);
    await user.reload();
    expect(user.verificationToken).toBe('old-token');
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(user.email, user.verificationToken);
  });

  test('resend keeps the usable token when delivery is unavailable', async () => {
    const oldExpiry = new Date(Date.now() + 60_000);
    const user = await User.create({
      name: 'Failed Resend', email: 'failed-resend@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'still-valid-token', verificationTokenExpiry: oldExpiry,
    });
    emailService.sendVerificationEmail.mockResolvedValueOnce({ skipped: true });

    const response = await request(app)
      .post('/api/auth/resend-verification')
      .set('Authorization', `Bearer ${tokenFor(user)}`);
    expect(response.status).toBe(503);
    await user.reload();
    expect(user.verificationToken).toBe('still-valid-token');
    expect(user.verificationTokenExpiry.getTime()).toBe(oldExpiry.getTime());
  });

  test('concurrent resends deliver the same valid token', async () => {
    const user = await User.create({
      name: 'Concurrent Resend', email: 'concurrent-resend@example.uz', password: 'StrongPass123!', role: 'client',
      verificationToken: 'expired-resend-token', verificationTokenExpiry: new Date(Date.now() - 1000),
    });
    const authorization = `Bearer ${tokenFor(user)}`;

    const responses = await Promise.all([
      request(app).post('/api/auth/resend-verification').set('Authorization', authorization),
      request(app).post('/api/auth/resend-verification').set('Authorization', authorization),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const deliveredTokens = emailService.sendVerificationEmail.mock.calls.map((call) => call[1]);
    expect(new Set(deliveredTokens).size).toBe(1);
    await user.reload();
    expect(deliveredTokens[0]).toBe(user.verificationToken);
  });
});
