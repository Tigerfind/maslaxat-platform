const request = require('supertest');
const app = require('../src/server');
const {
  sequelize,
  models: {
    Consultation,
    FinancialEntry,
    FinancialTransaction,
    Notification,
    Payment,
    Subscription,
  },
  resetDb,
  tokenFor,
  makeClient,
  makeLawyer,
} = require('./helpers');
const {
  createCheckout,
  markProviderCancelled,
  markPaymentProcessing,
  markPaymentPaid,
  markProviderRefunded,
  requestPaymentCancellation,
} = require('../src/services/paymentService');
const {
  ACCOUNTS,
  recognizeDeferredRevenue,
  requestConsultationRefund,
} = require('../src/services/ledgerService');
const notificationService = require('../src/services/notificationService');

const originalMerchantId = process.env.PAYME_MERCHANT_ID;

async function makeConsultationPayment(emailPrefix, overrides = {}) {
  const client = await makeClient(`${emailPrefix}-client@test.uz`);
  const { user: lawyer, lp } = await makeLawyer(`${emailPrefix}-lawyer@test.uz`);
  const consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    question: 'Payment service test',
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
    status: 'pending',
    ...overrides,
  });
  return { client, lawyer, lp, consultation, payment };
}

beforeAll(async () => {
  process.env.PAYME_MERCHANT_ID = 'test-merchant';
  await resetDb();
});

afterAll(() => {
  if (originalMerchantId === undefined) delete process.env.PAYME_MERCHANT_ID;
  else process.env.PAYME_MERCHANT_ID = originalMerchantId;
});

afterEach(() => jest.restoreAllMocks());

