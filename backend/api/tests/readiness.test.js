const request = require('supertest');
const app = require('../src/server');
const { resetDb } = require('./helpers');

beforeAll(resetDb);

test('readiness подтверждает БД и честно показывает отсутствие Redis', async () => {
  const response = await request(app).get('/api/health/ready');
  expect(response.status).toBe(200);
  expect(response.body.dependencies.database).toBe(true);
  expect(typeof response.body.dependencies.redis).toBe('boolean');
  expect(['ready', 'degraded']).toContain(response.body.status);
  expect(JSON.stringify(response.body)).not.toMatch(/postgres|redis:\/\//i);
});
