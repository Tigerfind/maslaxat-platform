const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const originalPaymeKey = process.env.PAYME_KEY;
const originalMerchant = process.env.PAYME_MERCHANT_ID;

beforeEach(resetDb);
afterAll(() => {
  if (originalPaymeKey === undefined) delete process.env.PAYME_KEY; else process.env.PAYME_KEY = originalPaymeKey;
  if (originalMerchant === undefined) delete process.env.PAYME_MERCHANT_ID; else process.env.PAYME_MERCHANT_ID = originalMerchant;
});

async function paymentPendingFixture(suffix) {
  const client = await makeClient(`resume-client-${suffix}@test.uz`);
  const { user: lawyer, lp } = await makeLawyer(`resume-lawyer-${suffix}@test.uz`);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'Оплата', status: 'payment_pending',
    type: 'video', meetingProvider: 'zoom', price: 250000,
  });
  return { client, lawyer, lp, consultation };
}

test('повторные и параллельные create возвращают один pending Payment', async () => {
  process.env.PAYME_KEY = 'test-payme-key';
  process.env.PAYME_MERCHANT_ID = 'test-merchant';
  const { client, consultation } = await paymentPendingFixture('create');
  const auth = `Bearer ${tokenFor(client)}`;
  const call = () => request(app).post('/api/payments/create').set('Authorization', auth).send({ consultationId: consultation.id });
  const [first, second] = await Promise.all([call(), call()]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.paymentId).toBe(second.body.paymentId);
  expect(await models.Payment.count({ where: { consultationId: consultation.id, status: 'pending' } })).toBe(1);
});

test('повторная simulation идемпотентна и резервирует escrow ровно один раз', async () => {
  delete process.env.PAYME_KEY;
  delete process.env.PAYME_MERCHANT_ID;
  const { client, lp, consultation } = await paymentPendingFixture('simulate');
  const auth = `Bearer ${tokenFor(client)}`;
  const call = () => request(app).post('/api/payments/simulate').set('Authorization', auth).send({ consultationId: consultation.id });
  const [first, second] = await Promise.all([call(), call()]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect([first.body.alreadyPaid, second.body.alreadyPaid].sort()).toEqual([false, true]);
  await Promise.all([consultation.reload(), lp.reload()]);
  expect(consultation.status).toBe('pending');
  expect(Number(lp.pendingBalance)).toBe(250000);
  expect(await models.Payment.count({ where: { consultationId: consultation.id, status: 'paid' } })).toBe(1);
});
