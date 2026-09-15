const request = require('supertest');
const app = require('../src/server');
const { resetDb, sequelize, models, tokenFor, makeClient, makeLawyer } = require('./helpers');
const { processDueReminders } = require('../src/services/deadlineReminderService');

const { Consultation, Document, Message, Payment, ClientCase, CaseDeadline, DeadlineReminder, CaseAuditEvent, Notification } = models;

let clientA;
let clientB;
let lawyer;
let tokenA;
let tokenB;
let consultation;
let document;

beforeAll(async () => {
  await resetDb();
  clientA = await makeClient('cabinet-a@test.uz');
  clientB = await makeClient('cabinet-b@test.uz');
  ({ user: lawyer } = await makeLawyer('cabinet-lawyer@test.uz'));
  tokenA = tokenFor(clientA);
  tokenB = tokenFor(clientB);
  consultation = await Consultation.create({ clientId: clientA.id, lawyerId: lawyer.id, type: 'chat', status: 'accepted', question: 'Contract dispute', scheduledStartAt: new Date(Date.now() + 3600000), scheduledEndAt: new Date(Date.now() + 7200000), scheduleTimezone: 'Asia/Tashkent', lawyerNote: 'private note' });
  document = await Document.create({ userId: clientA.id, name: 'contract.pdf', type: 'PDF', status: 'issues' });
  const messageTime = Date.now();
  await Message.bulkCreate([
    { consultationId: consultation.id, senderId: clientA.id, text: 'Client body', isRead: true, createdAt: new Date(messageTime - 1000), updatedAt: new Date(messageTime - 1000) },
    { consultationId: consultation.id, senderId: lawyer.id, text: 'Unread lawyer body', isRead: false, createdAt: new Date(messageTime), updatedAt: new Date(messageTime) },
  ]);
  await Payment.create({ consultationId: consultation.id, userId: clientA.id, amount: 120000, status: 'pending', providerResponse: { secret: 'hidden' }, refundRequestedBy: lawyer.id, refundReason: 'private' });
  await ClientCase.create({ clientId: clientA.id, title: 'Dashboard active case', status: 'in_progress' });
});

afterAll(async () => sequelize.close());

test('dashboard aggregates only caller data and redacts private fields', async () => {
  const response = await request(app).get('/api/client/dashboard').set('Authorization', `Bearer ${tokenA}`);
  expect(response.status).toBe(200);
  expect(response.body.pendingPaymentsCount).toBe(1);
  expect(response.body.activeCasesCount).toBe(1);
  expect(response.body.unreadMessagesCount).toBe(1);
  expect(response.body.documentsAttentionCount).toBe(1);
  expect(response.body.nextConsultation.lawyerNote).toBeUndefined();
  expect(response.body.recentPayments[0].providerResponse).toBeUndefined();
  const other = await request(app).get('/api/client/dashboard').set('Authorization', `Bearer ${tokenB}`);
  expect(other.body.pendingPaymentsCount).toBe(0);
});

test('lawyer history is distinct, paginated, searchable, and public-only', async () => {
  await Consultation.create({ clientId: clientA.id, lawyerId: lawyer.id, type: 'chat', status: 'completed', question: 'Second matter', lawyerNote: 'another private note' });
  const response = await request(app).get('/api/client/lawyers/history?search=Test&page=1&limit=5').set('Authorization', `Bearer ${tokenA}`);
  expect(response.status).toBe(200);
  expect(response.body.total).toBe(1);
  expect(response.body.lawyers[0].lastConsultationAt).toBeTruthy();
  expect(response.body.lawyers[0].email).toBeUndefined();
});

test('message inbox summarizes unread messages without exposing full consultation secrets', async () => {
  const response = await request(app).get('/api/client/messages?page=1&limit=10').set('Authorization', `Bearer ${tokenA}`);
  expect(response.status).toBe(200);
  expect(response.body.totalUnread).toBe(1);
  const conversation = response.body.conversations.find((item) => item.consultationId === consultation.id);
  expect(conversation.lastMessage.excerpt).toBe('Unread lawyer body');
  expect(conversation.partner.email).toBeUndefined();
});

