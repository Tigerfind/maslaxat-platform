const request = require('supertest');
const app = require('../src/server');
const { resetDb, tokenFor, makeClient } = require('./helpers');

beforeAll(async () => resetDb());

test('health и публичный каталог доступны', async () => {
  const health = await request(app).get('/api/health');
  expect(health.status).toBe(200);
  expect(health.body.status).toBe('OK');
  expect((await request(app).get('/api/lawyers')).status).toBe(200);
});

test('приватные маршруты требуют токен, клиент не имеет admin-доступа', async () => {
  expect((await request(app).get('/api/consultations')).status).toBe(401);
  expect((await request(app).get('/api/documents')).status).toBe(401);
  expect((await request(app).get('/api/ai/chat/conversations')).status).toBe(401);

  const client = await makeClient('smoke-client@test.uz');
  const admin = await request(app).get('/api/admin/users')
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(admin.status).toBe(403);
});

test('неизвестный API endpoint возвращает JSON 404', async () => {
  const response = await request(app).get('/api/does-not-exist');
  expect(response.status).toBe(404);
  expect(response.body.error).toBe('Endpoint not found');
});
