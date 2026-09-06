const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeLawyer, makeAdmin } = require('./helpers');

beforeAll(async () => {
  await resetDb();
});

describe('admin: специализации не сиротят профили юристов', () => {
  test('удаление используемой специализации → 409 со счётчиком', async () => {
    const admin = await makeAdmin('sgadmin1@test.uz');
    const token = tokenFor(admin);

    const spec = await models.Specialization.create({ name: 'Спортивное право' });
    await makeLawyer('sglawyer1@test.uz', { specialization: 'Спортивное право', specializations: ['Спортивное право'] });

    const res = await request(app).delete(`/api/admin/specializations/${spec.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.inUse).toBe(1);

    // Специализация на месте — профиль не осиротел
    expect(await models.Specialization.findByPk(spec.id)).not.toBeNull();
  });

  test('неиспользуемая специализация удаляется', async () => {
    const admin = await makeAdmin('sgadmin2@test.uz');
    const spec = await models.Specialization.create({ name: 'Космическое право' });

    const res = await request(app).delete(`/api/admin/specializations/${spec.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(await models.Specialization.findByPk(spec.id)).toBeNull();
  });

  test('переименование переносит профили юристов, а не сиротит их', async () => {
    const admin = await makeAdmin('sgadmin3@test.uz');
    const spec = await models.Specialization.create({ name: 'Морское право' });
    const { lp } = await makeLawyer('sglawyer3@test.uz', {
      specialization: 'Морское право',
      specializations: ['Морское право', 'Гражданское право'],
    });

    const res = await request(app).put(`/api/admin/specializations/${spec.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ name: 'Морское и портовое право' });
    expect(res.status).toBe(200);
    expect(res.body.migratedProfiles).toBe(1);

    await lp.reload();
    expect(lp.specialization).toBe('Морское и портовое право');
    // В массиве заменён только нужный элемент, остальные не тронуты
    expect(lp.specializations).toContain('Морское и портовое право');
    expect(lp.specializations).toContain('Гражданское право');
    expect(lp.specializations).not.toContain('Морское право');
  });

  test('переименование в занятое имя → 400, данные не тронуты', async () => {
    const admin = await makeAdmin('sgadmin4@test.uz');
    await models.Specialization.create({ name: 'Банковское право' });
    const spec = await models.Specialization.create({ name: 'Страховое право' });

    const res = await request(app).put(`/api/admin/specializations/${spec.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ name: 'Банковское право' });
    expect(res.status).toBe(400);

    await spec.reload();
    expect(spec.name).toBe('Страховое право');
  });
});

describe('admin: валидация промокодов', () => {
  test('дата окончания в прошлом → 400 (мёртвый код не создаётся)', async () => {
    const admin = await makeAdmin('pvadmin1@test.uz');
    const res = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'DEAD10', discountPercent: 10, expiresAt: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(await models.Promo.findOne({ where: { code: 'DEAD10' } })).toBeNull();
  });

  test('лимит нельзя опустить ниже уже использованных', async () => {
    const admin = await makeAdmin('pvadmin2@test.uz');
    const promo = await models.Promo.create({ code: 'USED5', discountPercent: 10, usageLimit: 100, usedCount: 5 });

    const bad = await request(app).patch(`/api/admin/promos/${promo.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ usageLimit: 3 });
    expect(bad.status).toBe(400);

    const ok = await request(app).patch(`/api/admin/promos/${promo.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ usageLimit: 5 });
    expect(ok.status).toBe(200);
  });

  test('отрицательная минимальная сумма → 400', async () => {
    const admin = await makeAdmin('pvadmin3@test.uz');
    const res = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'NEG1', discountPercent: 10, minAmount: -100 });
    expect(res.status).toBe(400);
  });

  test('корректный промокод с будущей датой создаётся', async () => {
    const admin = await makeAdmin('pvadmin4@test.uz');
    const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await request(app).post('/api/admin/promos')
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ code: 'FUTURE20', discountPercent: 20, expiresAt: future });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('FUTURE20');
  });
});
