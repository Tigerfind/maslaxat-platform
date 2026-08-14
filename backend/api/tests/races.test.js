// Гонки #3 (free-consultation double-spend) и #4 (AI 3/день) — реальная конкуренция
// через Promise.all. #4 требует Redis, которого в тестах нет → мокаем in-memory
// клиент с атомарным incr/decr (jest однопоточный: тело incr атомарно на вызов).

const mockRedisStore = {};
let mockRedisEnabled = true;
const mockRedis = {
  async get(k) { return mockRedisStore[k] !== undefined ? String(mockRedisStore[k]) : null; },
  async incr(k) { mockRedisStore[k] = (mockRedisStore[k] || 0) + 1; return mockRedisStore[k]; },
  async decr(k) { mockRedisStore[k] = (mockRedisStore[k] || 0) - 1; return mockRedisStore[k]; },
  async expire() { return 1; },
};
jest.mock('../src/config/redis', () => ({
  getRedis: () => (mockRedisEnabled ? mockRedis : null),
  connectRedis: async () => (mockRedisEnabled ? mockRedis : null),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Subscription } = models;

// Дать сработать res.on('finish') (refund) до проверки счётчика
const settle = () => new Promise((r) => setTimeout(r, 30));
const limitKey = () => Object.keys(mockRedisStore).find((k) => k.startsWith('ai_limit:'));

beforeAll(async () => { await resetDb(); });
beforeEach(() => {
  for (const k of Object.keys(mockRedisStore)) delete mockRedisStore[k];
  mockRedisEnabled = true;
});

describe('#4 AI daily limit — reserve + refund', () => {
  const send = (token, body) =>
    request(app).post('/api/ai/chat/message').set('Authorization', `Bearer ${token}`).send(body || { message: 'привет' });

  test('4 параллельных запроса при лимите 3 → ровно один 429, три 200; счётчик = 3', async () => {
    const client = await makeClient(`ai1_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    const results = await Promise.all([send(token), send(token), send(token), send(token)]);
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 429).length).toBe(1);
    expect(codes.filter((c) => c === 200).length).toBe(3);
    await settle();
    expect(mockRedisStore[limitKey()]).toBe(3); // не >3 и не отрицательный
  });

  test('пустое сообщение (400) возвращает слот (не-2xx → refund)', async () => {
    const client = await makeClient(`ai2_${Date.now()}@t.uz`);
    const r = await send(tokenFor(client), { message: '' });
    expect(r.status).toBe(400);
    await settle();
    expect(mockRedisStore[limitKey()] || 0).toBe(0);
  });

  test('fallback-ответ (200) слот ПОТРАЧИВАЕТ', async () => {
    const client = await makeClient(`ai3_${Date.now()}@t.uz`);
    const r = await send(tokenFor(client));
    expect(r.status).toBe(200);
    await settle();
    expect(mockRedisStore[limitKey()]).toBe(1);
  });

  test('превышение лимита не раздувает счётчик (over-limit decr)', async () => {
    const client = await makeClient(`ai4_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    await send(token); await send(token); await send(token); // 3 использовано
    const r = await send(token); // 4-й
    expect(r.status).toBe(429);
    await settle();
    expect(mockRedisStore[limitKey()]).toBe(3);
  });

  test('без Redis → 503 (fail-closed)', async () => {
    const client = await makeClient(`ai5_${Date.now()}@t.uz`);
    mockRedisEnabled = false;
    const r = await send(tokenFor(client));
    expect(r.status).toBe(503);
  });
});

describe('#3 free-consultation — нет double-spend под конкуренцией', () => {
  const book = (token, lawyerId, body) =>
    request(app).post(`/api/client/lawyers/${lawyerId}/book`).set('Authorization', `Bearer ${token}`).send({ acceptedTerms: true, legalVersion: '2026-08-13', ...body });

  test('N параллельных loyalty-броней у нового клиента → ровно одна бесплатная', async () => {
    const client = await makeClient(`l3_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    const { user: lawyer } = await makeLawyer(`l3law_${Date.now()}@t.uz`);

    const results = await Promise.all([1, 2, 3, 4].map(() =>
      book(token, lawyer.id, { useFreePromo: true, question: 'q' })));
    const created = results.filter((r) => r.status === 201).map((r) => r.body.consultation);

    expect(created.length).toBe(4);
    expect(created.filter((c) => c.isFree).length).toBe(1);       // ровно одна бесплатная
    expect(created.filter((c) => !c.isFree).length).toBe(3);       // остальные платные
    const freeRows = await Consultation.count({ where: { clientId: client.id, isFree: true, freeSource: 'loyalty' } });
    expect(freeRows).toBe(1);                                      // и в БД одна
  });

  test('N параллельных subscription-броней (pro=3) → не больше 3 бесплатных', async () => {
    const client = await makeClient(`s3_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    await Subscription.create({ userId: client.id, plan: 'pro' });
    const { user: lawyer } = await makeLawyer(`s3law_${Date.now()}@t.uz`);

    const results = await Promise.all([1, 2, 3, 4, 5].map(() =>
      book(token, lawyer.id, { useSubscriptionFree: true, question: 'q' })));
    const created = results.filter((r) => r.status === 201).map((r) => r.body.consultation);

    expect(created.length).toBe(5);
    expect(created.filter((c) => c.isFree).length).toBe(3);        // капнуто лимитом плана
  });

  test('read-only статус лояльности работает и не берёт лок', async () => {
    const client = await makeClient(`ro3_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    const r = await request(app).get('/api/client/consultations/loyalty').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('freeNow');
  });
});
