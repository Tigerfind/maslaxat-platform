const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, makeAdmin, tokenFor } = require('./helpers');
const consultationPolicy = require('../src/services/consultationPolicy');
const { recordPeerConnected } = require('../src/services/webrtcEvidenceService');

const { Consultation, ConsultationMeeting, Payment, FinancialEvent, Notification, Promo } = models;

beforeEach(async () => {
  delete process.env.PAYME_KEY;
  delete process.env.PAYME_MERCHANT_ID;
  await resetDb();
});

async function fixture(status = 'pending', overrides = {}) {
  const client = await makeClient(`lifecycle-client-${Math.random()}@test.uz`);
  const { user: lawyer, lp } = await makeLawyer(`lifecycle-lawyer-${Math.random()}@test.uz`);
  const consultation = await Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'Договор аренды', description: 'Нужна проверка',
    specialization: 'civil', status, price: 100000, ...overrides,
  });
  return { client, lawyer, lp, consultation };
}

test('архивирование явно, идемпотентно и доступно только клиенту-владельцу', async () => {
  const { client, lawyer, consultation } = await fixture('completed');
  const url = `/api/consultations/${consultation.id}/archive`;
  const archive = await request(app).patch(url).set('Authorization', `Bearer ${tokenFor(client)}`).send({ archived: true });
  expect(archive.status).toBe(200);
  expect(archive.body.consultation.archivedAt).toBeTruthy();
  expect((await request(app).patch(url).set('Authorization', `Bearer ${tokenFor(client)}`).send({ archived: true })).status).toBe(200);
  expect((await request(app).patch(url).set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ archived: false })).status).toBe(403);
  const unarchive = await request(app).patch(url).set('Authorization', `Bearer ${tokenFor(client)}`).send({ archived: false });
  expect(unarchive.status).toBe(200);
  expect(unarchive.body.consultation.archivedAt).toBeNull();

  const active = await fixture('accepted');
  expect((await request(app).patch(`/api/consultations/${active.consultation.id}/archive`)
    .set('Authorization', `Bearer ${tokenFor(active.client)}`).send({ archived: true })).status).toBe(409);
});

test('истёкшая бронь атомарно закрывается, не считается активной и не оплачивается/переносится', async () => {
  const { client, consultation } = await fixture('payment_pending', {
    paymentExpiresAt: new Date(Date.now() - 1000), lifecycleStatus: 'pending_payment',
  });
  const payment = await Payment.create({ consultationId: consultation.id, userId: client.id, amount: 100000, provider: 'payme', status: 'pending' });
  const auth = `Bearer ${tokenFor(client)}`;
  const list = await request(app).get('/api/consultations?bucket=payment_pending').set('Authorization', auth);
  expect(list.status).toBe(200);
  expect(list.body.counts.payment_pending).toBe(0);
  expect(list.body.counts.cancelled).toBe(1);
  await Promise.all([consultation.reload(), payment.reload()]);
  expect(consultation).toMatchObject({ status: 'payment_expired', cancelledBy: 'system', cancellationType: 'payment_expired' });
  expect(payment.status).toBe('failed');
  expect((await request(app).post('/api/payments/simulate').set('Authorization', auth).send({ consultationId: consultation.id })).status).toBe(410);
  const move = await request(app).patch(`/api/consultations/${consultation.id}/reschedule`).set('Authorization', auth)
    .send({ preferredDate: '2030-01-01', preferredTime: '09:00' });
  expect(move.status).toBe(410);
});

test('policy DTO exposes stable status, actions, cancellation codes and Zoom readiness gate', async () => {
  const start = new Date(Date.now() + 5 * 60000);
  const { client, consultation } = await fixture('accepted', {
    type: 'video', meetingProvider: 'zoom', scheduledStartAt: start,
    scheduledEndAt: new Date(start.getTime() + 30 * 60000),
  });
  await Payment.create({ consultationId: consultation.id, userId: client.id, amount: 100000, provider: 'payme', status: 'paid' });
  await ConsultationMeeting.create({ consultationId: consultation.id, status: 'creating', scheduledAt: start, duration: 30 });
  const detail = await request(app).get(`/api/consultations/${consultation.id}`).set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(detail.status).toBe(200);
  expect(detail.body.policy).toMatchObject({ status: 'accepted', statusKnown: true, bucket: 'upcoming', canJoin: false, reason: 'MEETING_NOT_READY', meetingStatus: 'creating' });
  expect(detail.body.policy.availableActions).toEqual(expect.arrayContaining(['reschedule', 'cancel']));
  expect(detail.body.policy.availableActions).not.toContain('complete');

  const cancelled = await fixture('rejected', { cancellationReason: 'Нет возможности' });
  const cancelledDetail = await request(app).get(`/api/consultations/${cancelled.consultation.id}`).set('Authorization', `Bearer ${tokenFor(cancelled.client)}`);
  expect(cancelledDetail.body.policy.cancellation).toMatchObject({ code: 'LAWYER_REJECTED', label: 'Юрист отклонил запрос' });
});

