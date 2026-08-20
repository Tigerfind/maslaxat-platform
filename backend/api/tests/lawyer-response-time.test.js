const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

async function acceptedConsultation(clientId, lawyerId, minutes, index) {
  const createdAt = new Date(Date.now() - (index + 2) * 24 * 60 * 60 * 1000);
  return models.Consultation.create({
    clientId, lawyerId, question: `response-${index}`, status: 'accepted',
    createdAt, acceptedAt: new Date(createdAt.getTime() + minutes * 60000),
  });
}

test('не публикует время ответа при менее чем трёх наблюдениях', async () => {
  const client = await makeClient('response-few-client@test.uz');
  const { user: lawyer } = await makeLawyer('response-few-lawyer@test.uz');
  await acceptedConsultation(client.id, lawyer.id, 30, 0);
  await acceptedConsultation(client.id, lawyer.id, 90, 1);

  const profile = await request(app).get(`/api/lawyers/${lawyer.id}`);
  expect(profile.body.lawyer.profile.medianResponseMinutes).toBeNull();
});

test('публикует реальную медиану createdAt → acceptedAt при трёх наблюдениях', async () => {
  const client = await makeClient('response-median-client@test.uz');
  const { user: lawyer } = await makeLawyer('response-median-lawyer@test.uz');
  await acceptedConsultation(client.id, lawyer.id, 30, 0);
  await acceptedConsultation(client.id, lawyer.id, 120, 1);
  await acceptedConsultation(client.id, lawyer.id, 600, 2);

  const [catalog, profile] = await Promise.all([
    request(app).get('/api/lawyers?sortBy=recommended'),
    request(app).get(`/api/lawyers/${lawyer.id}`),
  ]);
  expect(catalog.body.lawyers.find((item) => item.id === lawyer.id).profile.medianResponseMinutes).toBe(120);
  expect(profile.body.lawyer.profile.medianResponseMinutes).toBe(120);
});

test('первое принятие заявки фиксирует acceptedAt, повтор не перезаписывает', async () => {
  const client = await makeClient('response-accept-client@test.uz');
  const { user: lawyer } = await makeLawyer('response-accept-lawyer@test.uz');
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'accept timestamp', status: 'pending',
  });
  const auth = `Bearer ${tokenFor(lawyer)}`;
  expect((await request(app).post(`/api/lawyer/consultation-requests/${consultation.id}/accept`).set('Authorization', auth)).status).toBe(200);
  await consultation.reload();
  const firstAcceptedAt = consultation.acceptedAt.toISOString();
  expect((await request(app).post(`/api/lawyer/consultation-requests/${consultation.id}/accept`).set('Authorization', auth)).status).toBe(200);
  await consultation.reload();
  expect(consultation.acceptedAt.toISOString()).toBe(firstAcceptedAt);
});
