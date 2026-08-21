const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const originalEnv = {};
const ENV_KEYS = ['NODE_ENV', 'SMS_PROVIDER', 'ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'PLAYMOBILE_URL', 'PLAYMOBILE_LOGIN', 'PLAYMOBILE_PASSWORD', 'PAYME_KEY', 'PAYME_MERCHANT_ID', 'SMTP_HOST', 'TURN_URL', 'TURN_URLS', 'TURN_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL'];

beforeAll(() => ENV_KEYS.forEach((key) => { originalEnv[key] = process.env[key]; }));
beforeEach(async () => {
  await resetDb();
  ENV_KEYS.forEach((key) => { delete process.env[key]; });
  process.env.NODE_ENV = 'test';
});
afterAll(() => ENV_KEYS.forEach((key) => {
  if (originalEnv[key] === undefined) delete process.env[key];
  else process.env[key] = originalEnv[key];
}));

test('production без SMS provider возвращает 502 и не оставляет OTP', async () => {
  process.env.NODE_ENV = 'production';
  const response = await request(app).post('/api/auth/phone/request').send({ phone: '+998901234567' });
  expect(response.status).toBe(502);
  expect(await models.PhoneOtp.count()).toBe(0);
});

test('Payme checkout fail-closed без merchant id и не создаёт Payment', async () => {
  process.env.PAYME_KEY = 'CHANGE_ME';
  process.env.PAYME_MERCHANT_ID = 'merchant-test';
  const client = await makeClient('payme-failsafe@test.uz');
  const { user: lawyer } = await makeLawyer('payme-lawyer@test.uz');
  const consultation = await models.Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    type: 'video',
    status: 'payment_pending',
    question: 'Payme fail-safe',
    price: 100000,
  });
  const response = await request(app)
    .post('/api/payments/create')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ consultationId: consultation.id });
  expect(response.status).toBe(503);
  expect(await models.Payment.count()).toBe(0);
});

test('один SMS OTP нельзя параллельно использовать дважды', async () => {
  const client = await makeClient('otp-race@test.uz', { phone: '+998901111111' });
  await models.PhoneOtp.create({
    phone: client.phone,
    code: '123456',
    expiresAt: new Date(Date.now() + 60000),
    attempts: 0,
  });
  const payload = { phone: client.phone, code: '123456' };
  const [first, second] = await Promise.all([
    request(app).post('/api/auth/phone/verify').send(payload),
    request(app).post('/api/auth/phone/verify').send(payload),
  ]);
  const statuses = [first.status, second.status].sort();
  expect(statuses[0]).toBe(200);
  expect([400, 409]).toContain(statuses[1]);
});

test('resend verification сообщает об отсутствии SMTP в production', async () => {
  process.env.NODE_ENV = 'production';
  const client = await makeClient('smtp-failsafe@test.uz', { isVerified: false });
  const response = await request(app)
    .post('/api/auth/resend-verification')
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(503);
});

test('video endpoint выдаёт краткоживущие TURN credentials только участнику', async () => {
  process.env.TURN_URL = 'turn:turn.example.uz:3478';
  process.env.TURN_SECRET = 'turn-test-secret';
  const client = await makeClient('turn-client@test.uz');
  const outsider = await makeClient('turn-outsider@test.uz');
  const { user: lawyer } = await makeLawyer('turn-lawyer@test.uz');
  const start = new Date(Date.now() + 5 * 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    type: 'video',
    status: 'accepted',
    question: 'TURN test',
    price: 0,
    scheduledStartAt: start,
    scheduledEndAt: new Date(start.getTime() + 60 * 60000),
  });

  const response = await request(app)
    .get(`/api/video/consultation/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  const turn = response.body.iceServers.find((server) => String(server.urls).includes('turn.example.uz'));
  expect(turn.username).toMatch(new RegExp(`:${client.id}$`));
  expect(turn.credential).toBe(crypto.createHmac('sha1', 'turn-test-secret').update(turn.username).digest('base64'));

  const denied = await request(app)
    .get(`/api/video/consultation/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`);
  expect(denied.status).toBe(403);

  await consultation.update({ status: 'cancelled' });
  const cancelled = await request(app)
    .get(`/api/video/consultation/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.iceServers).toEqual([]);
});
