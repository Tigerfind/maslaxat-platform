const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, LawyerProfile } = models;

beforeAll(async () => {
  await resetDb();
});

async function completedConsultation(clientId, lawyerId) {
  return Consultation.create({ clientId, lawyerId, question: 'q', status: 'completed', price: 100000 });
}

describe('reviews: рейтинг юриста пересчитывается из отзывов', () => {
  test('два отзыва (5 и 3) → рейтинг 4.0, reviewsCount 2', async () => {
    const client = await makeClient('revc@test.uz');
    const { user: lawyer, lp } = await makeLawyer('revl@test.uz');
    const token = tokenFor(client);

    const c1 = await completedConsultation(client.id, lawyer.id);
    const c2 = await completedConsultation(client.id, lawyer.id);

    const r1 = await request(app).post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: c1.id, rating: 5, text: 'отлично' });
    expect(r1.status).toBe(201);

    const r2 = await request(app).post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .send({ consultationId: c2.id, rating: 3, text: 'нормально' });
    expect(r2.status).toBe(201);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.rating)).toBe(4);
    expect(after.reviewsCount).toBe(2);
  });

  test('повторный отзыв на ту же консультацию → 409 (идемпотентно)', async () => {
    const client = await makeClient('revc2@test.uz');
    const { user: lawyer } = await makeLawyer('revl2@test.uz');
    const token = tokenFor(client);
    const c = await completedConsultation(client.id, lawyer.id);

    const first = await request(app).post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`).send({ consultationId: c.id, rating: 5, text: 'ок' });
    expect(first.status).toBe(201);

    const dup = await request(app).post(`/api/client/lawyers/${lawyer.id}/review`)
      .set('Authorization', `Bearer ${token}`).send({ consultationId: c.id, rating: 4, text: 'ещё раз' });
    expect(dup.status).toBe(409);
  });
});
