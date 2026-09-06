const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const { reconcileConsultationTiming } = require('../src/services/consultationTimingService');

beforeEach(resetDb);

async function fixture(overrides = {}) {
  const client = await makeClient(`timing-client-${Date.now()}@test.uz`);
  const { user: lawyer, lp } = await makeLawyer(`timing-lawyer-${Date.now()}@test.uz`, { pendingBalance: 100000 });
  const now = new Date();
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'Timing', type: 'video', meetingProvider: 'zoom',
    status: 'accepted', lifecycleStatus: 'ready', duration: 30, price: 100000,
    scheduledStartAt: new Date(now.getTime() - 20 * 60000), scheduledEndAt: new Date(now.getTime() + 10 * 60000), scheduleTimezone: 'Asia/Tashkent',
    ...overrides,
  });
  return { client, lawyer, lp, consultation, now };
}

test('отсутствие юриста фиксируется сервером без завершения и выплаты', async () => {
  const { consultation, lp, now } = await fixture({ clientFirstJoinedAt: new Date() });
  const payment = await models.Payment.create({
    consultationId: consultation.id,
    userId: consultation.clientId,
    amount: 100000,
    amountTiyin: 10000000,
    refundedAmountTiyin: 0,
    purpose: 'consultation',
    provider: 'payme',
    status: 'paid',
  });
  await reconcileConsultationTiming(now);
  await Promise.all([consultation.reload(), lp.reload(), payment.reload()]);
  expect(consultation.lifecycleStatus).toBe('no_show_lawyer');
  expect(consultation.status).toBe('accepted');
  expect(Number(lp.balance)).toBe(0);
  expect(Number(lp.pendingBalance)).toBe(100000);
  expect(payment.refundStatus).toBe('none');
  await reconcileConsultationTiming(new Date(new Date(consultation.scheduledEndAt).getTime() + 16 * 60000));
  await Promise.all([lp.reload(), payment.reload()]);
  expect(Number(lp.pendingBalance)).toBe(100000);
  expect(payment.status).toBe('refund_pending');
});

test('отсутствие клиента фиксируется отдельно', async () => {
  const { consultation, now } = await fixture({ lawyerFirstJoinedAt: new Date() });
  await reconcileConsultationTiming(now);
  await consultation.reload();
  expect(consultation.lifecycleStatus).toBe('no_show_client');
});

test('два timing worker не дублируют no-show уведомления', async () => {
  const { consultation, now } = await fixture({ lawyerFirstJoinedAt: new Date() });
  await Promise.all([reconcileConsultationTiming(now), reconcileConsultationTiming(now)]);
  expect(await models.Notification.count({ where: { type: 'no_show_client' } })).toBe(2);
  expect(await models.MeetingEvent.count({ where: { consultationId: consultation.id, eventType: 'lifecycle.no_show_client' } })).toBe(1);
});

test('через grace period lifecycle завершается, но escrow ждёт подтверждения клиента', async () => {
  const { consultation, lp, now } = await fixture({
    status: 'in_progress', lifecycleStatus: 'in_progress', conversationStartedAt: new Date(Date.now() - 40 * 60000),
    scheduledEndAt: new Date(Date.now() - 6 * 60000),
  });
  await reconcileConsultationTiming(now);
  await Promise.all([consultation.reload(), lp.reload()]);
  expect(consultation.lifecycleStatus).toBe('completed');
  expect(consultation.status).toBe('in_progress');
  expect(Number(lp.balance)).toBe(0);
});
