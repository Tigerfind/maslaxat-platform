const request = require('supertest');
const app = require('../src/server');

const keys = ['NODE_ENV', 'ANTHROPIC_API_KEY', 'SMTP_HOST', 'PAYME_KEY', 'PAYME_MERCHANT_ID', 'TURN_URL', 'TURN_SECRET', 'SUPPORT_EMAIL', 'SUPPORT_PHONE', 'ZOOM_MEETING_SDK_ENABLED', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => keys.forEach((key) => {
  if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
}));

test('capabilities не раскрывает секреты и честно показывает отсутствующие сервисы', async () => {
  keys.forEach((key) => { delete process.env[key]; });
  const response = await request(app).get('/api/system/capabilities');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    ai: false, email: false, payments: false, turn: false, zoomMeetingSdk: false,
    consultationExtensions: true,
    support: { tickets: true, email: null, phone: null },
  });
});

test('production не обещает неподдерживаемую оплату продления', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.PAYME_KEY;
  const response = await request(app).get('/api/system/capabilities');
  expect(response.status).toBe(200);
  expect(response.body.consultationExtensions).toBe(false);
});

test('capabilities включает только полностью настроенные пары', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.PAYME_KEY = 'payme-key';
  process.env.PAYME_MERCHANT_ID = 'merchant';
  process.env.TURN_URL = 'turn:turn.test:3478';
  process.env.TURN_SECRET = 'turn-secret';
  process.env.SUPPORT_EMAIL = 'support@test.uz';
  const response = await request(app).get('/api/system/capabilities');
  expect(response.body).toMatchObject({ ai: true, email: true, payments: true, turn: true, support: { tickets: true, email: 'support@test.uz', phone: null } });
  expect(JSON.stringify(response.body)).not.toContain('sk-ant-test');
  expect(JSON.stringify(response.body)).not.toContain('payme-key');
});
