const request = require('supertest');
const app = require('../src/server');
const { completeConsultation } = require('../src/services/escrow');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, LawyerProfile, Promo, Subscription, User } = models;

beforeAll(async () => {
  await resetDb();
});

describe('бизнес-фиксы из аудита', () => {
  test('completedCases растёт для бесплатной консультации (без оплаты)', async () => {
    const client = await makeClient('bf-c1@test.uz');
    const { user: lawyer, lp } = await makeLawyer('bf-l1@test.uz');
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'in_progress', price: 0, isFree: true });

    const res = await completeConsultation(cons.id);
    expect(res.released).toBe(false); // оплаты не было
    const after = await LawyerProfile.findByPk(lp.id);
    expect(after.completedCases).toBe(1); // но кейс засчитан
  });

  test('промокод возвращает usedCount при отмене брони', async () => {
    const client = await makeClient('bf-c2@test.uz');
    const { user: lawyer } = await makeLawyer('bf-l2@test.uz', { price: 200000 });
    const promo = await Promo.create({ code: 'BFTEST10', discountPercent: 10, isActive: true, usageLimit: 5, usedCount: 0 });

    // бронь с промокодом → usedCount 1, promoCode сохранён
    const book = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'q', consultationType: 'video', promoCode: 'BFTEST10', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(book.status).toBe(201);
    expect((await Promo.findByPk(promo.id)).usedCount).toBe(1);
    const consId = book.body.consultation.id;
    expect(book.body.consultation.promoCode).toBe('BFTEST10');

    // отмена → usedCount возвращается к 0
    const cancel = await request(app).post(`/api/client/consultations/${consId}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(cancel.status).toBe(200);
    expect((await Promo.findByPk(promo.id)).usedCount).toBe(0);
  });

  test('апгрейд подписки продлевает срок от текущего, а не от сегодня', async () => {
    const client = await makeClient('bf-c3@test.uz');
    // активная подписка на 20 дней вперёд
    const future = new Date(); future.setDate(future.getDate() + 20);
    await Subscription.create({ userId: client.id, plan: 'basic', price: 99000, expiresAt: future });

    const res = await request(app).post('/api/subscriptions/upgrade')
      .set('Authorization', `Bearer ${tokenFor(client)}`).send({ plan: 'basic' });
    expect(res.status).toBe(200);
    // новый срок ~ future + 1 месяц (заметно больше, чем now + 1 месяц)
    const sub = await Subscription.findOne({ where: { userId: client.id } });
    const nowPlusMonth = new Date(); nowPlusMonth.setMonth(nowPlusMonth.getMonth() + 1);
    expect(new Date(sub.expiresAt).getTime()).toBeGreaterThan(nowPlusMonth.getTime() + 10 * 24 * 3600 * 1000);
  });
});
