jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');
const billing = require('../src/services/billingService');
const { completeConsultation } = require('../src/services/escrow');
const {
  markProviderCancelled,
  markPaymentProcessing,
  markPaymentPaid,
  getExtensionProposalState,
} = require('../src/services/paymentService');

const { Consultation, Notification, Payment } = models;

beforeAll(async () => { await resetDb(); });

function book(client, lawyer, key = 'booking-checkout-key', body = {}) {
  return request(app)
    .post(`/api/lawyers/${lawyer.id}/book`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .set('Idempotency-Key', key)
    .send({
      consultationType: 'video',
      duration: 60,
      problems: [{ text: 'Вопрос', categories: ['civil'] }],
      ...body,
    });
}

describe('prepayment-only booking', () => {
  test('creates one server-priced pending checkout without exposing an actionable lawyer request', async () => {
    const client = await makeClient('prepay-booking-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('prepay-booking-lawyer@test.uz', { price: 200000 });
    await lawyer.update({ twoFactorEnabled: true });

    const response = await book(client, lawyer, 'prepay-booking-one', { amount: 1 });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      consultationId: expect.any(String),
      paymentId: expect.any(String),
      checkoutUrl: expect.stringContaining('paycom.uz'),
      requiresPayment: true,
      paymentStatus: 'pending',
    }));
    expect(response.body.consultation.status).toBe('payment_pending');
    expect(response.body.consultation.billingStatus).toBe('none');

    const payment = await Payment.findByPk(response.body.paymentId);
    const consultation = await Consultation.findByPk(response.body.consultationId);
    expect(payment).toEqual(expect.objectContaining({
      consultationId: consultation.id,
      purpose: 'consultation',
      status: 'pending',
      idempotencyKey: 'consultation:prepay-booking-one',
    }));
    expect(Number(payment.amountTiyin)).toBe(20000000);
    expect(consultation.commissionRateBps).toBe(1500);
    expect(Number(consultation.grossAmountTiyin)).toBe(20000000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(17000000);
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(0);
    expect(await Notification.count({ where: { userId: lawyer.id, type: 'new_booking' } })).toBe(0);

    const requests = await request(app)
      .get('/api/lawyer/consultation-requests')
      .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');
    expect(requests.status).toBe(200);
    expect(requests.body.map((item) => item.id)).not.toContain(consultation.id);
  });

  test('same booking key survives concurrent page/network retries without duplicate subjects', async () => {
    const client = await makeClient('prepay-retry-client@test.uz');
    const { user: lawyer } = await makeLawyer('prepay-retry-lawyer@test.uz', { price: 150000 });

    const [first, second] = await Promise.all([
      book(client, lawyer, 'prepay-booking-retry'),
      book(client, lawyer, 'prepay-booking-retry'),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.consultationId).toBe(second.body.consultationId);
    expect(first.body.paymentId).toBe(second.body.paymentId);
    expect(first.body.checkoutUrl).toBe(second.body.checkoutUrl);
    expect(await Consultation.count({ where: { clientId: client.id, lawyerId: lawyer.id } })).toBe(1);
    expect(await Payment.count({
      where: { userId: client.id, idempotencyKey: 'consultation:prepay-booking-retry' },
    })).toBe(1);
  });

  test('lawyer receives the request only after the paid transition commits', async () => {
    const client = await makeClient('prepay-paid-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('prepay-paid-lawyer@test.uz', { price: 100000 });
    await lawyer.update({ twoFactorEnabled: true });
    const booking = await book(client, lawyer, 'prepay-paid-activation');

    await markPaymentPaid({
      paymentId: booking.body.paymentId,
      providerTransactionId: 'prepay-paid-provider-1',
      amountTiyin: 10000000,
      providerData: { performTime: 1700000000000 },
    });

    const consultation = await Consultation.findByPk(booking.body.consultationId);
    expect(consultation.status).toBe('pending');
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(85000);
    expect(await Notification.count({ where: { userId: lawyer.id, type: 'new_booking' } })).toBe(1);

    const requests = await request(app)
      .get('/api/lawyer/consultation-requests')
      .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'lawyer');
    expect(requests.body.map((item) => item.id)).toContain(consultation.id);
  });

  test('same booking key remains idempotent when a page retry arrives after payment activation', async () => {
    const client = await makeClient('prepay-paid-retry-client@test.uz');
    const { user: lawyer } = await makeLawyer('prepay-paid-retry-lawyer@test.uz', { price: 120000 });
    const first = await book(client, lawyer, 'prepay-paid-page-retry');
    await markPaymentPaid({
      paymentId: first.body.paymentId,
      providerTransactionId: 'prepay-paid-page-retry-provider',
      amountTiyin: 12000000,
      providerData: { performTime: 1700000000100 },
    });

    const retry = await book(client, lawyer, 'prepay-paid-page-retry');

    expect(retry.status).toBe(201);
    expect(retry.body.consultationId).toBe(first.body.consultationId);
    expect(retry.body.paymentId).toBe(first.body.paymentId);
    expect(retry.body.requiresPayment).toBe(false);
    expect(retry.body.paymentStatus).toBe('paid');
    expect(retry.body.checkoutUrl).toBeNull();
    expect(retry.body.consultation.status).toBe('pending');
    expect(await Consultation.count({ where: { clientId: client.id, lawyerId: lawyer.id } })).toBe(1);
    expect(await Notification.count({ where: { userId: lawyer.id, type: 'new_booking' } })).toBe(1);
  });

  test.each([
    ['date', { preferredDate: '2026-08-24' }],
    ['time', { preferredTime: '11:00' }],
    ['duration', { duration: 90 }],
    ['type', { consultationType: 'chat' }],
    ['problems and specialization', { problems: [{ text: 'Другой вопрос', categories: ['family'] }] }],
  ])('same booking key rejects changed canonical %s terms', async (label, changed) => {
    const suffix = label.replace(/\W+/g, '-');
    const client = await makeClient(`prepay-fingerprint-${suffix}-client@test.uz`);
    const { user: lawyer } = await makeLawyer(`prepay-fingerprint-${suffix}-lawyer@test.uz`, { price: 100000 });
    const key = `prepay-fingerprint-${suffix}`;
    const initial = {
      preferredDate: '2026-08-17',
      preferredTime: '10:00',
      duration: 60,
      consultationType: 'video',
      problems: [{ text: 'Вопрос', categories: ['civil'] }],
    };
    expect((await book(client, lawyer, key, initial)).status).toBe(201);

    const retry = await book(client, lawyer, key, { ...initial, ...changed });

    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('BOOKING_TERMS_CHANGED');
    expect(retry.body.error).toMatch(/different booking|idempotency/i);
    expect(await Consultation.count({ where: { clientId: client.id, lawyerId: lawyer.id } })).toBe(1);
  });

  test('same booking key rejects a changed server price snapshot', async () => {
    const client = await makeClient('prepay-fingerprint-price-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('prepay-fingerprint-price-lawyer@test.uz', { price: 100000 });
    const key = 'prepay-fingerprint-price';
    const first = await book(client, lawyer, key);
    expect(first.status).toBe(201);
    await lp.update({ price: 120000 });

    const retry = await book(client, lawyer, key);

    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('BOOKING_TERMS_CHANGED');
    const payment = await Payment.findByPk(first.body.paymentId);
    expect(payment.providerData).toEqual(expect.objectContaining({
      bookingFingerprintVersion: 1,
      bookingFingerprint: expect.any(String),
      serverPriceTiyin: 10000000,
    }));
  });

  test('same key reports a cancelled terminal booking and a new key can start a fresh attempt', async () => {
    const client = await makeClient('prepay-cancelled-retry-client@test.uz');
    const { user: lawyer } = await makeLawyer('prepay-cancelled-retry-lawyer@test.uz', { price: 100000 });
    const first = await book(client, lawyer, 'prepay-cancelled-retry');
    const cancelled = await request(app)
      .post(`/api/consultations/${first.body.consultationId}/cancel`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ reason: 'Changed plans' });
    expect(cancelled.status).toBe(200);

    const terminalRetry = await book(client, lawyer, 'prepay-cancelled-retry');
    expect(terminalRetry.status).toBe(201);
    expect(terminalRetry.body).toEqual(expect.objectContaining({
      consultationId: first.body.consultationId,
      paymentId: first.body.paymentId,
      paymentStatus: 'failed',
      requiresPayment: false,
      checkoutUrl: null,
    }));
    expect(terminalRetry.body.consultation.status).toBe('cancelled');

    const fresh = await book(client, lawyer, 'prepay-cancelled-replacement');
    expect(fresh.status).toBe(201);
    expect(fresh.body.consultationId).not.toBe(first.body.consultationId);
    expect(fresh.body.requiresPayment).toBe(true);
  });

  test('new prepayment flow never writes historical hold/capture compatibility fields', async () => {
    const client = await makeClient('prepay-compat-client@test.uz');
    const { user: lawyer } = await makeLawyer('prepay-compat-lawyer@test.uz', { price: 90000 });
    const booking = await book(client, lawyer, 'prepay-compat-read-only');
    await markPaymentPaid({
      paymentId: booking.body.paymentId,
      providerTransactionId: 'prepay-compat-provider',
      amountTiyin: 9000000,
      providerData: { performTime: 1700000000200 },
    });
    await Consultation.update({ status: 'in_progress' }, { where: { id: booking.body.consultationId } });

    await completeConsultation(booking.body.consultationId);

    const consultation = await Consultation.findByPk(booking.body.consultationId);
    expect(consultation.billingStatus).toBe('none');
    expect(consultation.callStartedAt).toBeNull();
    expect(consultation.chargedAt).toBeNull();
  });
});

describe('legacy five-minute billing compatibility', () => {
  test('cannot capture money or start a pseudo-capture production job', () => {
    expect(billing.getCompatibilityReport()).toEqual({
      model: 'hold-5min',
      pseudoCaptureEnabled: false,
      productionSource: false,
    });
    expect(billing.captureHold).toBeUndefined();
    expect(billing.checkCaptureDue).toBeUndefined();
    expect(billing.startBillingJob).toBeUndefined();
  });
});

async function extensionFixture(prefix) {
  const client = await makeClient(`${prefix}-client@test.uz`);
  const { user: lawyer, lp } = await makeLawyer(`${prefix}-lawyer@test.uz`, { price: 100000 });
  await lawyer.update({ twoFactorEnabled: true });
  const consultation = await Consultation.create({
    clientId: client.id,
    lawyerId: lawyer.id,
    question: 'Продление',
    status: 'in_progress',
    duration: 60,
    price: 100000,
    commissionRateBps: 1500,
    grossAmountTiyin: 10000000,
    lawyerNetAmountTiyin: 8500000,
  });
  await Payment.create({
    userId: client.id,
    consultationId: consultation.id,
    purpose: 'consultation',
    amount: 100000,
    amountTiyin: 10000000,
    currency: 'UZS',
    provider: 'payme',
    status: 'paid',
  });
  return { client, lawyer, lp, consultation };
}

function consentToExtension(actor, consultation, key, minutes = 15) {
  const isLawyer = actor.id === consultation.lawyerId;
  return request(app)
    .post(`/api/video/consultation/${consultation.id}/extend`)
    .set('Authorization', `Bearer ${tokenFor(actor, isLawyer ? 'mfa' : undefined)}`)
    .set('X-Maslaxat-Mode', isLawyer ? 'lawyer' : 'client')
    .set('Idempotency-Key', key)
    .send({ minutes });
}

function getExtension(actor, consultation) {
  const isLawyer = actor.id === consultation.lawyerId;
  return request(app)
    .get(`/api/video/consultation/${consultation.id}/extension`)
    .set('Authorization', `Bearer ${tokenFor(actor, isLawyer ? 'mfa' : undefined)}`)
    .set('X-Maslaxat-Mode', isLawyer ? 'lawyer' : 'client');
}

function cancelExtension(actor, consultation, proposalId) {
  const isLawyer = actor.id === consultation.lawyerId;
  return request(app)
    .delete(`/api/video/consultation/${consultation.id}/extension/${proposalId}`)
    .set('Authorization', `Bearer ${tokenFor(actor, isLawyer ? 'mfa' : undefined)}`)
    .set('X-Maslaxat-Mode', isLawyer ? 'lawyer' : 'client');
}

describe('typed prepaid consultation extensions', () => {
  async function createPaidExtension({ client, lawyer, consultation, key, providerId, minutes = 15 }) {
    await consentToExtension(client, consultation, key, minutes);
    const accepted = await consentToExtension(lawyer, consultation, key, minutes);
    await markPaymentPaid({
      paymentId: accepted.body.paymentId,
      providerTransactionId: providerId,
      amountTiyin: accepted.body.amountTiyin,
      providerData: { performTime: Date.now() },
    });
    return Payment.findByPk(accepted.body.paymentId);
  }

  test('requires both participant consents and changes duration only after paid activation', async () => {
    const { client, lawyer, lp, consultation } = await extensionFixture('extension-consent');

    const proposed = await consentToExtension(client, consultation, 'extension-consent-key');
    expect(proposed.status).toBe(202);
    expect(proposed.body).toEqual(expect.objectContaining({ consentPending: true, requiresPayment: false }));
    await consultation.reload();
    expect(consultation.duration).toBe(60);
    expect(consultation.price).toBe(100000);

    const accepted = await consentToExtension(lawyer, consultation, 'extension-consent-key');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual(expect.objectContaining({
      consentPending: false,
      requiresPayment: false,
      paymentId: expect.any(String),
      checkoutUrl: null,
      addAmount: 25000,
      duration: 60,
    }));
    const clientCheckout = await getExtension(client, consultation);
    expect(clientCheckout.body.proposal.requiresPayment).toBe(true);
    expect(clientCheckout.body.proposal.checkoutUrl).toContain('paycom.uz');
    const payment = await Payment.findByPk(accepted.body.paymentId);
    expect(payment.purpose).toBe('consultation_extension');
    expect(payment.status).toBe('pending');
    expect(Number(payment.amountTiyin)).toBe(2500000);
    expect(payment.providerData.consentUserIds.sort()).toEqual([client.id, lawyer.id].sort());

    await markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'extension-consent-provider',
      amountTiyin: 2500000,
      providerData: { performTime: 1700000001000 },
    });

    await consultation.reload();
    await lp.reload();
    expect(consultation.duration).toBe(75);
    expect(consultation.price).toBe(125000);
    expect(Number(lp.pendingBalance)).toBe(21250);
  });

  test('paid callback fails closed when only one party consented', async () => {
    const { client, consultation } = await extensionFixture('extension-one-consent');
    const proposed = await consentToExtension(client, consultation, 'extension-one-consent-key');
    const payment = await Payment.findByPk(proposed.body.paymentId);

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'extension-one-consent-provider',
      amountTiyin: 2500000,
      providerData: { performTime: 1700000002000 },
    })).rejects.toThrow(/consent/i);

    await payment.reload();
    await consultation.reload();
    expect(payment.status).toBe('pending');
    expect(consultation.duration).toBe(60);
  });

  test('provider cancellation wins over a late paid callback without changing consultation duration', async () => {
    const { client, lawyer, consultation } = await extensionFixture('extension-cancel-race');
    await consentToExtension(client, consultation, 'extension-cancel-race-key');
    const accepted = await consentToExtension(lawyer, consultation, 'extension-cancel-race-key');
    const payment = await Payment.findByPk(accepted.body.paymentId);
    const event = {
      paymentId: payment.id,
      providerTransactionId: 'extension-cancel-race-provider',
      amountTiyin: 2500000,
      providerData: { createTime: 1700000003000 },
    };
    await markPaymentProcessing(event);
    await markProviderCancelled({
      paymentId: payment.id,
      providerTransactionId: event.providerTransactionId,
      cancelTime: 1700000004000,
      reason: 5,
    });

    await expect(markPaymentPaid({
      ...event,
      providerData: { performTime: 1700000005000 },
    })).rejects.toThrow(/state|cancel/i);
    await payment.reload();
    await consultation.reload();
    expect(payment.status).toBe('failed');
    expect(consultation.status).toBe('in_progress');
    expect(consultation.duration).toBe(60);
  });

  test('provider cancellation after paid atomically removes the extension duration and escrow', async () => {
    const { client, lawyer, lp, consultation } = await extensionFixture('extension-paid-cancel');
    await consentToExtension(client, consultation, 'extension-paid-cancel-key');
    const accepted = await consentToExtension(lawyer, consultation, 'extension-paid-cancel-key');
    const event = {
      paymentId: accepted.body.paymentId,
      providerTransactionId: 'extension-paid-cancel-provider',
      amountTiyin: 2500000,
      providerData: { performTime: 1700000006000 },
    };
    await markPaymentPaid(event);
    await consultation.reload();
    expect(consultation.duration).toBe(75);

    await markProviderCancelled({
      paymentId: event.paymentId,
      providerTransactionId: event.providerTransactionId,
      cancelTime: 1700000007000,
      reason: 5,
    });

    const payment = await Payment.findByPk(event.paymentId);
    await consultation.reload();
    await lp.reload();
    expect(payment.status).toBe('refunded');
    expect(consultation.status).toBe('in_progress');
    expect(consultation.duration).toBe(60);
    expect(consultation.price).toBe(100000);
    expect(Number(lp.pendingBalance)).toBe(0);
  });

  test('proposal identity and consent recover from authenticated server state after reload', async () => {
    const { client, lawyer, consultation } = await extensionFixture('extension-recovery');
    const outsider = await makeClient('extension-recovery-outsider@test.uz');
    const proposed = await consentToExtension(client, consultation, 'extension-recovery-key');
    expect(proposed.status).toBe(202);

    const payment = await Payment.findByPk(proposed.body.paymentId);
    expect(payment.providerData.proposalId).toBe('extension-recovery-key');
    expect(new Date(payment.providerData.expiresAt).getTime()
      - new Date(payment.providerData.proposalCreatedAt).getTime()).toBe(15 * 60 * 1000);

    const clientState = await getExtension(client, consultation);
    const lawyerState = await getExtension(lawyer, consultation);
    expect(clientState.status).toBe(200);
    expect(clientState.body.proposal).toEqual(expect.objectContaining({
      proposalId: 'extension-recovery-key',
      paymentId: payment.id,
      status: 'pending',
      consentUserIds: [client.id],
      requiresPayment: false,
    }));
    expect(lawyerState.body.proposal.proposalId).toBe('extension-recovery-key');
    expect((await getExtension(outsider, consultation)).status).toBe(403);

    const resumed = await consentToExtension(client, consultation, 'extension-recovery-key');
    expect(resumed.status).toBe(202);
    expect(resumed.body.paymentId).toBe(payment.id);
    expect((await consentToExtension(client, consultation, 'extension-recovery-key', 30)).status).toBe(409);

    expect((await consentToExtension(lawyer, consultation, 'extension-recovery-key')).status).toBe(200);
    const readyForClient = await getExtension(client, consultation);
    const readyForLawyer = await getExtension(lawyer, consultation);
    expect(readyForClient.body.proposal.requiresPayment).toBe(true);
    expect(readyForClient.body.proposal.checkoutUrl).toContain('paycom.uz');
    expect(readyForLawyer.body.proposal.requiresPayment).toBe(false);
    expect(readyForLawyer.body.proposal.checkoutUrl).toBeNull();
  });

  test('pending proposal expires at the exact server deadline and no longer blocks a new proposal', async () => {
    const { client, consultation } = await extensionFixture('extension-expiry');
    const proposed = await consentToExtension(client, consultation, 'extension-expiry-key');
    const payment = await Payment.findByPk(proposed.body.paymentId);
    const expiresAt = new Date('2030-01-01T00:15:00.000Z');
    await payment.update({
      providerData: {
        ...payment.providerData,
        proposalCreatedAt: '2030-01-01T00:00:00.000Z',
        expiresAt: expiresAt.toISOString(),
      },
    });

    const before = await getExtensionProposalState({
      actorId: client.id,
      consultationId: consultation.id,
      now: new Date(expiresAt.getTime() - 1),
    });
    expect(before.proposal.status).toBe('pending');
    const atDeadline = await getExtensionProposalState({
      actorId: client.id,
      consultationId: consultation.id,
      now: expiresAt,
    });
    expect(atDeadline.proposal).toBeNull();
    await payment.reload();
    expect(payment.status).toBe('failed');
    expect(payment.providerData.proposalState).toBe('expired');

    await expect(markPaymentPaid({
      paymentId: payment.id,
      providerTransactionId: 'extension-expired-late-provider',
      amountTiyin: 2500000,
      providerData: { performTime: expiresAt.getTime() + 1 },
    })).rejects.toThrow(/state|failed/i);
    const replacement = await consentToExtension(client, consultation, 'extension-expiry-replacement');
    expect(replacement.status).toBe(202);
    expect(replacement.body.paymentId).not.toBe(payment.id);
  });

  test('processing proposal never auto-expires and requires explicit cancellation', async () => {
    const { client, consultation } = await extensionFixture('extension-processing-recovery');
    const proposed = await consentToExtension(client, consultation, 'extension-processing-key');
    const payment = await Payment.findByPk(proposed.body.paymentId);
    await markPaymentProcessing({
      paymentId: payment.id,
      providerTransactionId: 'extension-processing-provider',
      amountTiyin: 2500000,
      providerData: { createTime: 1700000000000 },
    });
    await payment.reload();
    await payment.update({
      providerData: { ...payment.providerData, expiresAt: '2020-01-01T00:00:00.000Z' },
    });

    const state = await getExtensionProposalState({
      actorId: client.id,
      consultationId: consultation.id,
      now: new Date('2030-01-01T00:00:00.000Z'),
    });
    expect(state.proposal.status).toBe('processing');
    await payment.reload();
    expect(payment.status).toBe('processing');

    const cancelled = await cancelExtension(client, consultation, 'extension-processing-key');
    expect(cancelled.status).toBe(202);
    expect(cancelled.body.paymentStatus).toBe('processing');
    expect(cancelled.body.outcome).toBe('cancellation_requested');
    await payment.reload();
    expect(payment.status).toBe('processing');
    expect(payment.providerData.cancellationRequest.state).toBe('requested');
    expect((await getExtension(client, consultation)).body.proposal.status).toBe('processing');
  });

  test('participant can cancel pending proposal, outsider cannot, and a new key can replace it', async () => {
    const { client, lawyer, consultation } = await extensionFixture('extension-explicit-cancel');
    const outsider = await makeClient('extension-explicit-cancel-outsider@test.uz');
    const proposed = await consentToExtension(client, consultation, 'extension-explicit-cancel-key');
    expect((await cancelExtension(outsider, consultation, 'extension-explicit-cancel-key')).status).toBe(403);

    const cancelled = await cancelExtension(lawyer, consultation, 'extension-explicit-cancel-key');
    expect(cancelled.status).toBe(200);
    const oldPayment = await Payment.findByPk(proposed.body.paymentId);
    expect(oldPayment.status).toBe('failed');
    expect(oldPayment.providerData.proposalState).toBe('cancelled');

    const replacement = await consentToExtension(client, consultation, 'extension-explicit-cancel-replacement');
    expect(replacement.status).toBe(202);
    expect(replacement.body.paymentId).not.toBe(oldPayment.id);
  });

  test.each([
    ['A then B', ['A', 'B']],
    ['B then A', ['B', 'A']],
  ])('sequential paid extensions support confirmed refunds %s', async (label, refundOrder) => {
    const suffix = label.replace(/\W+/g, '-');
    const { client, lawyer, lp, consultation } = await extensionFixture(`extension-order-${suffix}`);
    const extensionA = await createPaidExtension({
      client, lawyer, consultation, key: `extension-order-${suffix}-a`, providerId: `extension-order-${suffix}-provider-a`,
    });
    const extensionB = await createPaidExtension({
      client, lawyer, consultation, key: `extension-order-${suffix}-b`, providerId: `extension-order-${suffix}-provider-b`,
    });
    expect(extensionA.providerData).toEqual(expect.objectContaining({
      addedMinutes: 15,
      addedAmountTiyin: 2500000,
      extensionApplied: true,
    }));
    expect(extensionB.providerData).toEqual(expect.objectContaining({
      addedMinutes: 15,
      addedAmountTiyin: 2500000,
      extensionApplied: true,
    }));
    await consultation.reload();
    expect(consultation.duration).toBe(90);
    expect(consultation.price).toBe(150000);

    const byName = { A: extensionA, B: extensionB };
    for (const name of refundOrder) {
      const payment = byName[name];
      await markProviderCancelled({
        paymentId: payment.id,
        providerTransactionId: payment.providerTransactionId,
        cancelTime: Date.now(),
        reason: 5,
      });
    }

    await consultation.reload();
    await lp.reload();
    expect(consultation.duration).toBe(60);
    expect(consultation.price).toBe(100000);
    expect(Number(consultation.grossAmountTiyin)).toBe(10000000);
    expect(Number(consultation.lawyerNetAmountTiyin)).toBe(8500000);
    expect(Number(lp.pendingBalance)).toBe(0);
    for (const payment of [extensionA, extensionB]) {
      await payment.reload();
      expect(payment.status).toBe('refunded');
      expect(payment.providerData.extensionApplied).toBe(false);
      expect(await models.FinancialTransaction.count({
        where: { operationKey: `consultation:extension:refund:${payment.id}` },
      })).toBe(1);
    }
  });

  test('concurrent out-of-order extension refunds serialize and remain idempotent', async () => {
    const { client, lawyer, lp, consultation } = await extensionFixture('extension-concurrent-refund');
    const extensionA = await createPaidExtension({
      client, lawyer, consultation, key: 'extension-concurrent-refund-a', providerId: 'extension-concurrent-provider-a',
    });
    const extensionB = await createPaidExtension({
      client, lawyer, consultation, key: 'extension-concurrent-refund-b', providerId: 'extension-concurrent-provider-b',
    });
    const cancel = (payment) => markProviderCancelled({
      paymentId: payment.id,
      providerTransactionId: payment.providerTransactionId,
      cancelTime: Date.now(),
      reason: 5,
    });

    await expect(Promise.all([cancel(extensionA), cancel(extensionB)])).resolves.toHaveLength(2);
    await expect(Promise.all([cancel(extensionB), cancel(extensionA)])).resolves.toHaveLength(2);

    await consultation.reload();
    await lp.reload();
    expect(consultation.duration).toBe(60);
    expect(consultation.price).toBe(100000);
    expect(Number(lp.pendingBalance)).toBe(0);
  });

  test('malformed immutable extension delta fails before refunding ledger or duration', async () => {
    const { client, lawyer, consultation } = await extensionFixture('extension-malformed-delta');
    const payment = await createPaidExtension({
      client, lawyer, consultation, key: 'extension-malformed-delta', providerId: 'extension-malformed-provider',
    });
    await payment.update({
      providerData: { ...payment.providerData, addedMinutes: -15, extensionApplied: true },
    });

    await expect(markProviderCancelled({
      paymentId: payment.id,
      providerTransactionId: payment.providerTransactionId,
      cancelTime: Date.now(),
      reason: 5,
    })).rejects.toThrow(/extension.*metadata|delta/i);

    await payment.reload();
    await consultation.reload();
    expect(payment.status).toBe('paid');
    expect(consultation.duration).toBe(75);
    expect(await models.FinancialTransaction.count({
      where: { operationKey: `consultation:extension:refund:${payment.id}` },
    })).toBe(0);
  });
});
