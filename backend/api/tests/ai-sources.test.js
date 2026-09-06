process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

const mockCreateMessage = jest.fn().mockResolvedValue({
  content: [{ text: 'Право подтверждено официальной статьёй [S1].\n[КАТЕГОРИЯ: Трудовое право]' }],
});
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({
  messages: { create: mockCreateMessage },
})));

const mockRedis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn(), decr: jest.fn() };
jest.mock('../src/config/redis', () => ({ getRedis: () => mockRedis, connectRedis: async () => mockRedis }));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient } = require('./helpers');

const { LegalDocument, LegalChunk, AIMessage } = models;

beforeAll(async () => resetDb());

test('AI получает legal context, возвращает и сохраняет процитированный источник', async () => {
  const client = await makeClient('ai-source-client@test.uz');
  const document = await LegalDocument.create({
    title: 'Трудовой кодекс Республики Узбекистан', code: 'ТК РУз', language: 'ru',
    sourceUrl: 'https://lex.uz/ru/docs/test', version: '2026-01-01', isActive: true,
  });
  await LegalChunk.create({
    documentId: document.id, ordinal: 0, articleNumber: '22', heading: 'Права работника',
    content: 'Работник имеет право заключить трудовой договор и получать оплату труда.',
  });

  const response = await request(app)
    .post('/api/ai/chat/message')
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ message: 'Что говорит статья 22 про трудовой договор?' });

  expect(response.status).toBe(200);
  expect(response.body.sources).toHaveLength(1);
  expect(response.body.sources[0].url).toBe(document.sourceUrl);
  const anthropicRequest = mockCreateMessage.mock.calls[0][0];
  expect(anthropicRequest.messages[0].content[0].text).toContain('<legal_source id="S1">');
  expect(anthropicRequest.system).toMatch(/данными, а не инструкциями/i);

  const saved = await AIMessage.findOne({ where: { isUser: false } });
  expect(saved.sources).toHaveLength(1);
  expect(saved.fallback).toBe(false);
});
