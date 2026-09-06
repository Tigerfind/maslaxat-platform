const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

test('pagination не искажает серверные счётчики semantic-вкладок', async () => {
  const client = await makeClient('list-client@test.uz');
  const { user: lawyer } = await makeLawyer('list-lawyer@test.uz');
  await lawyer.update({ name: 'Юрист Пагинация' });
  const create = (status, question) => models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status, question, price: 100000,
  });
  await create('payment_pending', 'Оплата один');
  await create('payment_pending', 'Оплата два');
  await create('pending', 'Будущая один');
  await create('accepted', 'Будущая два');
  await create('in_progress', 'Будущая три');
  const unrated = await create('completed', 'Завершена');
  const rated = await create('completed', 'Архив');
  await create('cancelled', 'Отмена');
  await models.Review.create({ clientId: client.id, lawyerId: lawyer.id, consultationId: rated.id, rating: 5 });

  const response = await request(app).get('/api/client/consultations?bucket=all&page=1&limit=2')
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.status).toBe(200);
  expect(response.body.consultations).toHaveLength(2);
  expect(response.body.total).toBe(8);
  expect(response.body.totalPages).toBe(4);
  expect(response.body.counts).toEqual({
    all: 8, payment_pending: 2, upcoming: 3, completed: 1, cancelled: 1, archived: 1,
  });
  expect(unrated.id).toBeTruthy();
});

test('payment bucket честно отдаёт expiry/payment DTO и не раскрывает private lawyerNote', async () => {
  const client = await makeClient('list-pay-client@test.uz');
  const { user: lawyer } = await makeLawyer('list-pay-lawyer@test.uz');
  const consultation = await models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status: 'payment_pending', question: 'Оплатить',
    price: 250000, lawyerNote: 'private note',
  });
  const response = await request(app).get('/api/client/consultations?bucket=payment_pending')
    .set('Authorization', `Bearer ${tokenFor(client)}`);
  expect(response.body.consultations[0]).toMatchObject({
    id: consultation.id,
    payment: { status: 'authorization_pending', amount: 250000, currency: 'UZS' },
  });
  expect(response.body.consultations[0].paymentExpiresAt).toBeTruthy();
  expect(response.body.consultations[0].lawyerNote).toBeUndefined();
});

test('поиск работает по имени юриста и вопросу до pagination', async () => {
  const client = await makeClient('list-search-client@test.uz');
  const { user: lawyer } = await makeLawyer('list-search-lawyer@test.uz');
  await lawyer.update({ name: 'Адвокат Поисков' });
  await models.Consultation.create({ clientId: client.id, lawyerId: lawyer.id, status: 'pending', question: 'Наследственный спор' });
  const auth = `Bearer ${tokenFor(client)}`;
  const byName = await request(app).get(`/api/client/consultations?search=${encodeURIComponent('Поисков')}`).set('Authorization', auth);
  const byQuestion = await request(app).get(`/api/client/consultations?search=${encodeURIComponent('Наследственный')}`).set('Authorization', auth);
  expect(byName.body.total).toBe(1);
  expect(byQuestion.body.total).toBe(1);
});