test('case lifecycle links owned resources, audits changes, and isolates owners', async () => {
  const created = await request(app).post('/api/client/cases').set('Authorization', `Bearer ${tokenA}`).send({ title: 'Contract case', description: 'Initial' });
  expect(created.status).toBe(201);
  const caseId = created.body.id;
  expect((await request(app).get(`/api/client/cases/${caseId}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
  expect((await request(app).put(`/api/client/cases/${caseId}/consultations/${consultation.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
  expect((await request(app).put(`/api/client/cases/${caseId}/documents/${document.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
  const detail = await request(app).get(`/api/client/cases/${caseId}`).set('Authorization', `Bearer ${tokenA}`);
  expect(detail.body.consultations[0].lawyerNote).toBeUndefined();
  expect(detail.body.documents[0].path).toBeUndefined();
  expect(detail.body.messages).toEqual({ count: 2, unreadCount: 1 });
  expect((await request(app).patch(`/api/client/cases/${caseId}`).set('Authorization', `Bearer ${tokenA}`).send({ status: 'in_progress' })).status).toBe(200);
  expect((await request(app).patch(`/api/client/cases/${caseId}/archive`).set('Authorization', `Bearer ${tokenA}`).send({ archived: true })).body.status).toBe('archived');
  expect((await request(app).patch(`/api/client/cases/${caseId}/archive`).set('Authorization', `Bearer ${tokenA}`).send({ archived: false })).body.status).toBe('in_progress');
  expect(await CaseAuditEvent.count({ where: { clientCaseId: caseId } })).toBeGreaterThanOrEqual(5);
});

test('cases support search and pagination', async () => {
  await ClientCase.bulkCreate([{ clientId: clientA.id, title: 'Alpha matter' }, { clientId: clientA.id, title: 'Beta matter' }, { clientId: clientB.id, title: 'Alpha foreign' }]);
  const response = await request(app).get('/api/client/cases?search=Alpha&page=1&limit=1').set('Authorization', `Bearer ${tokenA}`);
  expect(response.status).toBe(200);
  expect(response.body.total).toBe(1);
  expect(response.body.cases[0].title).toBe('Alpha matter');
});

test('deadlines atomically reschedule/cancel reminders and processor is idempotent', async () => {
  const clientCase = await ClientCase.create({ clientId: clientA.id, title: 'Deadline case' });
  const dueAt = new Date(Date.now() + 60000).toISOString();
  const created = await request(app).post(`/api/client/cases/${clientCase.id}/deadlines`).set('Authorization', `Bearer ${tokenA}`).send({ title: 'Submit claim', dueAt, timezone: 'Asia/Tashkent', reminders: [{ interval: '1h', channel: 'in_app' }] });
  expect(created.status).toBe(201);
  const deadlineId = created.body.id;
  expect(created.body.reminders).toHaveLength(1);
  await Promise.all([processDueReminders(new Date()), processDueReminders(new Date())]);
  expect(await Notification.count({ where: { userId: clientA.id, type: 'case_deadline' } })).toBe(1);
  expect((await DeadlineReminder.findOne({ where: { deadlineId } })).state).toBe('sent');

  const moved = new Date(Date.now() + 86400000).toISOString();
  const patched = await request(app).patch(`/api/client/cases/${clientCase.id}/deadlines/${deadlineId}`).set('Authorization', `Bearer ${tokenA}`).send({ dueAt: moved, reminders: [{ interval: '10m', channel: 'in_app' }] });
  expect(patched.status).toBe(200);
  expect(patched.body.reminders.some((item) => item.state === 'scheduled')).toBe(true);
  const completed = await request(app).patch(`/api/client/cases/${clientCase.id}/deadlines/${deadlineId}/complete`).set('Authorization', `Bearer ${tokenA}`).send({});
  expect(completed.body.status).toBe('completed');
  expect(await DeadlineReminder.count({ where: { deadlineId, state: 'scheduled' } })).toBe(0);
  expect((await request(app).patch(`/api/client/cases/${clientCase.id}/deadlines/${deadlineId}`).set('Authorization', `Bearer ${tokenB}`).send({ title: 'Nope' })).status).toBe(404);
  const cancellable = await CaseDeadline.create({ clientCaseId: clientCase.id, title: 'Cancel me', dueAt: new Date(Date.now() + 3600000), timezone: 'Asia/Tashkent' });
  expect((await request(app).delete(`/api/client/cases/${clientCase.id}/deadlines/${cancellable.id}`).set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
  expect((await cancellable.reload()).status).toBe('cancelled');

  const staleDeadline = await CaseDeadline.create({ clientCaseId: clientCase.id, title: 'Recover lease', dueAt: new Date(Date.now() + 3600000), timezone: 'Asia/Tashkent' });
  const staleReminder = await DeadlineReminder.create({ deadlineId: staleDeadline.id, channel: 'in_app', intervalMinutes: 60, remindAt: new Date(Date.now() - 60000), nextAttemptAt: new Date(Date.now() - 60000), state: 'processing', leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() - 1000), idempotencyKey: `stale:${staleDeadline.id}` });
  await processDueReminders(new Date());
  expect((await staleReminder.reload()).state).toBe('sent');
});

test('payment history/status/receipt redact internals and enforce payer ownership', async () => {
  const payment = await Payment.findOne({ where: { userId: clientA.id } });
  const list = await request(app).get('/api/payments/my?page=1&limit=5&status=pending').set('Authorization', `Bearer ${tokenA}`);
  expect(list.status).toBe(200);
  expect(list.body.total).toBe(1);
  expect(JSON.stringify(list.body)).not.toContain('providerResponse');
  expect(JSON.stringify(list.body)).not.toContain('refundRequestedBy');
  expect((await request(app).get(`/api/payments/${payment.id}/status`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
  const receipt = await request(app).get(`/api/payments/${payment.id}/receipt`).set('Authorization', `Bearer ${tokenA}`);
  expect(receipt.status).toBe(200);
  expect(receipt.headers['content-type']).toContain('text/plain');
  expect(receipt.text).toContain(payment.id);
});

test('documents preserve legacy arrays and provide paginated search/rename/archive', async () => {
  const legacy = await request(app).get('/api/documents').set('Authorization', `Bearer ${tokenA}`);
  expect(Array.isArray(legacy.body)).toBe(true);
  const paged = await request(app).get('/api/documents?page=1&limit=5&search=contract').set('Authorization', `Bearer ${tokenA}`);
  expect(paged.body.total).toBe(1);
  expect((await request(app).patch(`/api/documents/${document.id}/rename`).set('Authorization', `Bearer ${tokenB}`).send({ name: 'stolen.pdf' })).status).toBe(404);
  expect((await request(app).patch(`/api/documents/${document.id}/rename`).set('Authorization', `Bearer ${tokenA}`).send({ name: 'renamed.pdf' })).body.name).toBe('renamed.pdf');
  expect((await request(app).patch(`/api/documents/${document.id}/archive`).set('Authorization', `Bearer ${tokenA}`).send({ archived: true })).status).toBe(200);
  const firstCase = await ClientCase.create({ clientId: clientA.id, title: 'First link' });
  const secondCase = await ClientCase.create({ clientId: clientA.id, title: 'Second link' });
  expect((await request(app).patch(`/api/documents/${document.id}/case`).set('Authorization', `Bearer ${tokenA}`).send({ caseId: firstCase.id })).status).toBe(200);
  expect((await request(app).patch(`/api/documents/${document.id}/case`).set('Authorization', `Bearer ${tokenA}`).send({ caseId: secondCase.id })).status).toBe(200);
  expect((await document.reload()).clientCaseId).toBe(secondCase.id);
  expect((await request(app).patch(`/api/documents/${document.id}/case`).set('Authorization', `Bearer ${tokenB}`).send({ caseId: secondCase.id })).status).toBe(404);
});
