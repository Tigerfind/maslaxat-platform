process.env.PAYME_KEY = 'test-payme-key';

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer } = require('./helpers');

const { Consultation, Payment, LawyerProfile, Notification, FinancialEvent } = models;
const auth = `Basic ${Buffer.from('Paycom:test-payme-key').toString('base64')}`;

beforeAll(async () => {
  await resetDb();
});

test('два параллельных PerformTransaction резервируют сумму ровно один раз', async () => {
  const client = await makeClient('payme-race-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('payme-race-lawyer@test.uz');
  const consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    question: 'q',
    status: 'payment_pending',
    price: 200000,
  });
  const payment = await Payment.create({
    consultationId: consultation.id,
    userId: client.id,
    amount: 200000,
    provider: 'payme',
    status: 'pending',
    transactionId: 'payme-race-tx',
    providerResponse: { createTime: Date.now() },
  });

  const perform = (rpcId) => request(app)
    .post('/api/payments/webhook')
    .set('Authorization', auth)
    .send({ jsonrpc: '2.0', id: rpcId, method: 'PerformTransaction', params: { id: 'payme-race-tx' } });

  const responses = await Promise.all([perform(1), perform(2)]);
  expect(responses.every((response) => response.body.result?.state === 2)).toBe(true);

  await Promise.all([payment.reload(), consultation.reload(), lp.reload()]);
  expect(payment.status).toBe('paid');
  expect(consultation.status).toBe('pending');
  expect(Number(lp.pendingBalance)).toBe(200000);
  expect(await Notification.count({
    where: { userId: lawyer.id, type: 'new_booking' },
  })).toBe(1);
});

test('Payme может напрямую отменить невысвобождённый paid-платёж ровно один раз', async () => {
  const client = await makeClient('payme-cancel-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('payme-cancel-lawyer@test.uz', { pendingBalance: 210000 });
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'refund', status: 'accepted', price: 210000 });
  const payment = await Payment.create({
    consultationId: consultation.id, userId: client.id, amount: 210000, provider: 'payme',
    status: 'paid', transactionId: 'payme-direct-cancel', providerResponse: { createTime: Date.now(), performTime: Date.now() },
  });
  const cancel = (id) => request(app).post('/api/payments/webhook').set('Authorization', auth)
    .send({ jsonrpc: '2.0', id, method: 'CancelTransaction', params: { id: 'payme-direct-cancel', reason: 5 } });
  const first = await cancel(10);
  const second = await cancel(11);
  expect(first.body.result.state).toBe(-2);
  expect(second.body.result.state).toBe(-2);
  await Promise.all([payment.reload(), consultation.reload(), lp.reload()]);
  expect(payment.status).toBe('refunded');
  expect(consultation.status).toBe('cancelled');
  expect(Number(lp.pendingBalance)).toBe(0);
  expect(await FinancialEvent.count({ where: { paymentId: payment.id } })).toBe(2);
});

test('GetStatement возвращает только Payme и все четыре состояния по createTime', async () => {
  const client = await makeClient('payme-statement-client@test.uz');
  const { user: lawyer } = await makeLawyer('payme-statement-lawyer@test.uz');
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'statement', status: 'cancelled' });
  const from = Date.now() - 1000;
  for (const [index, status] of ['pending', 'paid', 'failed', 'refunded'].entries()) {
    await Payment.create({
      consultationId: consultation.id, userId: client.id, amount: 1000 + index, provider: 'payme', status,
      transactionId: `statement-${status}`, providerResponse: { createTime: from + index + 1 },
    });
  }
  await Payment.create({ consultationId: consultation.id, userId: client.id, amount: 9999, provider: 'click', status: 'paid', transactionId: 'click-hidden', providerResponse: { createTime: from + 2 } });
  const response = await request(app).post('/api/payments/webhook').set('Authorization', auth)
    .send({ jsonrpc: '2.0', id: 20, method: 'GetStatement', params: { from, to: from + 100 } });
  expect(response.body.result.transactions.map((item) => item.state)).toEqual([1, 2, -1, -2]);
  expect(response.body.result.transactions.map((item) => item.id)).not.toContain('click-hidden');
});
