const request = require('supertest');
const app = require('../src/server');
const { resetDb, makeClient, tokenFor } = require('./helpers');

beforeAll(resetDb);

test('без Anthropic API чат отвечает 503, а не выдаёт шаблон за AI', async () => {
  const client = await makeClient('ai-unavailable@test.uz');
  const response = await request(app).post('/api/ai/chat/message')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ message: 'Юридический вопрос' });
  expect(response.status).toBe(503);
  expect(response.body.code).toBe('AI_UNAVAILABLE');
});