test('client action matrix is explicit, safe, and evidence-aware', () => {
  const now = new Date('2030-01-01T10:00:00Z');
  const schedule = { scheduledStartAt: new Date('2030-01-01T09:30:00Z'), scheduledEndAt: new Date('2030-01-01T10:30:00Z') };
  const actions = (value, canJoin = false) => consultationPolicy.availableActions(value, 'client', now, canJoin);

  expect(actions({ status: 'payment_pending' })).toEqual(['view_details', 'pay', 'cancel']);
  expect(actions({ status: 'pending' })).toEqual(['view_details', 'reschedule', 'cancel']);
  expect(actions({ status: 'pending', ...schedule })).toContain('calendar');
  expect(actions({ status: 'accepted', type: 'video', meetingProvider: 'webrtc', callStartedAt: now, ...schedule }, true))
    .toEqual(expect.arrayContaining(['view_details', 'calendar', 'reschedule', 'cancel', 'open_chat', 'documents', 'join']));
  expect(actions({ status: 'accepted', type: 'video', meetingProvider: 'webrtc', callStartedAt: now, ...schedule }, true)).not.toContain('complete');
  expect(actions({ status: 'in_progress', type: 'video', meetingProvider: 'webrtc' }, true)).not.toContain('complete');
  expect(actions({ status: 'accepted', type: 'chat' })).not.toContain('complete');
  expect(actions({ status: 'accepted', type: 'chat', bilateralMessageEvidence: true })).not.toContain('complete');
  expect(actions({ status: 'in_progress', type: 'chat', bilateralMessageEvidence: true })).toContain('complete');
  expect(actions({ status: 'accepted', type: 'phone', callStartedAt: now })).not.toContain('complete');
  expect(actions({ status: 'completed' })).toEqual(expect.arrayContaining(['view_details', 'rate', 'rebook', 'read_chat', 'documents', 'archive']));
  expect(actions({ status: 'completed', consultationReview: { id: 'review' }, archivedAt: now })).not.toContain('rate');
  expect(actions({ status: 'completed', consultationReview: { id: 'review' }, archivedAt: now })).toContain('unarchive');
  expect(actions({ status: 'payment_expired' })).toEqual(expect.arrayContaining(['view_details', 'rebook', 'read_chat', 'documents', 'archive']));
  expect(actions({ status: 'completed', archivedAt: now })).toEqual(['view_details', 'read_chat', 'documents', 'unarchive']);
  expect(actions({ status: 'future_unknown' })).toEqual(['view_details']);
});

test('admin pending to accepted transition records acceptedAt', async () => {
  const admin = await makeAdmin('lifecycle-admin-accept@test.uz');
  const { consultation } = await fixture('pending');
  const response = await request(app).patch(`/api/consultations/${consultation.id}/status`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'accepted' });
  expect(response.status).toBe(200);
  await consultation.reload();
  expect(consultation.acceptedAt).toBeTruthy();
});

test('cancellation diagnostic labels remain stable', () => {
  expect(Object.fromEntries(Object.entries(consultationPolicy.CANCELLATION_TYPES).map(([type, value]) => [type, value.label]))).toEqual({
    client_cancelled: 'Отменена клиентом',
    lawyer_cancelled: 'Отменена юристом',
    admin_cancelled: 'Отменена администратором',
    provider_cancelled: 'Отменена платёжным провайдером',
    lawyer_rejected: 'Юрист отклонил запрос',
    payment_expired: 'Истёк срок оплаты',
  });
});

test('unscheduled accepted chat completes only after bilateral messages', async () => {
  const { client, lawyer, consultation } = await fixture('accepted', { type: 'chat', meetingProvider: 'none', isFree: true, price: 0 });
  const auth = `Bearer ${tokenFor(client)}`;
  const before = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(before.status).toBe(409);
  expect(before.body.code).toBe('SESSION_EVIDENCE_REQUIRED');
  await models.Message.bulkCreate([
    { consultationId: consultation.id, senderId: client.id, text: 'Вопрос' },
    { consultationId: consultation.id, senderId: lawyer.id, text: 'Ответ' },
  ]);
  const stillAccepted = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(stillAccepted.status).toBe(409);
  expect(stillAccepted.body.code).toBe('CONSULTATION_NOT_STARTED');
  await consultation.update({ status: 'in_progress' });
  const completed = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(completed.status).toBe(200);
  expect(completed.body.consultation.status).toBe('completed');
});

