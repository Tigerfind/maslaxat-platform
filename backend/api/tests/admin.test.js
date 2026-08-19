const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeAdmin } = require('./helpers');

beforeAll(async () => {
  await resetDb();
});

describe('admin: промокоды CRUD', () => {
  test('админ создаёт, листит, включает/выключает и удаляет промокод', async () => {
    const admin = await makeAdmin('promoadmin@test.uz');
    const token = tokenFor(admin);

    // create
    const created = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'adm25', discountPercent: 25, minAmount: 0 });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('ADM25');
    const id = created.body.id;

    // list
    const list = await request(app).get('/api/admin/promos').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.some((p) => p.id === id)).toBe(true);

    // toggle off
    const patched = await request(app).patch(`/api/admin/promos/${id}`)
      .set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(patched.status).toBe(200);
    expect(patched.body.isActive).toBe(false);

    // delete
    const del = await request(app).delete(`/api/admin/promos/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
  });

  test('дубликат кода → 409', async () => {
    const admin = await makeAdmin('promoadmin2@test.uz');
    const token = tokenFor(admin);
    await models.Promo.create({ code: 'DUP', discountPercent: 10 });
    const res = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${token}`).send({ code: 'dup', discountPercent: 10 });
    expect(res.status).toBe(409);
  });

  test('невалидная скидка (>100) → 400', async () => {
    const admin = await makeAdmin('promoadmin3@test.uz');
    const token = tokenFor(admin);
    const res = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${token}`).send({ code: 'BAD', discountPercent: 150 });
    expect(res.status).toBe(400);
  });

  test('клиент не имеет доступа к админ-промо → 403', async () => {
    const client = await makeClient('promoclient@test.uz');
    const res = await request(app).get('/api/admin/promos').set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(res.status).toBe(403);
  });
});

describe('admin: поддержка', () => {
  test('админ видит тикеты и меняет статус', async () => {
    const client = await makeClient('supclient@test.uz');
    const admin = await makeAdmin('supadmin@test.uz');

    // client creates a ticket
    const created = await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ subject: 'Тест', message: 'проблема' });
    expect(created.status).toBe(201);
    const ticketId = created.body.ticket.id;

    // admin lists — ответ теперь пагинированный: { tickets, total, page, totalPages, counts }
    const list = await request(app).get('/api/admin/support').set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.tickets)).toBe(true);
    expect(list.body.tickets.some((tk) => tk.id === ticketId)).toBe(true);
    expect(list.body.counts.open).toBeGreaterThanOrEqual(1);

    // фильтр по статусу отсекает закрытые
    const openOnly = await request(app).get('/api/admin/support?status=closed')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(openOnly.status).toBe(200);
    expect(openOnly.body.tickets.some((tk) => tk.id === ticketId)).toBe(false);

    // admin changes status
    const patched = await request(app).patch(`/api/admin/support/${ticketId}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'closed' });
    expect(patched.status).toBe(200);
    expect(patched.body.ticket.status).toBe('closed');
  });

  test('недопустимый статус тикета → 400', async () => {
    const admin = await makeAdmin('supadmin2@test.uz');
    const client = await makeClient('supclient2@test.uz');
    const created = await request(app).post('/api/support')
      .set('Authorization', `Bearer ${tokenFor(client)}`).send({ message: 'x' });
    const res = await request(app).patch(`/api/admin/support/${created.body.ticket.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'hacked' });
    expect(res.status).toBe(400);
  });
});

describe('admin: достоверность списков (Фаза 1)', () => {
  test('GET /admin/users — счётчики по всей таблице, а не по странице', async () => {
    const admin = await makeAdmin('countadmin@test.uz');
    const token = tokenFor(admin);
    await makeClient('c1@count.uz');
    await makeClient('c2@count.uz');

    // limit=1 отдаёт одну запись, но counts должны отражать всю базу —
    // иначе KPI-карточка показывала бы «Всего: 1».
    const res = await request(app).get('/api/admin/users?limit=1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.counts.all).toBeGreaterThan(1);
    expect(res.body.counts.all).toBe(res.body.total);
    expect(res.body.counts.clients).toBeGreaterThanOrEqual(2);
    expect(res.body.totalPages).toBeGreaterThan(1);
  });

  test('GET /admin/lawyers — фильтр по статусу модерации + счётчики очереди', async () => {
    const admin = await makeAdmin('lqadmin@test.uz');
    const token = tokenFor(admin);

    const lawyer = await models.User.create({
      name: 'На проверке', email: 'pendinglawyer@count.uz', password: 'x12345678', role: 'lawyer',
    });
    await models.LawyerProfile.create({
      userId: lawyer.id, specialization: 'Гражданское право', verificationStatus: 'pending_review',
    });

    const pending = await request(app).get('/api/admin/lawyers?status=pending_review')
      .set('Authorization', `Bearer ${token}`);
    expect(pending.status).toBe(200);
    expect(pending.body.lawyers.every((l) => l.profile.verificationStatus === 'pending_review')).toBe(true);
    expect(pending.body.counts.pending).toBeGreaterThanOrEqual(1);

    const approved = await request(app).get('/api/admin/lawyers?status=approved')
      .set('Authorization', `Bearer ${token}`);
    expect(approved.body.lawyers.some((l) => l.id === lawyer.id)).toBe(false);
  });

  test('GET /admin/specializations — lawyerCount считается, а не берётся из колонки', async () => {
    const admin = await makeAdmin('specadmin2@test.uz');
    const token = tokenFor(admin);

    // Колонка намеренно врёт (как в сиде) — ответ должен её игнорировать.
    await models.Specialization.create({ name: 'Морское право', lawyerCount: 99 });

    const res = await request(app).get('/api/admin/specializations')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const spec = res.body.find((s) => s.name === 'Морское право');
    expect(spec.lawyerCount).toBe(0);
  });

  test('GET /admin/reviews — пагинация и счётчики скрытых', async () => {
    const admin = await makeAdmin('revadmin2@test.uz');
    const res = await request(app).get('/api/admin/reviews?limit=5')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.reviews)).toBe(true);
    expect(res.body.counts).toHaveProperty('hidden');
    expect(res.body.counts.all).toBe(res.body.counts.visible + res.body.counts.hidden);
  });
});
