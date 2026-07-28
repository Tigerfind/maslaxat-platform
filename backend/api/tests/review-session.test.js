const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Review } = models;

beforeAll(async () => { await resetDb(); });

describe('#5 duplicate reviews — one review per consultation', () => {
  async function seedCompleted() {
    const client = await makeClient(`rv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@t.uz`);
    const { user: lawyer } = await makeLawyer(`rvl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@t.uz`);
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'completed', price: 100000 });
    return { client, lawyer, cons, token: tokenFor(client) };
  }
  const review = (token, lawyerId, consultationId) =>
    request(app).post(`/api/client/lawyers/${lawyerId}/review`).set('Authorization', `Bearer ${token}`)
      .send({ consultationId, rating: 5, text: 'ok' });

  test('2 параллельных отзыва на одну консультацию → один 201, один 409, в БД одна строка', async () => {
    const { lawyer, cons, token } = await seedCompleted();
    const [a, b] = await Promise.all([review(token, lawyer.id, cons.id), review(token, lawyer.id, cons.id)]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([201, 409]);                        // ровно один создан
    const count = await Review.count({ where: { consultationId: cons.id } });
    expect(count).toBe(1);                                    // без дубля
  });

  test('повторный отзыв позже → 409 (не 500), строк по-прежнему одна', async () => {
    const { lawyer, cons, token } = await seedCompleted();
    const first = await review(token, lawyer.id, cons.id);
    expect(first.status).toBe(201);
    const second = await review(token, lawyer.id, cons.id);
    expect(second.status).toBe(409);
    const count = await Review.count({ where: { consultationId: cons.id } });
    expect(count).toBe(1);
  });
});

describe('#6 password change — invalidates old sessions, keeps current', () => {
  const loyalty = (token) =>
    request(app).get('/api/client/consultations/loyalty').set('Authorization', `Bearer ${token}`);

  test('смена пароля выкидывает старый токен, а новый (возвращённый) работает', async () => {
    const client = await makeClient(`pw_${Date.now()}@t.uz`); // пароль 'passw0rd' из фабрики
    // Старый токен выдан РАНЬШЕ (iat в прошлом), иначе окно «та же секунда» флакает тест.
    const oldToken = jwt.sign(
      { id: client.id, role: 'client', iat: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_SECRET
    );

    // Старый токен пока валиден (passwordChangedAt ещё не выставлен)
    expect((await loyalty(oldToken)).status).toBe(200);

    const changed = await request(app).put('/api/client/users/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ oldPassword: 'passw0rd', newPassword: 'newpass123' });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.token).toBe('string');         // выдан свежий токен

    // Старый токен теперь выкинут (iat < passwordChangedAt)
    expect((await loyalty(oldToken)).status).toBe(401);
    // Новый токен (текущая сессия) продолжает работать
    expect((await loyalty(changed.body.token)).status).toBe(200);
  });

  test('неверный текущий пароль → 400, токен не выдаётся, сессии не трогаются', async () => {
    const client = await makeClient(`pw2_${Date.now()}@t.uz`);
    const token = tokenFor(client);
    const res = await request(app).put('/api/client/users/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ oldPassword: 'wrong', newPassword: 'newpass123' });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
    expect((await loyalty(token)).status).toBe(200);          // текущая сессия жива
  });
});
