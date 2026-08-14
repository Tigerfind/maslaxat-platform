const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Review } = models;

beforeAll(async () => {
  await resetDb();
});

describe('гварды доступа/валидации — фиксы аудита', () => {
  test('chat /unread — не участник получает 403', async () => {
    const client = await makeClient('ag-c1@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l1@test.uz');
    const outsider = await makeClient('ag-out@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000 });

    const res = await request(app).get(`/api/chat/${cons.id}/unread`)
      .set('Authorization', `Bearer ${tokenFor(outsider)}`);
    expect(res.status).toBe(403);
  });

  test('favorites — юристу запрещено (authorize client)', async () => {
    const { user: lawyer } = await makeLawyer('ag-l2@test.uz');
    const { user: other } = await makeLawyer('ag-l2b@test.uz');
    const res = await request(app).post(`/api/client/favorites/${other.id}`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(403);
  });

  test('reply на отзыв — пустой ответ 400', async () => {
    const client = await makeClient('ag-c3@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l3@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'completed', price: 100000 });
    const review = await Review.create({ clientId: client.id, lawyerId: lawyer.id, consultationId: cons.id, rating: 5, text: 'ок' });

    const res = await request(app).post(`/api/lawyer/reviews/${review.id}/reply`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ reply: '   ' });
    expect(res.status).toBe(400);
  });

  test('helpful — нельзя накрутить свой отзыв 403', async () => {
    const client = await makeClient('ag-c4@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l4@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'completed', price: 100000 });
    const review = await Review.create({ clientId: client.id, lawyerId: lawyer.id, consultationId: cons.id, rating: 5, text: 'ок' });

    const res = await request(app).post(`/api/lawyer/reviews/${review.id}/helpful`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(403);
  });

  test('book — неверный формат даты 400', async () => {
    const client = await makeClient('ag-c5@test.uz');
    const { user: lawyer } = await makeLawyer('ag-l5@test.uz');
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'q', preferredDate: '31-12-2026', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(res.status).toBe(400);
  });

  test('settings — произвольные ключи отсекаются (whitelist)', async () => {
    const client = await makeClient('ag-c6@test.uz');
    const res = await request(app).put('/api/client/users/settings')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ compactMode: true, hackerField: 'evil' });
    expect(res.status).toBe(200);
    expect(res.body.settings.compactMode).toBe(true);
    expect(res.body.settings.hackerField).toBeUndefined();
  });
});
