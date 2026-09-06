jest.mock('../src/services/linkedinOidcService', () => ({
  isEnabled: jest.fn(() => true),
  createAuthorization: jest.fn(async () => ({
    state: 'linkedin-state-test', nonce: 'nonce', codeVerifier: 'verifier',
    url: 'https://www.linkedin.com/oauth/v2/authorization?state=linkedin-state-test',
  })),
  exchangeCallback: jest.fn(async () => ({
    subject: 'linkedin-subject-1', email: 'linkedin-lawyer@test.uz', emailVerified: true,
    givenName: 'LinkedIn', familyName: 'Lawyer', picture: 'https://example.test/avatar.jpg',
  })),
}));

const request = require('supertest');
const app = require('../src/server');
const linkedin = require('../src/services/linkedinOidcService');
const store = require('../src/services/oauthTransactionStore');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(async () => {
  await resetDb();
  store.resetForTests();
  linkedin.exchangeCallback.mockResolvedValue({
    subject: 'linkedin-subject-1', email: 'linkedin-lawyer@test.uz', emailVerified: true,
    givenName: 'LinkedIn', familyName: 'Lawyer', picture: 'https://example.test/avatar.jpg',
  });
});

async function completeFlow(agent = request(app), startPath = '/api/auth/linkedin/start', startBody = { acceptedTerms: true, legalVersion: '2026-08-13' }) {
  const start = await agent.post(startPath).send(startBody);
  expect(start.status).toBe(200);
  const cookie = start.headers['set-cookie'][0].split(';')[0];
  const callback = await agent.get('/api/auth/linkedin/callback?code=code&state=linkedin-state-test').set('Cookie', cookie);
  expect(callback.status).toBe(302);
  const hash = callback.headers.location.split('#')[1];
  return Object.fromEntries(new URLSearchParams(hash));
}

test('создаёт lawyer account и draft profile через one-use completion ticket', async () => {
  const { ticket } = await completeFlow();
  const complete = await request(app).post('/api/auth/linkedin/complete').send({ ticket });
  expect(complete.status).toBe(201);
  expect(complete.body.role).toBe('lawyer');
  expect(complete.body.token).toBeTruthy();
  const user = await models.User.findOne({ where: { email: 'linkedin-lawyer@test.uz' }, include: [{ model: models.LawyerProfile, as: 'profile' }] });
  expect(user.profile.verificationStatus).toBe('draft');
  expect(await models.LawyerOAuthAccount.count({ where: { userId: user.id, provider: 'linkedin' } })).toBe(1);
  expect((await request(app).post('/api/auth/linkedin/complete').send({ ticket })).status).toBe(400);
});

test('matching email не создаёт дубль и требует явную привязку', async () => {
  await makeLawyer('linkedin-lawyer@test.uz');
  const { ticket } = await completeFlow();
  const complete = await request(app).post('/api/auth/linkedin/complete').send({ ticket });
  expect(complete.status).toBe(409);
  expect(complete.body.code).toBe('ACCOUNT_LINK_REQUIRED');
  expect(await models.User.count({ where: { email: 'linkedin-lawyer@test.uz' } })).toBe(1);
});

test('authenticated lawyer может привязать LinkedIn', async () => {
  const { user } = await makeLawyer('existing-linkedin@test.uz');
  linkedin.exchangeCallback.mockResolvedValueOnce({
    subject: 'linked-existing-subject', email: user.email, emailVerified: true,
    givenName: 'Existing', familyName: 'Lawyer', picture: null,
  });
  const agent = request(app);
  const start = await agent.post('/api/auth/linkedin/link/start').set('Authorization', `Bearer ${tokenFor(user)}`).send({});
  const cookie = start.headers['set-cookie'][0].split(';')[0];
  const callback = await agent.get('/api/auth/linkedin/callback?code=code&state=linkedin-state-test').set('Cookie', cookie);
  const params = Object.fromEntries(new URLSearchParams(callback.headers.location.split('#')[1]));
  const complete = await agent.post('/api/auth/linkedin/link/complete').set('Authorization', `Bearer ${tokenFor(user)}`).send({ ticket: params.ticket });
  expect(complete.status).toBe(200);
  expect(await models.LawyerOAuthAccount.count({ where: { userId: user.id } })).toBe(1);
});

test('клиент не может начать или завершить LinkedIn linking юриста', async () => {
  const client = await makeClient('linkedin-client-denied@test.uz');
  const auth = `Bearer ${tokenFor(client)}`;
  expect((await request(app).post('/api/auth/linkedin/link/start').set('Authorization', auth)).status).toBe(403);
  expect((await request(app).post('/api/auth/linkedin/link/complete').set('Authorization', auth).send({ ticket: 'x' })).status).toBe(403);
});

test('отмена OAuth возвращает безопасный redirect без provider tokens', async () => {
  const response = await request(app).get('/api/auth/linkedin/callback?error=access_denied');
  expect(response.status).toBe(302);
  expect(response.headers.location).toMatch(/\/oauth\/linkedin#error=cancelled$/);
  expect(response.headers.location).not.toContain('access_denied');
});
