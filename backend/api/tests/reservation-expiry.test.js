const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const request = require('supertest');
const app = require('../src/server');
const { tokenFor } = require('./helpers');
const { expireDueReservations, expireReservationById } = require('../src/services/reservationExpiryService');

beforeEach(resetDb);

async function reservation(email, ageMinutes) {
  const client = await makeClient(`expiry-client-${email}@test.uz`);
  const { user: lawyer } = await makeLawyer(`expiry-lawyer-${email}@test.uz`);
  const promo = await models.Promo.create({ code: `EXP${email}`, discountPercent: 10, usedCount: 1, isActive: true });
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status: 'payment_pending', type: 'video',
    question: 'expiry', price: 200000, promoCode: promo.code, promoReservedAt: new Date(),
    createdAt: new Date(Date.now() - ageMinutes * 60000),
  });
  const payment = await models.Payment.create({
    consultationId: consultation.id, userId: client.id, amount: 200000, provider: 'payme', status: 'pending',
  });
  return { client, lawyer, promo, consultation, payment };
}

test('просроченная бронь атомарно отменяется и повтор не дублирует эффекты', async () => {
  const item = await reservation('old', 16);
  const results = await Promise.all([
    expireReservationById(item.consultation.id),
    expireReservationById(item.consultation.id),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  await Promise.all([item.consultation.reload(), item.payment.reload(), item.promo.reload()]);
  expect(item.consultation).toMatchObject({
    status: 'payment_expired', cancelledBy: 'system', cancellationType: 'payment_expired',
  });
  expect(item.payment.status).toBe('failed');
  expect(item.payment.providerResponse.reason).toBe('reservation_expired');
  expect(item.promo.usedCount).toBe(0);
  expect(await models.Notification.count({ where: { type: 'payment_expired' } })).toBe(2);
});

test('job не трогает свежие брони и обрабатывает старые', async () => {
  const fresh = await reservation('fresh', 5);
  const old = await reservation('job', 20);
  expect(await expireDueReservations()).toBe(1);
  await Promise.all([fresh.consultation.reload(), old.consultation.reload()]);
  expect(fresh.consultation.status).toBe('payment_pending');
  expect(old.consultation.status).toBe('payment_expired');
});

test('request-time expiry can be scoped to one participant', async () => {
  const first = await reservation('scoped-first', 20);
  const second = await reservation('scoped-second', 20);
  expect(await expireDueReservations(new Date(), { clientId: first.client.id })).toBe(1);
  await Promise.all([first.consultation.reload(), second.consultation.reload()]);
  expect(first.consultation.status).toBe('payment_expired');
  expect(second.consultation.status).toBe('payment_pending');
});

test('consultation list drains more than 100 scoped expirations without stale pending counts', async () => {
  const client = await makeClient('expiry-many-client@test.uz');
  const { user: lawyer } = await makeLawyer('expiry-many-lawyer@test.uz');
  const old = new Date(Date.now() - 20 * 60000);
  await models.Consultation.bulkCreate(Array.from({ length: 101 }, (_, index) => ({
    clientId: client.id, lawyerId: lawyer.id, status: 'payment_pending', type: 'chat',
    question: `expiry-${index}`, price: 1000, createdAt: old,
  })));
  const response = await request(app).get('/api/consultations?bucket=payment_pending')
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body.consultations).toHaveLength(0);
  expect(response.body.counts.payment_pending).toBe(0);
  expect(await models.Consultation.count({ where: { clientId: client.id, status: 'payment_expired' } })).toBe(101);
});
