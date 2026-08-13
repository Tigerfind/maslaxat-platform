process.env.PAYME_KEY = 'refund-test-key';

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Payment, LawyerProfile, FinancialEvent } = models;
const paymeAuth = `Basic ${Buffer.from('Paycom:refund-test-key').toString('base64')}`;

beforeAll(async () => resetDb());

test('локальная отмена только запрашивает возврат, Payme подтверждает его отдельно', async () => {
  const client = await makeClient('refund-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('refund-lawyer@test.uz', { pendingBalance: 180000 });
  const consultation = await Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'pending', price: 180000,
  });
  const payment = await Payment.create({
    userId: client.id, consultationId: consultation.id, amount: 180000,
    provider: 'payme', status: 'paid', transactionId: 'refund-provider-tx',
  });

  const cancel = await request(app).post(`/api/consultations/${consultation.id}/cancel`)
    .set('Authorization', `Bearer ${tokenFor(client)}`).send({ reason: 'Передумал' });
  expect(cancel.status).toBe(200);
  await Promise.all([payment.reload(), lp.reload()]);
  expect(payment.status).toBe('paid');
  expect(payment.refundStatus).toBe('requested');
  expect(Number(lp.pendingBalance)).toBe(0);

  const checkBefore = await request(app).post('/api/payments/webhook').set('Authorization', paymeAuth)
    .send({ id: 1, method: 'CheckTransaction', params: { id: 'refund-provider-tx' } });
  expect(checkBefore.body.result.state).toBe(2);

  const providerCancel = await request(app).post('/api/payments/webhook').set('Authorization', paymeAuth)
    .send({ id: 2, method: 'CancelTransaction', params: { id: 'refund-provider-tx', reason: 5 } });
  expect(providerCancel.body.result.state).toBe(-2);
  await payment.reload();
  expect(payment.status).toBe('refunded');
  expect(payment.refundStatus).toBe('completed');
  expect(await FinancialEvent.count({ where: { paymentId: payment.id } })).toBe(2);
});

test('завершение не воскрешает отменённую консультацию и не выпускает escrow', async () => {
  const client = await makeClient('refund-race-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('refund-race-lawyer@test.uz', { pendingBalance: 100000 });
  const consultation = await Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'accepted', price: 100000,
  });
  await Payment.create({ userId: client.id, consultationId: consultation.id, amount: 100000, provider: 'payme', status: 'paid' });

  await request(app).post(`/api/consultations/${consultation.id}/cancel`)
    .set('Authorization', `Bearer ${tokenFor(client)}`).send({ reason: 'Отмена' });
  await request(app).post(`/api/consultations/${consultation.id}/complete`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);

  await Promise.all([consultation.reload(), lp.reload()]);
  expect(consultation.status).toBe('cancelled');
  expect(Number(lp.balance)).toBe(0);
  expect(Number(lp.pendingBalance)).toBe(0);
});
