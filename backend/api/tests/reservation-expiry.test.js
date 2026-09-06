const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const { expireDueReservations, expireReservationById } = require('../src/services/reservationExpiryService');

beforeEach(resetDb);

async function reservation(email, ageMinutes) {
  const client = await makeClient(`expiry-client-${email}@test.uz`);
  const { user: lawyer } = await makeLawyer(`expiry-lawyer-${email}@test.uz`);
  const promo = await models.Promo.create({ code: `EXP${email}`, discountPercent: 10, usedCount: 1, isActive: true });
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status: 'payment_pending', type: 'video',
    question: 'expiry', price: 200000, promoCode: promo.code,
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
  expect(item.consultation.status).toBe('cancelled');
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
  expect(old.consultation.status).toBe('cancelled');
});
