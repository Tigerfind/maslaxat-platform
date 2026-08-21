const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

async function scheduledFixture(offsetMinutes = 10, duration = 60) {
  const client = await makeClient(`details-client-${offsetMinutes}@test.uz`);
  const outsider = await makeClient(`details-outsider-${offsetMinutes}@test.uz`);
  const { user: lawyer } = await makeLawyer(`details-lawyer-${offsetMinutes}@test.uz`);
  const start = new Date(Date.now() + offsetMinutes * 60000);
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status: 'accepted', type: 'video',
    question: 'Детальный вопрос', price: 200000, lawyerNote: 'private',
    acceptedAt: new Date(),
    scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + duration * 60000),
  });
  return { client, outsider, lawyer, consultation };
}

test('join открывается за 15 минут и сервер блокирует ранний/закрытый доступ', async () => {
  const early = await scheduledFixture(60);
  const earlyJoin = await request(app).post(`/api/client/consultations/${early.consultation.id}/join`)
    .set('Authorization', `Bearer ${tokenFor(early.client)}`);
  expect(earlyJoin.status).toBe(403);
  expect(earlyJoin.body.code).toBe('TOO_EARLY');

  const open = await scheduledFixture(10);
  expect((await request(app).post(`/api/client/consultations/${open.consultation.id}/join`)
    .set('Authorization', `Bearer ${tokenFor(open.client)}`)).status).toBe(200);

  const closed = await scheduledFixture(-240, 60);
  const closedJoin = await request(app).post(`/api/client/consultations/${closed.consultation.id}/join`)
    .set('Authorization', `Bearer ${tokenFor(closed.client)}`);
  expect(closedJoin.status).toBe(403);
  expect(closedJoin.body.code).toBe('WINDOW_CLOSED');
});

test('video endpoint не выдаёт ICE и не стартует звонок вне окна', async () => {
  const { client, consultation } = await scheduledFixture(60);
  const auth = `Bearer ${tokenFor(client)}`;
  const details = await request(app).get(`/api/video/consultation/${consultation.id}`).set('Authorization', auth);
  expect(details.body.iceServers).toEqual([]);
  expect(details.body.access.reason).toBe('TOO_EARLY');
  const start = await request(app).post(`/api/video/consultation/${consultation.id}/start`).set('Authorization', auth);
  expect(start.status).toBe(403);
});

test('detail отдаёт безопасный payment/doc/history DTO и скрывает private note от клиента', async () => {
  const { client, outsider, lawyer, consultation } = await scheduledFixture(10);
  await models.Payment.create({ consultationId: consultation.id, userId: client.id, amount: 200000, status: 'paid' });
  await models.CaseDocument.create({ consultationId: consultation.id, uploaderId: client.id, name: 'case.pdf', path: '/private/case.pdf' });
  const response = await request(app).get(`/api/client/consultations/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body.payment).toMatchObject({ status: 'paid', amount: 200000, currency: 'UZS' });
  expect(response.body.documents.count).toBe(1);
  expect(response.body.access.canJoin).toBe(true);
  expect(response.body.statusHistory.map((item) => item.status)).toContain('accepted');
  expect(response.body.consultation.lawyerNote).toBeUndefined();
  expect(JSON.stringify(response.body)).not.toContain('providerResponse');
  expect((await request(app).get(`/api/client/consultations/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`)).status).toBe(403);
  expect(lawyer.id).toBeTruthy();
});

test('юрист сохраняет итог, клиент видит его в деталях', async () => {
  const { client, lawyer, consultation } = await scheduledFixture(-10);
  await consultation.update({ status: 'in_progress' });
  const summary = 'Обсудили договор. Следующий шаг — направить письменную претензию.';
  const save = await request(app).patch(`/api/consultations/${consultation.id}/summary`)
    .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ summary });
  expect(save.status).toBe(200);
  const details = await request(app).get(`/api/client/consultations/${consultation.id}`)
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(details.body.consultation.lawyerSummary).toBe(summary);
});

test('завершение из кабинета юриста требует итог и сохраняет его вместе с completed', async () => {
  const { lawyer, consultation } = await scheduledFixture(-10);
  await consultation.update({ status: 'in_progress' });
  const auth = `Bearer ${tokenFor(lawyer)}`;
  expect((await request(app).post(`/api/lawyer/consultations/${consultation.id}/end`)
    .set('Authorization', auth).send({ notes: '' })).status).toBe(400);
  const summary = 'Проверить доказательства и направить претензию в течение недели.';
  expect((await request(app).post(`/api/lawyer/consultations/${consultation.id}/end`)
    .set('Authorization', auth).send({ notes: summary })).status).toBe(200);
  await consultation.reload();
  expect(consultation.status).toBe('completed');
  expect(consultation.lawyerSummary).toBe(summary);
});
