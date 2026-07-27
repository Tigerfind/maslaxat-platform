const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Subscription } = models;

beforeAll(async () => {
  await resetDb();
});

async function book(token, lawyerId, body) {
  return request(app).post(`/api/client/lawyers/${lawyerId}/book`)
    .set('Authorization', `Bearer ${token}`)
    .send({ question: 'q', consultationType: 'video', ...body });
}

describe('подписочная льгота: N бесплатных консультаций/мес', () => {
  test('basic (1/мес): первая бесплатна по подписке, вторая — платная', async () => {
    const client = await makeClient('sub-c1@test.uz');
    const { user: lawyer } = await makeLawyer('sub-l1@test.uz', { price: 200000 });
    const token = tokenFor(client);
    const future = new Date(); future.setMonth(future.getMonth() + 1);
    await Subscription.create({ userId: client.id, plan: 'basic', price: 99000, expiresAt: future });

    // /my показывает остаток 1
    const my1 = await request(app).get('/api/subscriptions/my').set('Authorization', `Bearer ${token}`);
    expect(my1.body.consultationsLeft).toBe(1);

    // бронь по подписке → бесплатно
    const b1 = await book(token, lawyer.id, { useSubscriptionFree: true });
    expect(b1.status).toBe(201);
    expect(b1.body.consultation.isFree).toBe(true);
    expect(b1.body.consultation.price).toBe(0);
    expect(b1.body.consultation.freeSource).toBe('subscription');
    expect(b1.body.consultation.status).toBe('pending'); // бесплатная сразу уходит юристу

    // остаток исчерпан
    const my2 = await request(app).get('/api/subscriptions/my').set('Authorization', `Bearer ${token}`);
    expect(my2.body.consultationsLeft).toBe(0);

    // вторая попытка «по подписке» → уже платная (лимит исчерпан)
    const b2 = await book(token, lawyer.id, { useSubscriptionFree: true });
    expect(b2.status).toBe(201);
    expect(b2.body.consultation.isFree).toBe(false);
    expect(b2.body.consultation.price).toBe(200000);
    expect(b2.body.consultation.status).toBe('payment_pending');
  });

  test('без подписки (free) льготы нет — бронь платная', async () => {
    const client = await makeClient('sub-c2@test.uz');
    const { user: lawyer } = await makeLawyer('sub-l2@test.uz', { price: 150000 });
    const token = tokenFor(client);
    const my = await request(app).get('/api/subscriptions/my').set('Authorization', `Bearer ${token}`);
    expect(my.body.consultationsLeft).toBe(0);
    const b = await book(token, lawyer.id, { useSubscriptionFree: true });
    expect(b.body.consultation.isFree).toBe(false);
    expect(b.body.consultation.price).toBe(150000);
  });

  test('отмена подписочной брони возвращает лимит месяца', async () => {
    const client = await makeClient('sub-c3@test.uz');
    const { user: lawyer } = await makeLawyer('sub-l3@test.uz', { price: 100000 });
    const token = tokenFor(client);
    const future = new Date(); future.setMonth(future.getMonth() + 1);
    await Subscription.create({ userId: client.id, plan: 'basic', price: 99000, expiresAt: future });

    const b = await book(token, lawyer.id, { useSubscriptionFree: true });
    expect(b.body.consultation.freeSource).toBe('subscription');
    // остаток 0
    let my = await request(app).get('/api/subscriptions/my').set('Authorization', `Bearer ${token}`);
    expect(my.body.consultationsLeft).toBe(0);

    // отмена → лимит снова доступен
    await request(app).post(`/api/client/consultations/${b.body.consultation.id}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    my = await request(app).get('/api/subscriptions/my').set('Authorization', `Bearer ${token}`);
    expect(my.body.consultationsLeft).toBe(1);
  });
});
