const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer, tokenFor } = require('./helpers');

// Каждая вкладка на странице «Консультации» — это серверный bucket. Клиент
// видит число на вкладке и список внутри неё; если они расходятся, интерфейс
// врёт. Тест держит их согласованными и проверяет, что консультация попадает
// ровно в одну смысловую вкладку.
let client; let fixtures;

beforeAll(async () => {
  await resetDb();
  client = await makeClient('buckets-client@test.uz');
  const { user: lawyer } = await makeLawyer('buckets-lawyer@test.uz');

  const create = (status, question) => models.Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, status, question, price: 100000,
  });

  fixtures = {
    payment: await create('payment_pending', 'Ждёт оплаты'),
    pending: await create('pending', 'Ждёт подтверждения'),
    accepted: await create('accepted', 'Подтверждена'),
    inProgress: await create('in_progress', 'Идёт'),
    unrated: await create('completed', 'Завершена без оценки'),
    rated: await create('completed', 'Завершена и оценена'),
    archived: await create('completed', 'Явно архивирована'),
    cancelled: await create('cancelled', 'Отменена'),
    rejected: await create('rejected', 'Отклонена'),
    expired: await create('payment_expired', 'Истекла оплата'),
  };
  await models.Review.create({
    clientId: client.id, lawyerId: lawyer.id, consultationId: fixtures.rated.id, rating: 5,
  });
  await fixtures.archived.update({ archivedAt: new Date() });
});

const load = (bucket) => request(app)
  .get(`/api/client/consultations?bucket=${bucket}&limit=50`)
  .set('Authorization', `Bearer ${tokenFor(client)}`);

describe('вкладки консультаций', () => {
  test('число на вкладке совпадает с тем, что в ней лежит', async () => {
    const { body } = await load('all');
    const counts = body.counts;
    for (const bucket of ['all', 'payment_pending', 'upcoming', 'completed', 'cancelled', 'archived']) {
      const res = await load(bucket);
      expect(res.status).toBe(200);
      expect({ bucket, total: res.body.total }).toEqual({ bucket, total: counts[bucket] });
      expect({ bucket, rows: res.body.consultations.length })
        .toEqual({ bucket, rows: counts[bucket] });
    }
  });

  test('«Завершённые» содержат все неархивированные, включая оценённые', async () => {
    const { body } = await load('completed');
    const ids = body.consultations.map((c) => c.id);
    expect(ids).toContain(fixtures.unrated.id);
    expect(ids).toContain(fixtures.rated.id);
    expect(ids).not.toContain(fixtures.archived.id);
  });

  test('«Архив» определяется только archivedAt', async () => {
    const { body } = await load('archived');
    const ids = body.consultations.map((c) => c.id);
    expect(ids).toContain(fixtures.archived.id);
    expect(ids).not.toContain(fixtures.rated.id);
    expect(ids).not.toContain(fixtures.unrated.id);
  });

  test('«Предстоящие» — ожидание, подтверждение и идущие; без неоплаченных', async () => {
    const { body } = await load('upcoming');
    const ids = body.consultations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([fixtures.pending.id, fixtures.accepted.id, fixtures.inProgress.id]));
    expect(ids).not.toContain(fixtures.payment.id);
  });

  test('«Ожидают оплаты» — только неоплаченные', async () => {
    const { body } = await load('payment_pending');
    expect(body.consultations.map((c) => c.id)).toEqual([fixtures.payment.id]);
  });

  test('«Отменённые» — и отменённые клиентом, и отклонённые юристом', async () => {
    const { body } = await load('cancelled');
    const ids = body.consultations.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([fixtures.cancelled.id, fixtures.rejected.id, fixtures.expired.id]));
    const byId = Object.fromEntries(body.consultations.map((item) => [item.id, item]));
    expect(byId[fixtures.cancelled.id].policy.cancellation.code).toBe('CONSULTATION_CANCELLED');
    expect(byId[fixtures.rejected.id].policy.cancellation).toMatchObject({ code: 'LAWYER_REJECTED', label: 'Юрист отклонил запрос' });
    expect(byId[fixtures.expired.id].policy.cancellation).toMatchObject({ code: 'PAYMENT_EXPIRED', label: 'Истёк срок оплаты' });
  });

  test('«Все» содержат каждую консультацию ровно один раз', async () => {
    const { body } = await load('all');
    const ids = body.consultations.map((c) => c.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  test('вкладки не пересекаются: сумма частей равна целому', async () => {
    const { body } = await load('all');
    const c = body.counts;
    expect(c.payment_pending + c.upcoming + c.completed + c.cancelled + c.archived).toBe(c.all);
  });
});
