const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

beforeAll(async () => {
  await resetDb();
});

describe('security: гейт тестовой оплаты', () => {
  test('POST /payments/simulate → 403 в боевом режиме (задан PAYME_KEY)', async () => {
    const client = await makeClient('sim@test.uz');
    const token = tokenFor(client);
    const prev = process.env.PAYME_KEY;
    process.env.PAYME_KEY = 'live-key';
    try {
      const res = await request(app)
        .post('/api/payments/simulate')
        .set('Authorization', `Bearer ${token}`)
        .send({ consultationId: '00000000-0000-0000-0000-000000000000' });
      expect(res.status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.PAYME_KEY;
      else process.env.PAYME_KEY = prev;
    }
  });

  test('без токена → 401', async () => {
    const res = await request(app).post('/api/payments/simulate').send({});
    expect(res.status).toBe(401);
  });
});

describe('security: подделка отзывов', () => {
  test('отзыв без своей завершённой консультации → 403', async () => {
    const client = await makeClient('rev@test.uz');
    const { user: lawyer } = await makeLawyer('revlaw@test.uz');
    const token = tokenFor(client);
    const res = await request(app)
      .post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: '00000000-0000-0000-0000-000000000000', rating: 5, text: 'fake' });
    expect(res.status).toBe(403);
  });

  test('нельзя оценить незавершённую консультацию → 400', async () => {
    const client = await makeClient('rev2@test.uz');
    const { user: lawyer } = await makeLawyer('revlaw2@test.uz');
    const cons = await models.Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000,
    });
    const token = tokenFor(client);
    const res = await request(app)
      .post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: cons.id, rating: 5, text: 'рано' });
    expect(res.status).toBe(400);
  });

  test('невалидная оценка (>5) → 400', async () => {
    const client = await makeClient('rev3@test.uz');
    const { user: lawyer } = await makeLawyer('revlaw3@test.uz');
    const token = tokenFor(client);
    const res = await request(app)
      .post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: 'x', rating: 9, text: 'плохо' });
    expect(res.status).toBe(400);
  });
});

describe('security: whitelist статусов консультации', () => {
  test('PATCH /consultations/:id/status с произвольным статусом → 400', async () => {
    const client = await makeClient('st@test.uz');
    const { user: lawyer } = await makeLawyer('stlaw@test.uz');
    await lawyer.update({ twoFactorEnabled: true });
    const cons = await models.Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000,
    });
    const token = tokenFor(lawyer, 'mfa');
    const res = await request(app)
      .patch(`/api/consultations/${cons.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Maslaxat-Mode', 'lawyer')
      .send({ status: 'hacked' });
    expect(res.status).toBe(400);
  });

  test('чужой юрист не может менять статус → 403', async () => {
    const client = await makeClient('st2@test.uz');
    const { user: lawyer } = await makeLawyer('stlaw2@test.uz');
    const { user: otherLawyer } = await makeLawyer('otherlaw@test.uz');
    await otherLawyer.update({ twoFactorEnabled: true });
    const cons = await models.Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000,
    });
    const token = tokenFor(otherLawyer, 'mfa');
    const res = await request(app)
      .patch(`/api/consultations/${cons.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Maslaxat-Mode', 'lawyer')
      .send({ status: 'completed' });
    expect(res.status).toBe(403);
  });
});
