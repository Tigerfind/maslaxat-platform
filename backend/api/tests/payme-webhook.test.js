const request = require('supertest');
const app = require('../src/server');
const logger = require('../src/config/logger');
const { parseWebhook } = require('../src/services/providers/payme');
const observability = require('../src/instrument');
const {
  resetDb,
  makePayment,
  makeClient,
  makeLawyer,
  models: { Consultation, FinancialTransaction, Notification, Payment },
} = require('./helpers');

jest.setTimeout(60000);

const originalPaymeKey = process.env.PAYME_KEY;
const originalPaymentV2Mode = process.env.PAYMENT_V2_MODE;

function setPaymeKey(key) {
  if (key === undefined) delete process.env.PAYME_KEY;
  else process.env.PAYME_KEY = key;
}

function webhookRequest(authorization) {
  const req = request(app)
    .post('/api/payments/webhook')
    .send({ jsonrpc: '2.0', id: 1, method: 'UnknownMethod', params: {} });

  return authorization === undefined ? req : req.set('Authorization', authorization);
}

afterEach(() => {
  setPaymeKey(originalPaymeKey);
  if (originalPaymentV2Mode === undefined) delete process.env.PAYMENT_V2_MODE;
  else process.env.PAYMENT_V2_MODE = originalPaymentV2Mode;
  jest.restoreAllMocks();
});

