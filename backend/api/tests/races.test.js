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

const { Consultation, Subscription, ObjectCleanupTask, AIConversation, AIMessage } = models;

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

  test('attachment without a real Anthropic key fails before R2 staging and refunds quota', async () => {
    const client = await makeClient(`ai_attachment_${Date.now()}@t.uz`);
    const response = await request(app).post('/api/ai/chat/message')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .field('message', 'analyze this')
      .attach('files', Buffer.from('safe text'), { filename: 'claim.txt', contentType: 'text/plain' });
    expect(response.status).toBe(503);
    await settle();
    expect(mockRedisStore[limitKey()] || 0).toBe(0);
    expect(await ObjectCleanupTask.count()).toBe(0);
  });

  test.each([
    ['arbitrary ZIP DOCX', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'claim.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['legacy OLE DOC', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00]), 'claim.doc', 'application/msword'],
  ])('%s returns controlled 400 before staging and refunds quota', async (_label, body, filename, contentType) => {
    const client = await makeClient(`ai_invalid_${Date.now()}_${filename}@t.uz`);
    const conversationsBefore = await AIConversation.count();
    const messagesBefore = await AIMessage.count();
    const response = await request(app).post('/api/ai/chat/message')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .field('message', 'analyze this')
      .attach('files', body, { filename, contentType });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_ATTACHMENT');
    await settle();
    expect(mockRedisStore[limitKey()] || 0).toBe(0);
    expect(await ObjectCleanupTask.count()).toBe(0);
    expect(await AIConversation.count()).toBe(conversationsBefore);
    expect(await AIMessage.count()).toBe(messagesBefore);
  });
});

describe('#3 free-consultation — нет double-spend под конкуренцией', () => {
  const book = (token, lawyerId, body, key) =>
    request(app).post(`/api/client/lawyers/${lawyerId}/book`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  test('N параллельных loyalty-броней у нового клиента → ровно одна бесплатная', async () => {
    const client = await makeClient(`l3_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    const { user: lawyer } = await makeLawyer(`l3law_${Date.now()}@t.uz`);

    const results = await Promise.all([1, 2, 3, 4].map((attempt) =>
      book(token, lawyer.id, { useFreePromo: true, question: 'q' }, `loyalty-race-${attempt}`)));
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

    const results = await Promise.all([1, 2, 3, 4, 5].map((attempt) =>
      book(token, lawyer.id, { useSubscriptionFree: true, question: 'q' }, `subscription-race-${attempt}`)));
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
