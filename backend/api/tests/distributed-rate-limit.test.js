const express = require('express');
const request = require('supertest');
const { distributedRateLimit } = require('../src/middleware/distributedRateLimit');

test('локальный fallback ограничивает один логический аккаунт независимо от IP', async () => {
  const app = express();
  app.use(express.json());
  app.post('/limited', distributedRateLimit({
    prefix: `test-${Date.now()}`,
    windowSeconds: 60,
    max: 2,
    keyGenerator: (req) => String(req.body.email).toLowerCase(),
  }), (req, res) => res.json({ ok: true }));

  expect((await request(app).post('/limited').set('X-Forwarded-For', '1.1.1.1').send({ email: 'USER@test.uz' })).status).toBe(200);
  expect((await request(app).post('/limited').set('X-Forwarded-For', '2.2.2.2').send({ email: 'user@test.uz' })).status).toBe(200);
  const blocked = await request(app).post('/limited').set('X-Forwarded-For', '3.3.3.3').send({ email: 'user@test.uz' });
  expect(blocked.status).toBe(429);
  expect(blocked.headers['retry-after']).toBeTruthy();
});