describe('Payme webhook authentication', () => {
  test.each([undefined, '', '   ', 'CHANGE_ME', 'sk-CHANGE_ME'])(
    'returns 503 before parsing credentials when PAYME_KEY=%p',
    async (key) => {
      setPaymeKey(key);

      const response = await webhookRequest('Basic invalid');

      expect(response.status).toBe(503);
    }
  );

  test.each([
    undefined,
    '',
    'Bearer token',
    'Basic',
    'Basic invalid',
    `Basic ${Buffer.from('missing-colon').toString('base64')}`,
  ])('rejects malformed Authorization header %p', async (authorization) => {
    setPaymeKey('real-test-key');

    const response = await webhookRequest(authorization);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(-32504);
  });

  test.each([
    Buffer.from('Paycom:wrong-key').toString('base64'),
    Buffer.from('Other:real-test-key').toString('base64'),
  ])('rejects wrong Basic credentials', async (token) => {
    setPaymeKey('real-test-key');

    const response = await webhookRequest(`Basic ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(-32504);
  });

  test('rejects valid credentials encoded as non-canonical unpadded Base64', async () => {
    setPaymeKey('real-test-key');
    const token = Buffer.from('Paycom:real-test-key').toString('base64').replace(/=+$/, '');

    const response = await webhookRequest(`Basic ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe(-32504);
  });

  test('allows exact Paycom credentials with canonical padded Base64', async () => {
    setPaymeKey('real-test-key');
    const token = Buffer.from('Paycom:real-test-key').toString('base64');

    const response = await webhookRequest(`Basic ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.error.code).toBe(-32601);
  });
});

test('swallowed webhook processing failures are explicitly reported without provider payload', async () => {
  setPaymeKey('real-test-key');
  const capture = jest.spyOn(observability, 'reportCaughtException').mockImplementation(() => {});
  jest.spyOn(Payment, 'findOne').mockRejectedValueOnce(new Error('database unavailable'));
  const token = Buffer.from('Paycom:real-test-key').toString('base64');

  const response = await request(app)
    .post('/api/payments/webhook')
    .set('Authorization', `Basic ${token}`)
    .send({
      jsonrpc: '2.0',
      id: 9,
      method: 'CheckPerformTransaction',
      params: { amount: 100, account: { consultation_id: 'payment-id' } },
    });

  expect(response.status).toBe(200);
  expect(capture).toHaveBeenCalledWith(expect.any(Error), {
    operation: 'payme_webhook',
    method: 'CheckPerformTransaction',
  });
  expect(JSON.stringify(capture.mock.calls)).not.toContain('payment-id');
});

describe('pure Payme protocol adapter', () => {
  test.each([
    ['CheckPerformTransaction', { amount: 10000, account: { consultation_id: 'payment-1' } }, { paymentId: 'payment-1', amountTiyin: 10000 }],
    ['CreateTransaction', { id: 'provider-1', time: 1700000000000, amount: 10000, account: { consultation_id: 'payment-1' } }, { paymentId: 'payment-1', providerTransactionId: 'provider-1', amountTiyin: 10000, time: 1700000000000 }],
    ['PerformTransaction', { id: 'provider-1' }, { providerTransactionId: 'provider-1' }],
    ['CancelTransaction', { id: 'provider-1', reason: 5 }, { providerTransactionId: 'provider-1', reason: 5 }],
    ['CheckTransaction', { id: 'provider-1' }, { providerTransactionId: 'provider-1' }],
    ['GetStatement', { from: 1700000000000, to: 1700000001000 }, { from: 1700000000000, to: 1700000001000 }],
  ])('normalizes %s without accessing business state', (method, params, expected) => {
    expect(parseWebhook({ jsonrpc: '2.0', id: 7, method, params })).toEqual({ id: 7, method, ...expected });
  });

  test.each([
    [{ id: 1, method: 'PerformTransaction', params: { id: 'provider-1' } }, /jsonrpc/i],
    [{ jsonrpc: '2.0', id: 1, method: 'CreateTransaction', params: { id: '', time: 1, amount: 1, account: {} } }, /transaction|account/i],
    [{ jsonrpc: '2.0', id: 1, method: 'GetStatement', params: { from: 2, to: 1 } }, /range/i],
    [{ jsonrpc: '2.0', id: 1, method: 'UnknownMethod', params: {} }, /method/i],
  ])('rejects malformed protocol input %#', (body, error) => {
    expect(() => parseWebhook(body)).toThrow(error);
  });
});

describe('Payme V2 shadow observation', () => {
  beforeEach(async () => {
    await resetDb();
    setPaymeKey('real-test-key');
    process.env.PAYMENT_V2_MODE = 'shadow';
  });

  test('records only sanitized comparison fields while legacy remains authoritative', async () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const token = Buffer.from('Paycom:real-test-key').toString('base64');

    const response = await request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 'sensitive-request-id',
        method: 'CheckPerformTransaction',
        params: { amount: 12345, account: { consultation_id: '11111111-1111-4111-8111-111111111111' } },
      });

    expect(response.status).toBe(200);
    expect(response.body.error.code).toBe(-31003);
    expect(info).toHaveBeenCalledWith('payment_v2_shadow', expect.objectContaining({
      scenarioId: 'CheckPerformTransaction:error:-31003',
      method: 'CheckPerformTransaction',
      v2Accepted: false,
      v2ErrorCode: -31003,
      legacyOutcome: 'error',
      legacyErrorCode: -31003,
      comparisonMatched: false,
      v2PayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      legacyPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const comparison = info.mock.calls[0][1];
    expect(comparison.v2PayloadHash).toBe(comparison.legacyPayloadHash);
    expect(JSON.stringify(info.mock.calls)).not.toContain('sensitive-request-id');
    expect(JSON.stringify(info.mock.calls)).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(info.mock.calls)).not.toContain('12345');
  });

  test('normalizes arbitrary unknown method names before recording shadow metrics', async () => {
    const info = jest.spyOn(logger, 'info').mockImplementation(() => {});
    const token = Buffer.from('Paycom:real-test-key').toString('base64');

    const response = await request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 12,
        method: 'secret-customer-value-998901234567',
        params: {},
      });

    expect(response.body.error.code).toBe(-32601);
    expect(info).toHaveBeenCalledWith('payment_v2_shadow', expect.objectContaining({
      scenarioId: 'unknown:error:-32601',
      method: 'unknown',
      v2Accepted: false,
      v2ErrorCode: -32601,
      legacyOutcome: 'error',
      legacyErrorCode: -32601,
      comparisonMatched: true,
      v2PayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      legacyPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    const comparison = info.mock.calls[0][1];
    expect(comparison.v2PayloadHash).toBe(comparison.legacyPayloadHash);
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret-customer-value');
    expect(JSON.stringify(info.mock.calls)).not.toContain('998901234567');
  });
});

describe('legacy Payme transaction binding', () => {
  beforeEach(async () => {
    await resetDb();
    setPaymeKey('real-test-key');
  });

  test('does not let a second CreateTransaction replace the bound provider transaction', async () => {
    const payment = await makePayment({ purpose: null });
    const token = Buffer.from('Paycom:real-test-key').toString('base64');
    const create = (providerTransactionId) => request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 9,
        method: 'CreateTransaction',
        params: {
          id: providerTransactionId,
          time: 1700000000000,
          amount: 10000,
          account: { consultation_id: payment.id },
        },
      });

    expect((await create('provider-original')).body.result.state).toBe(1);
    expect((await create('provider-replacement')).body.error.code).toBe(-31008);

    await payment.reload();
    expect(payment.transactionId).toBe('provider-original');
    expect(payment.providerTransactionId).toBe('provider-original');
    expect(payment.status).toBe('processing');
  });

  test('duplicate CreateTransaction returns the original stored createTime', async () => {
    const payment = await makePayment({ purpose: null });
    const token = Buffer.from('Paycom:real-test-key').toString('base64');
    const create = (time) => request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 13,
        method: 'CreateTransaction',
        params: {
          id: 'provider-create-time',
          time,
          amount: 10000,
          account: { consultation_id: payment.id },
        },
      });

    expect((await create(1700000000000)).body.result.create_time).toBe(1700000000000);
    expect((await create(1800000000000)).body.result.create_time).toBe(1700000000000);
  });

  test('CheckTransaction reports timing stored by the transactional service', async () => {
    await makePayment({
      purpose: null,
      status: 'paid',
      transactionId: 'provider-timing',
      providerTransactionId: 'provider-timing',
      providerData: { createTime: 1700000000000, performTime: 1700000005000 },
    });
    const token = Buffer.from('Paycom:real-test-key').toString('base64');

    const response = await request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 10,
        method: 'CheckTransaction',
        params: { id: 'provider-timing' },
      });

    expect(response.body.result.create_time).toBe(1700000000000);
    expect(response.body.result.perform_time).toBe(1700000005000);
    expect(response.body.result.state).toBe(2);
  });

  test('concurrent PerformTransaction and CancelTransaction cannot fail an activated payment', async () => {
    const client = await makeClient('payme-route-race-client@test.uz');
    const { user: lawyer } = await makeLawyer('payme-route-race-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Webhook race',
      status: 'payment_pending',
      price: 100000,
    });
    const payment = await Payment.create({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      amount: 100000,
      amountTiyin: 10000000,
      currency: 'UZS',
      provider: 'payme',
      status: 'processing',
      transactionId: 'provider-webhook-race',
      providerTransactionId: 'provider-webhook-race',
      providerData: { createTime: 1700000000000 },
    });
    const token = Buffer.from('Paycom:real-test-key').toString('base64');
    const post = (method, params) => request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({ jsonrpc: '2.0', id: 14, method, params });

    await Promise.all([
      post('PerformTransaction', { id: 'provider-webhook-race' }),
      post('CancelTransaction', { id: 'provider-webhook-race', reason: 5 }),
    ]);

    await payment.reload();
    await consultation.reload();
    const paidPosting = await FinancialTransaction.count({
      where: { operationKey: 'payme:paid:provider-webhook-race' },
    });
    if (paidPosting === 1) {
      expect(payment.status).toBe('refunded');
      expect(await FinancialTransaction.count({
        where: { operationKey: `consultation:refund:${payment.id}` },
      })).toBe(1);
    } else {
      expect(payment.status).toBe('failed');
    }
    expect(consultation.status).toBe('cancelled');
    expect(payment.status === 'failed' && paidPosting === 1).toBe(false);
  });

  test('already-paid PerformTransaction retry repairs failed durable notification without reposting money', async () => {
    const client = await makeClient('payme-notification-retry-client@test.uz');
    const { user: lawyer } = await makeLawyer('payme-notification-retry-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Notification retry',
      status: 'payment_pending',
      price: 100000,
    });
    const payment = await Payment.create({
      userId: client.id,
      consultationId: consultation.id,
      purpose: 'consultation',
      amount: 100000,
      amountTiyin: 10000000,
      currency: 'UZS',
      provider: 'payme',
      status: 'processing',
      transactionId: 'provider-notification-retry',
      providerTransactionId: 'provider-notification-retry',
      providerData: { createTime: 1700000000000 },
    });
    const token = Buffer.from('Paycom:real-test-key').toString('base64');
    const perform = () => request(app)
      .post('/api/payments/webhook')
      .set('Authorization', `Basic ${token}`)
      .send({
        jsonrpc: '2.0',
        id: 15,
        method: 'PerformTransaction',
        params: { id: 'provider-notification-retry' },
      });
    const persistence = jest.spyOn(Notification, 'findOrCreate')
      .mockRejectedValueOnce(new Error('temporary notification database failure'));

    const first = await perform();
    persistence.mockRestore();
    const retry = await perform();

    expect(first.body.error.code).toBe(-31008);
    expect(retry.body.error.code).toBe(-31060);
    await payment.reload();
    expect(payment.status).toBe('paid');
    expect(await FinancialTransaction.count({
      where: { operationKey: 'payme:paid:provider-notification-retry' },
    })).toBe(1);
    expect(await Notification.count({
      where: { dedupeKey: `payment:paid:${payment.id}:lawyer` },
    })).toBe(1);
  });
});
