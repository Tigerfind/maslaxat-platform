const request = require('supertest');
const app = require('../src/server');
const { resetDb } = require('./helpers');

beforeAll(resetDb);

test('readiness подтверждает БД и честно показывает отсутствие Redis', async () => {
  const response = await request(app).get('/api/health/ready');
  expect(response.status).toBe(503);
  expect(response.body.status).toBe('not_ready');
  expect(response.body.failed).toEqual(['shutdown']);
  expect(JSON.stringify(response.body)).not.toMatch(/postgres|redis:\/\//i);
});
