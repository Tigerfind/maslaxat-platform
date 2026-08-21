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
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ durationSeconds: 725 });
    expect(res.status).toBe(200);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.balance)).toBe(200000);
    expect(Number(after.pendingBalance)).toBe(0);
    // фактическая длительность звонка сохранена
    expect((await Consultation.findByPk(cons.id)).actualDuration).toBe(725);
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
    const payment = await Payment.findOne({ where: { consultationId: cons.id } });
    expect(payment.status).toBe('paid');
    expect(payment.refundStatus).toBe('requested');
  });

  test('нельзя отменить завершённую консультацию', async () => {
    const client = await makeClient('mf-c5@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l5@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'completed', price: 100000 });
    const res = await request(app).post(`/api/client/consultations/${cons.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(400);
  });

  test('нельзя отменить идущую консультацию (in_progress)', async () => {
    const client = await makeClient('mf-c8@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l8@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'in_progress', price: 100000 });
    const res = await request(app).post(`/api/client/consultations/${cons.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(400);
  });

  test('/join НЕ переводит консультацию в in_progress (закрыт бэкдор эскроу)', async () => {
    const client = await makeClient('mf-c9@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l9@test.uz');
    const start = new Date(Date.now() + 5 * 60000);
    const cons = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000,
      scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 60 * 60000),
    });
    const res = await request(app).post(`/api/client/consultations/${cons.id}/join`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(res.status).toBe(200);
    expect((await Consultation.findByPk(cons.id)).status).toBe('accepted'); // статус не изменился
  });

  test('акция «первая бесплатно» сгорает после отмены (нельзя фармить)', async () => {
    const client = await makeClient('mf-c6@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l6@test.uz');
    // клиент забронировал бесплатную и отменил её
    await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'cancelled', price: 0, isFree: true });
    const loyalty = await computeLoyalty(client.id);
    expect(loyalty.freeNow).toBe(false); // бонус уже использован
  });

  test('продление: +15 мин добавляет доплату, эскроу выплачивает сумму всех платежей', async () => {
    const client = await makeClient('mf-ext-c@test.uz');
    const { user: lawyer, lp } = await makeLawyer('mf-ext-l@test.uz', { price: 200000, pendingBalance: 200000 });
    // оплаченная идущая консультация (оригинал 200000 зарезервирован)
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'in_progress', price: 200000, duration: 60 });
    await Payment.create({ userId: client.id, consultationId: cons.id, amount: 200000, currency: 'UZS', provider: 'payme', status: 'paid' });

    // продление на 15 мин → доплата 50000
    const ext = await request(app).post(`/api/video/consultation/${cons.id}/extend`)
      .set('Authorization', `Bearer ${tokenFor(client)}`).send({ minutes: 15 });
    expect(ext.status).toBe(200);
    expect(ext.body.addAmount).toBe(50000);
    expect(ext.body.duration).toBe(75);
    expect(ext.body.price).toBe(250000);

    const afterExt = await LawyerProfile.findByPk(lp.id);
    expect(Number(afterExt.pendingBalance)).toBe(250000); // 200000 + 50000

    // завершение → выплачивается СУММА всех платежей (оригинал + продление)
    const end = await request(app).post(`/api/video/consultation/${cons.id}/end`)
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`);
    expect(end.status).toBe(200);
    const done = await LawyerProfile.findByPk(lp.id);
    expect(Number(done.balance)).toBe(250000);
    expect(Number(done.pendingBalance)).toBe(0);
  });

  test('длительность масштабирует цену (90 мин = 1.5×)', async () => {
    const client = await makeClient('mf-c7@test.uz');
    const { user: lawyer } = await makeLawyer('mf-l7@test.uz', { price: 200000 });
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'q', consultationType: 'video', duration: 90, acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(res.status).toBe(201);
    expect(res.body.consultation.duration).toBe(90);
    expect(res.body.consultation.price).toBe(300000); // 200000 * 90/60
  });
});
