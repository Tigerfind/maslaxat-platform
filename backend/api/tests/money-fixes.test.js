const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');
const { computeLoyalty } = require('../src/services/loyaltyService');

const { Consultation, Payment, LawyerProfile } = models;

beforeAll(async () => {
  await resetDb();
});

async function paidConsultation(clientId, lawyerId, { status = 'pending', amount = 200000 } = {}) {
  const cons = await Consultation.create({ clientId, lawyerId, question: 'q', status, price: amount });
  await Payment.create({ userId: clientId, consultationId: cons.id, amount, currency: 'UZS', provider: 'payme', status: 'paid' });
  return cons;
}

describe('деньги/эскроу — фиксы аудита', () => {
  test('video /end НЕ завершает pending (эскроу защищён)', async () => {
    const client = await makeClient('mf-c1@test.uz');
    const { user: lawyer, lp } = await makeLawyer('mf-l1@test.uz', { pendingBalance: 200000 });
    const cons = await paidConsultation(client.id, lawyer.id, { status: 'pending' });

    const res = await request(app).post(`/api/video/consultation/${cons.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(400);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.pendingBalance)).toBe(200000); // не тронуто
    expect((await Consultation.findByPk(cons.id)).status).toBe('pending');
  });

  test('video /end завершает in_progress и высвобождает эскроу', async () => {
    const client = await makeClient('mf-c2@test.uz');
    const { user: lawyer, lp } = await makeLawyer('mf-l2@test.uz', { pendingBalance: 200000 });
    const cons = await paidConsultation(client.id, lawyer.id, { status: 'in_progress' });

    const res = await request(app).post(`/api/video/consultation/${cons.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(200);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.balance)).toBe(200000);
    expect(Number(after.pendingBalance)).toBe(0);
  });

  test('video /start только из accepted, не из pending', async () => {
    const client = await makeClient('mf-c3@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l3@test.uz');
    const cons = await paidConsultation(client.id, lawyer.id, { status: 'pending' });
    const res = await request(app).post(`/api/video/consultation/${cons.id}/start`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(400);
  });

  test('отмена оплаченной консультации возвращает pendingBalance', async () => {
    const client = await makeClient('mf-c4@test.uz');
    const { user: lawyer, lp } = await makeLawyer('mf-l4@test.uz', { pendingBalance: 200000 });
    const cons = await paidConsultation(client.id, lawyer.id, { status: 'pending' });

    const res = await request(app).post(`/api/client/consultations/${cons.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`).send({ reason: 'передумал' });
    expect(res.status).toBe(200);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.pendingBalance)).toBe(0); // резерв снят
    expect((await Payment.findOne({ where: { consultationId: cons.id } })).status).toBe('refunded');
  });

  test('нельзя отменить завершённую консультацию', async () => {
    const client = await makeClient('mf-c5@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l5@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'completed', price: 100000 });
    const res = await request(app).post(`/api/client/consultations/${cons.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(400);
  });

  test('акция «первая бесплатно» сгорает после отмены (нельзя фармить)', async () => {
    const client = await makeClient('mf-c6@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l6@test.uz');
    // клиент забронировал бесплатную и отменил её
    await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'cancelled', price: 0, isFree: true });
    const loyalty = await computeLoyalty(client.id);
    expect(loyalty.freeNow).toBe(false); // бонус уже использован
  });

  test('длительность масштабирует цену (90 мин = 1.5×)', async () => {
    const client = await makeClient('mf-c7@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l7@test.uz', { price: 200000 });
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'q', consultationType: 'video', duration: 90 });
    expect(res.status).toBe(201);
    expect(res.body.consultation.duration).toBe(90);
    expect(res.body.consultation.price).toBe(300000); // 200000 * 90/60
  });
});