test('lawyer starts unscheduled chat only after bilateral exchange', async () => {
  const { client, lawyer, consultation } = await fixture('accepted', { type: 'chat', meetingProvider: 'none', isFree: true, price: 0 });
  const auth = `Bearer ${tokenFor(lawyer)}`;
  const waiting = await request(app).post(`/api/lawyer/consultations/${consultation.id}/start`).set('Authorization', auth);
  expect(waiting.status).toBe(200);
  expect(waiting.body.awaitingMessageExchange).toBe(true);
  await consultation.reload();
  expect(consultation.status).toBe('accepted');
  await models.Message.bulkCreate([
    { consultationId: consultation.id, senderId: client.id, text: 'Вопрос' },
    { consultationId: consultation.id, senderId: lawyer.id, text: 'Ответ' },
  ]);
  const started = await request(app).post(`/api/lawyer/consultations/${consultation.id}/start`).set('Authorization', auth);
  expect(started.status).toBe(200);
  expect(started.body.consultation.status).toBe('in_progress');
});

test('completion and cancellation race has one winner and no false success', async () => {
  const { client, lawyer, lp, consultation } = await fixture('in_progress', { type: 'chat', meetingProvider: 'none' });
  await lp.update({ pendingBalance: 100000 });
  await Payment.create({ consultationId: consultation.id, userId: client.id, amount: 100000, provider: 'payme', status: 'paid' });
  await models.Message.bulkCreate([
    { consultationId: consultation.id, senderId: client.id, text: 'Вопрос' },
    { consultationId: consultation.id, senderId: lawyer.id, text: 'Ответ' },
  ]);
  const auth = `Bearer ${tokenFor(client)}`;
  const [complete, cancel] = await Promise.all([
    request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth),
    request(app).post(`/api/consultations/${consultation.id}/cancel`).set('Authorization', auth).send({ reason: 'Гонка' }),
  ]);
  expect([complete.status, cancel.status].sort()).toEqual([200, 409]);
  await consultation.reload();
  expect(['completed', 'cancelled']).toContain(consultation.status);
  if (consultation.status === 'cancelled') expect(complete.status).toBe(409);
});

test('отмена требует причину и повтор не создаёт второй возврат', async () => {
  const { client, lp, consultation } = await fixture('pending');
  const promo = await Promo.create({ code: 'LIFECYCLE10', discountPercent: 10, usedCount: 1, isActive: true });
  await consultation.update({ promoCode: promo.code, promoReservedAt: new Date() });
  await lp.update({ pendingBalance: 100000 });
  const payment = await Payment.create({ consultationId: consultation.id, userId: client.id, amount: 100000, provider: 'payme', status: 'paid' });
  const auth = `Bearer ${tokenFor(client)}`;
  expect((await request(app).post(`/api/consultations/${consultation.id}/cancel`).set('Authorization', auth).send({ reason: '   ' })).status).toBe(400);
  expect((await request(app).post(`/api/consultations/${consultation.id}/cancel`).set('Authorization', auth).send({ reason: 'Планы изменились' })).status).toBe(200);
  expect((await request(app).post(`/api/consultations/${consultation.id}/cancel`).set('Authorization', auth).send({ reason: 'Повтор' })).status).toBe(409);
  await Promise.all([consultation.reload(), payment.reload(), lp.reload()]);
  expect(consultation).toMatchObject({ cancelledBy: 'client', cancellationType: 'client_cancelled', cancellationReason: 'Планы изменились' });
  expect(payment.refundStatus).toBe('requested');
  expect(Number(lp.pendingBalance)).toBe(0);
  expect(await FinancialEvent.count({ where: { paymentId: payment.id, type: 'refund_requested' } })).toBe(1);
  expect(await Notification.count({ where: { type: 'consultation_cancelled' } })).toBe(1);
  expect(Number((await promo.reload()).usedCount)).toBe(0);
});

test('accepted нельзя завершить до старта или без доказательства сессии', async () => {
  const future = new Date(Date.now() + 60 * 60000);
  const { client, consultation } = await fixture('accepted', {
    isFree: true, price: 0, type: 'video', scheduledStartAt: future,
    scheduledEndAt: new Date(future.getTime() + 30 * 60000),
  });
  const auth = `Bearer ${tokenFor(client)}`;
  const early = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(early.status).toBe(409);
  expect(early.body.code).toBe('CONSULTATION_NOT_STARTED');
  await consultation.update({ scheduledStartAt: new Date(Date.now() - 1000) });
  const noEvidence = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(noEvidence.status).toBe(409);
  expect(noEvidence.body.code).toBe('SESSION_EVIDENCE_REQUIRED');
});