describe('transactional payment service', () => {
  test('serializes duplicate paid events and posts the provider operation once', async () => {
    const { payment, consultation, lp, lawyer } = await makeConsultationPayment('paid-race');
    const event = {
      paymentId: payment.id,
      providerTransactionId: 'tx-race-1',
      amountTiyin: 10000000,
      providerData: { performTime: 1700000000000 },
    };

    const [a, b] = await Promise.all([markPaymentPaid(event), markPaymentPaid(event)]);

    expect(a.payment.id).toBe(payment.id);
    expect(b.payment.id).toBe(payment.id);
    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:tx-race-1' } })).toBe(1);
    await payment.reload();
    await consultation.reload();
    await lp.reload();
    expect(payment.status).toBe('paid');
    expect(payment.providerTransactionId).toBe('tx-race-1');
    expect(consultation.status).toBe('pending');
    expect(Number(lp.pendingBalance)).toBe(85000);
    expect(await Notification.count({ where: { userId: lawyer.id, type: 'new_booking' } })).toBe(1);
    const notification = await Notification.findOne({ where: { userId: lawyer.id, type: 'new_booking' } });
    expect(notification.dedupeKey).toBe(`payment:paid:${payment.id}:lawyer`);
  });

  test('retries durable notification delivery after money committed without reposting money', async () => {
    const { payment, lawyer } = await makeConsultationPayment('notification-retry');
    const event = {
      paymentId: payment.id,
      providerTransactionId: 'tx-notification-retry',
      amountTiyin: 10000000,
      providerData: { performTime: 1700000000400 },
    };
    const delivery = jest.spyOn(notificationService, 'createNotification')
      .mockRejectedValueOnce(new Error('temporary notification persistence failure'));

    await expect(markPaymentPaid(event)).rejects.toThrow(/notification persistence/i);
    delivery.mockRestore();

    await payment.reload();
    expect(payment.status).toBe('paid');
    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:tx-notification-retry' } })).toBe(1);
    expect(await Notification.count({ where: { userId: lawyer.id } })).toBe(0);

    await markPaymentPaid(event);

    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:tx-notification-retry' } })).toBe(1);
    expect(await Notification.count({
      where: { userId: lawyer.id, dedupeKey: `payment:paid:${payment.id}:lawyer` },
    })).toBe(1);
  });

  test('deduplicates concurrent durable notification attempts by payment key', async () => {
    const client = await makeClient('notification-dedupe-client@test.uz');
    const metadata = { consultationId: '11111111-1111-4111-8111-111111111111' };
    const args = [
      client.id,
      'new_booking',
      'Новая консультация',
      'Клиент оплатил консультацию.',
      metadata,
      { dedupeKey: 'payment:paid:dedupe-test:lawyer' },
    ];

    const [a, b] = await Promise.all([
      notificationService.createNotification(...args),
      notificationService.createNotification(...args),
    ]);

    expect(a.id).toBe(b.id);
    expect(await Notification.count({ where: { dedupeKey: 'payment:paid:dedupe-test:lawyer' } })).toBe(1);
  });

  test('payment notification persistence failure is propagated so the provider can retry', async () => {
    const client = await makeClient('notification-persistence-failure@test.uz');
    jest.spyOn(Notification, 'findOrCreate').mockRejectedValueOnce(new Error('notification database unavailable'));

    await expect(notificationService.createNotification(
      client.id,
      'new_booking',
      'Новая консультация',
      'Клиент оплатил консультацию.',
      { consultationId: '11111111-1111-4111-8111-111111111111' },
      { dedupeKey: 'payment:paid:persistence-failure:lawyer', throwOnError: true }
    )).rejects.toThrow(/database unavailable/i);
  });

  test('rejects an inexact amount without changing payment or ledger state', async () => {
    const { payment } = await makeConsultationPayment('wrong-amount');

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-wrong-amount',
      amountTiyin: 9999999,
      providerData: {},
    })).rejects.toThrow(/amount/i);

    await payment.reload();
    expect(payment.status).toBe('pending');
    expect(await FinancialTransaction.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  test('serializes provider perform and cancel into one valid terminal state', async () => {
    const { payment, consultation } = await makeConsultationPayment('perform-cancel-race', {
      status: 'processing',
      transactionId: 'tx-perform-cancel-race',
      providerTransactionId: 'tx-perform-cancel-race',
    });
    const paidEvent = {
      paymentId: payment.id,
      providerTransactionId: 'tx-perform-cancel-race',
      amountTiyin: 10000000,
      providerData: { performTime: 1700000000100 },
    };
    const cancelEvent = {
      paymentId: payment.id,
      providerTransactionId: 'tx-perform-cancel-race',
      cancelTime: 1700000000200,
      reason: 5,
    };

    const [paid, cancelled] = await Promise.allSettled([
      markPaymentPaid(paidEvent),
      markProviderCancelled(cancelEvent),
    ]);

    expect(cancelled.status).toBe('fulfilled');
    await payment.reload();
    await consultation.reload();
    const paidPostings = await FinancialTransaction.count({
      where: { operationKey: 'payme:paid:tx-perform-cancel-race' },
    });
    if (paid.status === 'fulfilled') {
      expect(payment.status).toBe('refunded');
      expect(consultation.status).toBe('cancelled');
      expect(paidPostings).toBe(1);
      expect(await FinancialTransaction.count({
        where: { operationKey: `consultation:refund:${payment.id}` },
      })).toBe(1);
    } else {
      expect(payment.status).toBe('failed');
      expect(consultation.status).toBe('cancelled');
      expect(paidPostings).toBe(0);
    }
  });

  test('late paid callback cannot resurrect a cancelled consultation', async () => {
    const { payment, consultation } = await makeConsultationPayment('late-paid-cancelled', {
      status: 'processing',
      transactionId: 'tx-late-cancelled',
      providerTransactionId: 'tx-late-cancelled',
    });
    await consultation.update({ status: 'cancelled' });

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-late-cancelled',
      amountTiyin: 10000000,
      providerData: { performTime: 1700000000300 },
    })).rejects.toThrow(/consultation.*payment|awaiting payment|cancel/i);

    await payment.reload();
    await consultation.reload();
    expect(payment.status).toBe('processing');
    expect(consultation.status).toBe('cancelled');
    expect(await FinancialTransaction.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  test('participant cancellation request fails only an unbound pending payment locally', async () => {
    const { client, payment, consultation } = await makeConsultationPayment('pending-cancel-request');
    const requestedAt = new Date('2030-01-01T00:00:00.000Z');

    const result = await requestPaymentCancellation({
      paymentId: payment.id,
      requestedBy: client.id,
      reason: 'changed_plans',
      now: requestedAt,
    });

    await payment.reload();
    await consultation.reload();
    expect(result.outcome).toBe('cancelled');
    expect(payment.status).toBe('failed');
    expect(consultation.status).toBe('cancelled');
    expect(payment.providerData.cancellationRequest).toEqual({
      state: 'cancelled_locally',
      requestedAt: requestedAt.toISOString(),
      requestedBy: client.id,
      reason: 'changed_plans',
    });
  });

  test('participant cancellation request keeps processing provider-owned until confirmation', async () => {
    const { client, payment, consultation } = await makeConsultationPayment('processing-cancel-request', {
      status: 'processing',
      transactionId: 'tx-processing-cancel-request',
      providerTransactionId: 'tx-processing-cancel-request',
    });
    const requestedAt = new Date('2030-01-01T00:01:00.000Z');

    const result = await requestPaymentCancellation({
      paymentId: payment.id,
      requestedBy: client.id,
      reason: 'changed_plans',
      now: requestedAt,
    });

    await payment.reload();
    await consultation.reload();
    expect(result.outcome).toBe('cancellation_requested');
    expect(payment.status).toBe('processing');
    expect(consultation.status).toBe('cancelled');
    expect(payment.providerData.cancellationRequest).toEqual({
      state: 'requested',
      requestedAt: requestedAt.toISOString(),
      requestedBy: client.id,
      reason: 'changed_plans',
    });

    await markProviderCancelled({
      paymentId: payment.id,
      providerTransactionId: 'tx-processing-cancel-request',
      cancelTime: requestedAt.getTime() + 1000,
      reason: 5,
    });
    await payment.reload();
    expect(payment.status).toBe('failed');
  });

  test('late paid callback after cancellation request is accounted then awaits provider refund', async () => {
    const { client, lawyer, lp, payment, consultation } = await makeConsultationPayment('late-paid-cancel-request', {
      status: 'processing',
      transactionId: 'tx-late-paid-cancel-request',
      providerTransactionId: 'tx-late-paid-cancel-request',
    });
    await requestPaymentCancellation({
      paymentId: payment.id,
      requestedBy: client.id,
      reason: 'changed_plans',
      now: new Date('2030-01-01T00:02:00.000Z'),
    });

    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-late-paid-cancel-request',
      amountTiyin: 10000000,
      providerData: { performTime: 1893456121000 },
    });

    await payment.reload();
    await consultation.reload();
    await lp.reload();
    expect(payment.status).toBe('refund_pending');
    expect(consultation.status).toBe('cancelled');
    expect(Number(lp.pendingBalance)).toBe(85000);
    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:tx-late-paid-cancel-request' } })).toBe(1);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:refund:${payment.id}` } })).toBe(0);
    expect(await Notification.count({ where: { userId: lawyer.id, type: 'new_booking' } })).toBe(0);

    await markProviderCancelled({
      paymentId: payment.id,
      providerTransactionId: 'tx-late-paid-cancel-request',
      cancelTime: 1893456122000,
      reason: 5,
    });
    await payment.reload();
    await lp.reload();
    expect(payment.status).toBe('refunded');
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:refund:${payment.id}` } })).toBe(1);
  });

  test('rejects malformed durable cancellation metadata before payment transition', async () => {
    const { payment } = await makeConsultationPayment('malformed-cancel-metadata', {
      status: 'processing',
      transactionId: 'tx-malformed-cancel-metadata',
      providerTransactionId: 'tx-malformed-cancel-metadata',
      providerData: {
        cancellationRequest: {
          state: 'requested',
          requestedAt: '2030-01-01T00:00:00.000Z',
          requestedBy: 'user-1',
          reason: 'x',
          injected: true,
        },
      },
    });

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-malformed-cancel-metadata',
      amountTiyin: 10000000,
      providerData: { performTime: 1893456123000 },
    })).rejects.toThrow(/cancellation.*metadata/i);
  });

  test('rejects a different provider transaction on a paid retry', async () => {
    const { payment } = await makeConsultationPayment('wrong-provider-tx');
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-original',
      amountTiyin: 10000000,
      providerData: {},
    });

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-different',
      amountTiyin: 10000000,
      providerData: {},
    })).rejects.toThrow(/transaction/i);
  });

  test('activates a subscription once under duplicate provider delivery', async () => {
    const client = await makeClient('subscription-paid-race@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const { payment } = await createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'subscription-paid-race-key',
      plan: 'basic',
    });
    const event = {
      paymentId: payment.id,
      providerTransactionId: 'tx-subscription-1',
      amountTiyin: 9900000,
      providerData: { performTime: 1700000000001 },
    };

    await Promise.all([markPaymentPaid(event), markPaymentPaid(event)]);

    await subscription.reload();
    expect(subscription.plan).toBe('basic');
    expect(Number(subscription.price)).toBe(99000);
    expect(await FinancialTransaction.count({ where: { operationKey: 'payme:paid:tx-subscription-1' } })).toBe(1);
  });

  test('confirmed provider refund uses the strict consultation refund posting once', async () => {
    const { payment, consultation, lp } = await makeConsultationPayment('refund-race');
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-refund-1',
      amountTiyin: 10000000,
      providerData: {},
    });
    await sequelize.transaction((tx) => requestConsultationRefund(payment, tx));

    const event = {
      paymentId: payment.id,
      amountTiyin: 10000000,
      providerTransactionId: 'tx-refund-1',
    };
    await Promise.all([markProviderRefunded(event), markProviderRefunded(event)]);

    await payment.reload();
    await consultation.reload();
    await lp.reload();
    expect(payment.status).toBe('refunded');
    expect(Number(payment.refundedAmountTiyin)).toBe(10000000);
    expect(Number(consultation.grossAmountTiyin)).toBe(0);
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(await FinancialTransaction.count({ where: { operationKey: `consultation:refund:${payment.id}` } })).toBe(1);
  });

  test('refuses provider refund confirmation with a mismatched transaction', async () => {
    const { payment } = await makeConsultationPayment('refund-wrong-tx');
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-refund-original',
      amountTiyin: 10000000,
      providerData: {},
    });
    await sequelize.transaction((tx) => requestConsultationRefund(payment, tx));

    await expect(markProviderRefunded({
      paymentId: payment.id,
      amountTiyin: 10000000,
      providerTransactionId: 'tx-refund-other',
    })).rejects.toThrow(/transaction/i);

    await payment.reload();
    expect(payment.status).toBe('refund_pending');
  });

  test('provider-confirmed subscription refund reverses only unearned deferred revenue and entitlement', async () => {
    const client = await makeClient('subscription-refund@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const { payment } = await createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'subscription-refund-key',
      plan: 'basic',
    });
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-subscription-refund',
      amountTiyin: 9900000,
      providerData: { performTime: 1700000000500 },
    });
    await payment.reload();
    const start = new Date(payment.providerData.termStart).getTime();
    const end = new Date(payment.providerData.termEnd).getTime();
    await recognizeDeferredRevenue({ through: new Date(start + Math.floor((end - start) / 2)) });
    const [recognizedRows] = await sequelize.query(`
      SELECT COALESCE(SUM(fe.amount_tiyin), 0) AS amount
      FROM financial_entries fe
      JOIN financial_transactions ft ON ft.id = fe.financial_transaction_id
      WHERE ft.payment_id = :paymentId
        AND fe.account = :account
        AND fe.direction = 'credit'
    `, { replacements: { paymentId: payment.id, account: ACCOUNTS.SUBSCRIPTION_REVENUE } });
    const recognized = Number(recognizedRows[0].amount);
    const unearned = 9900000 - recognized;

    await payment.reload();
    await subscription.reload();
    expect(payment.status).toBe('paid');
    expect(subscription.plan).toBe('basic');
    expect(await FinancialTransaction.count({ where: { operationKey: `subscription:refund:${payment.id}` } })).toBe(0);

    await markProviderRefunded({
      paymentId: payment.id,
      providerTransactionId: 'tx-subscription-refund',
      amountTiyin: unearned,
    });

    await payment.reload();
    await subscription.reload();
    expect(payment.status).toBe('partially_refunded');
    expect(Number(payment.refundedAmountTiyin)).toBe(unearned);
    expect(subscription.plan).toBe('free');
    expect(Number(subscription.price)).toBe(0);
    expect(subscription.expiresAt).toBeNull();
    const refundTransaction = await FinancialTransaction.findOne({
      where: { operationKey: `subscription:refund:${payment.id}` },
    });
    expect(refundTransaction).toBeTruthy();
    const reversed = await FinancialEntry.sum('amountTiyin', {
      where: {
        financialTransactionId: refundTransaction.id,
        account: ACCOUNTS.SUBSCRIPTION_DEFERRED_REVENUE,
        direction: 'debit',
      },
    });
    expect(Number(reversed)).toBe(unearned);
  });

  test('subscription refund refuses consumed entitlement and leaves payment paid', async () => {
    const client = await makeClient('subscription-refund-consumed@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const { payment } = await createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'subscription-refund-consumed-key',
      plan: 'basic',
    });
    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'tx-subscription-refund-consumed',
      amountTiyin: 9900000,
      providerData: {},
    });
    await payment.reload();
    await payment.update({
      providerData: { ...payment.providerData, consumedConsultationIds: ['11111111-1111-4111-8111-111111111111'] },
    });

    await expect(markProviderRefunded({
      paymentId: payment.id,
      providerTransactionId: 'tx-subscription-refund-consumed',
      amountTiyin: 9900000,
    })).rejects.toThrow(/consumed|entitlement/i);

    await payment.reload();
    await subscription.reload();
    expect(payment.status).toBe('paid');
    expect(subscription.plan).toBe('basic');
    expect(await FinancialTransaction.count({ where: { operationKey: `subscription:refund:${payment.id}` } })).toBe(0);
  });
});

describe('subscription checkout API', () => {
  test('uses the server plan price and keeps the subscription inactive until paid', async () => {
    const client = await makeClient('subscription-checkout@test.uz');

    const response = await request(app)
      .post('/api/subscriptions/checkout')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .set('Idempotency-Key', 'subscription-checkout-key')
      .send({ plan: 'basic', amountTiyin: 1 });

    expect(response.status).toBe(200);
    expect(response.body.amountTiyin).toBe(9900000);
    expect(response.body.checkoutUrl).toMatch(/^https:\/\/checkout\.paycom\.uz\//);
    const subscription = await Subscription.findOne({ where: { userId: client.id } });
    const payment = await Payment.findByPk(response.body.paymentId);
    expect(subscription.plan).toBe('free');
    expect(payment.status).toBe('pending');
    expect(Number(payment.amountTiyin)).toBe(9900000);
    expect(payment.providerData).toEqual({ subscriptionPlan: 'basic' });
  });

  test('returns the same checkout for concurrent retries with one idempotency key', async () => {
    const client = await makeClient('subscription-checkout-race@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const input = {
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'same-checkout-key',
      plan: 'pro',
    };

    const [a, b] = await Promise.all([createCheckout(input), createCheckout(input)]);

    expect(a.payment.id).toBe(b.payment.id);
    expect(await Payment.count({ where: { userId: client.id, idempotencyKey: 'subscription:same-checkout-key' } })).toBe(1);
    expect(Number(a.payment.amountTiyin)).toBe(29900000);
  });

  test('namespaces the same raw key across unrelated checkout purposes', async () => {
    const client = await makeClient('checkout-purpose-namespace@test.uz');
    const { user: lawyer } = await makeLawyer('checkout-purpose-namespace-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Purpose namespace',
      status: 'payment_pending',
      price: 100000,
    });
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });

    const consultationCheckout = await createCheckout({
      userId: client.id,
      purpose: 'consultation',
      subjectId: consultation.id,
      idempotencyKey: 'shared-raw-key',
    });
    const subscriptionCheckout = await createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'shared-raw-key',
      plan: 'basic',
    });
    const consultationRetry = await createCheckout({
      userId: client.id,
      purpose: 'consultation',
      subjectId: consultation.id,
      idempotencyKey: 'shared-raw-key',
    });

    expect(subscriptionCheckout.payment.id).not.toBe(consultationCheckout.payment.id);
    expect(consultationRetry.payment.id).toBe(consultationCheckout.payment.id);
    const keys = (await Payment.findAll({
      where: { userId: client.id },
      order: [['idempotencyKey', 'ASC']],
    })).map((payment) => payment.idempotencyKey);
    expect(keys).toEqual(['consultation:shared-raw-key', 'subscription:shared-raw-key']);
  });

  test('shared checkout validation rejects overlong raw keys at API boundaries', async () => {
    const client = await makeClient('checkout-key-boundary@test.uz');
    const { user: lawyer } = await makeLawyer('checkout-key-boundary-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Key boundary',
      status: 'payment_pending',
      price: 100000,
    });
    const key = 'x'.repeat(256);

    const [consultationResponse, subscriptionResponse] = await Promise.all([
      request(app).post('/api/payments/create')
        .set('Authorization', `Bearer ${tokenFor(client)}`)
        .set('Idempotency-Key', key)
        .send({ consultationId: consultation.id }),
      request(app).post('/api/subscriptions/checkout')
        .set('Authorization', `Bearer ${tokenFor(client)}`)
        .set('Idempotency-Key', key)
        .send({ plan: 'basic' }),
    ]);

    expect(consultationResponse.status).toBe(400);
    expect(subscriptionResponse.status).toBe(400);
    expect(await Payment.count({ where: { userId: client.id } })).toBe(0);
  });

  test('checkout URL construction failure rolls back payment creation', async () => {
    const client = await makeClient('checkout-url-failure-client@test.uz');
    const { user: lawyer } = await makeLawyer('checkout-url-failure-lawyer@test.uz');
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'URL failure rollback',
      status: 'payment_pending',
      price: 100000,
    });
    const paymentCountBefore = await Payment.count({ where: { userId: client.id } });

    await expect(createCheckout({
      userId: client.id,
      purpose: 'consultation',
      subjectId: consultation.id,
      idempotencyKey: 'url-failure-key',
      checkoutUrlFactory: () => { throw new Error('injected checkout URL failure'); },
    })).rejects.toThrow(/checkout URL failure/i);

    expect(await Payment.count({ where: { userId: client.id } })).toBe(paymentCountBefore);
  });

  test('allows a later subscription renewal after an earlier payment is paid', async () => {
    const client = await makeClient('subscription-renewal-checkout@test.uz');
    const subscription = await Subscription.create({ userId: client.id, plan: 'free', price: 0 });
    const first = await createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'subscription-renewal-first',
      plan: 'basic',
    });
    await markPaymentPaid({
      paymentId: first.payment.id,
      providerTransactionId: 'tx-subscription-renewal-first',
      amountTiyin: 9900000,
      providerData: {},
    });

    await expect(createCheckout({
      userId: client.id,
      purpose: 'subscription',
      subjectId: subscription.id,
      idempotencyKey: 'subscription-renewal-second',
      plan: 'basic',
    })).resolves.toMatchObject({ amountTiyin: 9900000 });
  });
});

describe('consultation checkout API', () => {
  async function consultationFixture(prefix) {
    const client = await makeClient(`${prefix}-client@test.uz`);
    const { user: lawyer } = await makeLawyer(`${prefix}-lawyer@test.uz`);
    const consultation = await Consultation.create({
      clientId: client.id,
      lawyerId: lawyer.id,
      question: 'Checkout test',
      status: 'payment_pending',
      price: 123456,
    });
    return { client, consultation };
  }

  function checkoutRequest(client, consultation, key) {
    let result = request(app)
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ consultationId: consultation.id, amountTiyin: 1 });
    if (key) result = result.set('Idempotency-Key', key);
    return result;
  }

  test('requires Idempotency-Key and uses only the locked server price', async () => {
    const { client, consultation } = await consultationFixture('consultation-checkout-price');

    expect((await checkoutRequest(client, consultation)).status).toBe(400);
    const response = await checkoutRequest(client, consultation, 'consultation-checkout-price-key');

    expect(response.status).toBe(200);
    expect(response.body.amountTiyin).toBe(12345600);
    const payment = await Payment.findByPk(response.body.paymentId);
    expect(payment.idempotencyKey).toBe('consultation:consultation-checkout-price-key');
    expect(Number(payment.amountTiyin)).toBe(12345600);
  });

  test('same key races return one checkout and different keys cannot create a second active payment', async () => {
    const same = await consultationFixture('consultation-checkout-same-key');
    const [sameA, sameB] = await Promise.all([
      checkoutRequest(same.client, same.consultation, 'same-consultation-key'),
      checkoutRequest(same.client, same.consultation, 'same-consultation-key'),
    ]);
    expect(sameA.status).toBe(200);
    expect(sameB.status).toBe(200);
    expect(sameA.body.paymentId).toBe(sameB.body.paymentId);
    expect(await Payment.count({ where: { consultationId: same.consultation.id } })).toBe(1);

    const different = await consultationFixture('consultation-checkout-different-key');
    const responses = await Promise.all([
      checkoutRequest(different.client, different.consultation, 'different-key-a'),
      checkoutRequest(different.client, different.consultation, 'different-key-b'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await Payment.count({ where: { consultationId: different.consultation.id } })).toBe(1);
  });

  test('same-key failed retry clears provider binding through the locked service', async () => {
    const { client, consultation } = await consultationFixture('consultation-checkout-failed-retry');
    const checkout = await createCheckout({
      userId: client.id,
      purpose: 'consultation',
      subjectId: consultation.id,
      idempotencyKey: 'failed-consultation-key',
    });
    await markPaymentProcessing({
      paymentId: checkout.payment.id,
      providerTransactionId: 'provider-failed-attempt',
      amountTiyin: 12345600,
      providerData: { createTime: 1700000000600 },
    });
    await checkout.payment.update({ status: 'failed' });

    const response = await checkoutRequest(client, consultation, 'failed-consultation-key');

    expect(response.status).toBe(200);
    expect(response.body.paymentId).toBe(checkout.payment.id);
    await checkout.payment.reload();
    expect(checkout.payment.status).toBe('pending');
    expect(checkout.payment.transactionId).toBeNull();
    expect(checkout.payment.providerTransactionId).toBeNull();
    expect(checkout.payment.providerData).toBeNull();
  });

  test('user cancellation requests provider cancellation for a processing consultation payment', async () => {
    const { client, consultation } = await consultationFixture('consultation-user-cancel');
    const checkout = await createCheckout({
      userId: client.id,
      purpose: 'consultation',
      subjectId: consultation.id,
      idempotencyKey: 'consultation-user-cancel-key',
    });
    await markPaymentProcessing({
      paymentId: checkout.payment.id,
      providerTransactionId: 'tx-consultation-user-cancel',
      amountTiyin: 12345600,
      providerData: { createTime: 1700000000700 },
    });

    const response = await request(app)
      .post(`/api/consultations/${consultation.id}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ reason: 'Changed plans' });

    expect(response.status).toBe(202);
    await checkout.payment.reload();
    await consultation.reload();
    expect(checkout.payment.status).toBe('processing');
    expect(consultation.status).toBe('cancelled');
    await markPaymentPaid({
      paymentId: checkout.payment.id,
      providerTransactionId: 'tx-consultation-user-cancel',
      amountTiyin: 12345600,
      providerData: { performTime: 1700000000800 },
    });
    await checkout.payment.reload();
    expect(checkout.payment.status).toBe('refund_pending');
    expect(await FinancialTransaction.count({ where: { paymentId: checkout.payment.id } })).toBe(1);
  });
});
