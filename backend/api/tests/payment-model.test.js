const { resetDb, models, makeClient, makeLawyer, makePayment } = require('./helpers');

const { Consultation, Payment, Subscription } = models;

beforeAll(async () => {
  await resetDb();
});

async function makeConsultation(clientId, lawyerId) {
  return Consultation.create({ clientId, lawyerId, question: 'Payment schema test', price: 100 });
}

describe('generic payment model', () => {
  let client;
  let lawyer;
  let consultation;

  beforeAll(async () => {
    client = await makeClient('payment-model-client@test.uz');
    ({ user: lawyer } = await makeLawyer('payment-model-lawyer@test.uz'));
  });

  beforeEach(async () => {
    consultation = await makeConsultation(client.id, lawyer.id);
  });

  test('rejects subscription payment without its subject', async () => {
    await expect(makePayment({
      purpose: 'subscription',
      userId: client.id,
      consultationId: null,
    })).rejects.toThrow();
  });

  test('rejects a consultation payment with the wrong typed subject', async () => {
    const subscription = await Subscription.create({ userId: client.id, plan: 'basic', price: 100 });

    await expect(makePayment({
      purpose: 'consultation',
      userId: client.id,
      consultationId: null,
      subscriptionId: subscription.id,
    })).rejects.toThrow();
  });

  test('rejects non-positive and over-refunded integer tiyin amounts', async () => {
    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      amountTiyin: 0,
    })).rejects.toThrow();

    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      amountTiyin: 10000,
      refundedAmountTiyin: 10001,
    })).rejects.toThrow();
  });

  test('provider transaction is unique within a provider', async () => {
    await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      providerTransactionId: 'payme-1',
    });

    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      providerTransactionId: 'payme-1',
    })).rejects.toThrow();
  });

  test('idempotency key is unique per user', async () => {
    await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      idempotencyKey: 'checkout-1',
    });

    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      idempotencyKey: 'checkout-1',
    })).rejects.toThrow();
  });

  test('database permits only one active base payment per consultation subject', async () => {
    const first = await makePayment({
      userId: client.id,
      consultationId: consultation.id,
      idempotencyKey: 'active-subject-1',
    });

    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      idempotencyKey: 'active-subject-2',
    })).rejects.toThrow();

    await first.update({ status: 'failed' });
    await expect(makePayment({
      userId: client.id,
      consultationId: consultation.id,
      idempotencyKey: 'active-subject-3',
    })).resolves.toBeTruthy();
    await expect(makePayment({
      purpose: 'consultation_extension',
      userId: client.id,
      consultationId: consultation.id,
    })).resolves.toBeTruthy();
  });

  test('consultation exposes many payments without breaking legacy Payment include', async () => {
    await makePayment({ userId: client.id, consultationId: consultation.id });
    await makePayment({
      purpose: 'consultation_extension',
      userId: client.id,
      consultationId: consultation.id,
    });

    const withPayments = await Consultation.findByPk(consultation.id, {
      include: [{ model: Payment, as: 'payments' }],
    });
    expect(withPayments.payments).toHaveLength(2);

    const legacyInclude = await Payment.findOne({
      where: { consultationId: consultation.id },
      include: [{ model: Consultation }],
    });
    expect(legacyInclude.Consultation.id).toBe(consultation.id);
  });

  test('stores consultation checkout financial snapshots', async () => {
    await consultation.update({
      commissionRateBps: 1500,
      grossAmountTiyin: 10000,
      lawyerNetAmountTiyin: 8500,
    });
    await consultation.reload();

    expect(consultation.commissionRateBps).toBe(1500);
    expect(Number(consultation.grossAmountTiyin)).toBe(10000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(8500);
  });
});
