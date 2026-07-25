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

    // admin lists
    const list = await request(app).get('/api/admin/support').set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(list.status).toBe(200);
    expect(list.body.some((tk) => tk.id === ticketId)).toBe(true);

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
