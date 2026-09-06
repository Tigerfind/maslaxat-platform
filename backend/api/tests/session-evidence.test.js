const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

const { Consultation, Payment, LawyerProfile, Review } = models;

beforeEach(resetDb);

test('юрист не переводит accepted в работу через generic status', async () => {
  const client = await makeClient('evidence-client@test.uz');
  const { user: lawyer } = await makeLawyer('evidence-lawyer@test.uz');
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Проверка', status: 'accepted', type: 'video', price: 100000 });
  const response = await request(app).patch(`/api/consultations/${consultation.id}/status`)
    .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ status: 'in_progress' });
  expect(response.status).toBe(400);
  expect((await consultation.reload()).status).toBe('accepted');
});

test('юрист не завершает видео без подтверждённого соединения и не получает escrow', async () => {
  const client = await makeClient('evidence-paid-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('evidence-paid-lawyer@test.uz', { pendingBalance: 100000 });
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Проверка', status: 'in_progress', type: 'video', price: 100000 });
  await consultation.update({ commissionRateBps: 0, grossAmountTiyin: 10000000, lawyerNetAmountTiyin: 10000000 });
  await Payment.create({
    consultationId: consultation.id, userId: client.id, purpose: 'consultation',
    amount: 100000, amountTiyin: 10000000, refundedAmountTiyin: 0,
    provider: 'payme', status: 'paid',
  });
  const response = await request(app).post(`/api/lawyer/consultations/${consultation.id}/end`)
    .set('Authorization', `Bearer ${tokenFor(lawyer)}`).send({ notes: 'Итог без звонка' });
  expect(response.status).toBe(400);
  const profile = await LawyerProfile.findByPk(lp.id);
  expect(Number(profile.pendingBalance)).toBe(100000);
  expect(Number(profile.balance)).toBe(0);
  expect((await consultation.reload()).status).toBe('in_progress');
});

test('даже после соединения юрист только запрашивает завершение, escrow выпускает клиент', async () => {
  const client = await makeClient('confirm-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('confirm-lawyer@test.uz', { pendingBalance: 100000 });
  await lawyer.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Проверка', status: 'in_progress', type: 'video', price: 100000, callStartedAt: new Date() });
  await consultation.update({ commissionRateBps: 0, grossAmountTiyin: 10000000, lawyerNetAmountTiyin: 10000000 });
  await Payment.create({
    consultationId: consultation.id, userId: client.id, purpose: 'consultation',
    amount: 100000, amountTiyin: 10000000, refundedAmountTiyin: 0,
    provider: 'payme', status: 'paid',
  });
  const lawyerEnd = await request(app).post(`/api/video/consultation/${consultation.id}/end`)
    .set('Authorization', `Bearer ${tokenFor(lawyer, 'mfa')}`).set('X-Maslaxat-Mode', 'lawyer').send({ durationSeconds: 600 });
  expect(lawyerEnd.body).toMatchObject({ status: 'in_progress', awaitingClientConfirmation: true });
  await lp.reload();
  expect(Number(lp.balance)).toBe(0);
  expect(Number(lp.pendingBalance)).toBe(100000);

  expect((await request(app).post(`/api/consultations/${consultation.id}/complete`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)).status).toBe(200);
  await lp.reload();
  expect(Number(lp.balance)).toBe(100000);
  expect(Number(lp.pendingBalance)).toBe(0);
});

test('публичный отзыв не раскрывает UUID, полное имя и avatar клиента', async () => {
  const client = await makeClient('review-privacy-client@test.uz', { name: 'Алина Каримова', avatar: '/uploads/private-avatar.jpg' });
  const { user: lawyer } = await makeLawyer('review-privacy-lawyer@test.uz');
  const consultation = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'Проверка', status: 'completed', price: 0 });
  await Review.create({ clientId: client.id, lawyerId: lawyer.id, consultationId: consultation.id, rating: 5, text: 'Спасибо' });
  const response = await request(app).get(`/api/lawyers/${lawyer.id}/reviews`);
  expect(response.status).toBe(200);
  expect(response.body.reviews[0].client).toEqual({ name: 'Алина К.', avatar: null });
  expect(JSON.stringify(response.body)).not.toContain(client.id);
  expect(JSON.stringify(response.body)).not.toContain('private-avatar');
});