test('in-progress completion is idempotent and sends one completion notification', async () => {
  const start = new Date(Date.now() - 5 * 60000);
  const { client, consultation } = await fixture('in_progress', {
    isFree: true, price: 0, type: 'video', meetingProvider: 'webrtc', callStartedAt: new Date(),
    scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + 30 * 60000),
  });
  await recordPeerConnected(consultation.id, client.id);
  await recordPeerConnected(consultation.id, consultation.lawyerId);
  const auth = `Bearer ${tokenFor(client)}`;
  const first = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  const second = await request(app).post(`/api/consultations/${consultation.id}/complete`).set('Authorization', auth);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(await Notification.count({ where: { type: 'consultation_completed' } })).toBe(1);
});

test('non-expired payment_pending cannot be rescheduled before payment', async () => {
  const { client, consultation } = await fixture('payment_pending', {
    duration: 30, paymentExpiresAt: new Date(Date.now() + 10 * 60000),
  });
  const response = await request(app).patch(`/api/consultations/${consultation.id}/reschedule`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ preferredDate: '2030-01-01', preferredTime: '09:00' });
  expect(response.status).toBe(400);
  expect((await consultation.reload()).status).toBe('payment_pending');
});

test('archived completed consultation cannot be reviewed until restored', async () => {
  const { client, lawyer, consultation } = await fixture('completed', { archivedAt: new Date() });
  const response = await request(app).post(`/api/lawyers/${lawyer.id}/review`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ consultationId: consultation.id, rating: 5, text: 'Спасибо' });
  expect(response.status).toBe(409);
  expect(await models.Review.count({ where: { consultationId: consultation.id } })).toBe(0);
});

test('period excludes unscheduled rows and ordering never falls back to createdAt', async () => {
  const { client, lawyer } = await fixture('completed');
  await Consultation.destroy({ where: { clientId: client.id } });
  const now = Date.now();
  const rows = await Promise.all([
    Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'past-old', status: 'completed', scheduledStartAt: new Date(now - 3 * 86400000) }),
    Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'past-new', status: 'completed', scheduledStartAt: new Date(now - 86400000) }),
    Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'unscheduled', status: 'completed', createdAt: new Date(now + 86400000) }),
  ]);
  const auth = `Bearer ${tokenFor(client)}`;
  const all = await request(app).get('/api/consultations?bucket=all').set('Authorization', auth);
  expect(all.body.consultations.map((item) => item.id)).toEqual([rows[1].id, rows[0].id, rows[2].id]);
  const period = await request(app).get('/api/consultations?bucket=all&period=30d').set('Authorization', auth);
  expect(period.body.consultations.map((item) => item.id)).not.toContain(rows[2].id);
  expect(period.body.counts.all).toBe(2);
});

test('upcoming ordering is in-progress, accepted nearest, then pending', async () => {
  const { client, lawyer } = await fixture('completed');
  await Consultation.destroy({ where: { clientId: client.id } });
  const now = Date.now();
  const pending = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'pending', status: 'pending', scheduledStartAt: new Date(now + 10 * 60000) });
  const acceptedFar = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'far', status: 'accepted', scheduledStartAt: new Date(now + 60 * 60000) });
  const acceptedNear = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'near', status: 'accepted', scheduledStartAt: new Date(now + 20 * 60000) });
  const inProgress = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'live', status: 'in_progress' });
  const response = await request(app).get('/api/consultations/upcoming').set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.body.consultations.map((item) => item.id)).toEqual([inProgress.id, acceptedNear.id, acceptedFar.id, pending.id]);
});

test('dashboard active count and upcoming endpoint use the same classification', async () => {
  const { client, lawyer } = await fixture('pending');
  await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'accepted', status: 'accepted' });
  await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'expired', status: 'payment_expired' });
  const auth = `Bearer ${tokenFor(client)}`;
  const [stats, upcoming] = await Promise.all([
    request(app).get('/api/dashboard/client/stats').set('Authorization', auth),
    request(app).get('/api/consultations/upcoming').set('Authorization', auth),
  ]);
  expect(stats.body.activeConsultations).toBe(2);
  expect(upcoming.body.consultations).toHaveLength(2);
  expect(upcoming.body.consultations.every((item) => item.policy.bucket === 'upcoming')).toBe(true);
});
