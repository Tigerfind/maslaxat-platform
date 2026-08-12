const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeLawyer, makeAdmin, makeClient } = require('./helpers');

beforeAll(async () => {
  await resetDb();
});

// Заявка на вывод: юрист подаёт через POST /payments/withdraw (баланс списывается
// сразу), админ обрабатывает. До Фазы 3 обработать было нечем — деньги зависали.
async function requestWithdrawal(lawyerUser, amount) {
  const res = await request(app).post('/api/payments/withdraw')
    .set('Authorization', `Bearer ${tokenFor(lawyerUser)}`)
    .send({ amount });
  expect(res.status).toBe(200);
  return res.body.withdrawalId;
}

describe('admin: обработка заявок на вывод', () => {
  test('очередь показывает заявку и сумму к переводу', async () => {
    const admin = await makeAdmin('wadmin1@test.uz');
    const { user: lawyer } = await makeLawyer('wlawyer1@test.uz', { balance: 500000 });

    const id = await requestWithdrawal(lawyer, 200000);

    const list = await request(app).get('/api/admin/withdrawals')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(list.status).toBe(200);
    expect(list.body.withdrawals.some((w) => w.id === id)).toBe(true);
    expect(list.body.counts.pending).toBeGreaterThanOrEqual(1);
    // Ключевая цифра: сколько админ должен фактически перевести
    expect(list.body.counts.pendingAmount).toBeGreaterThanOrEqual(200000);
    // Юрист приложен к заявке — иначе непонятно, кому платить
    const row = list.body.withdrawals.find((w) => w.id === id);
    expect(row.lawyer.email).toBe('wlawyer1@test.uz');
  });

  test('«выплачено» не трогает баланс (он уже списан при подаче)', async () => {
    const admin = await makeAdmin('wadmin2@test.uz');
    const { user: lawyer, lp } = await makeLawyer('wlawyer2@test.uz', { balance: 300000 });

    const id = await requestWithdrawal(lawyer, 100000);
    await lp.reload();
    expect(Number(lp.balance)).toBe(200000); // списано при подаче

    const res = await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(false);

    await lp.reload();
    expect(Number(lp.balance)).toBe(200000); // без изменений
  });

  test('отказ возвращает деньги на баланс юриста', async () => {
    const admin = await makeAdmin('wadmin3@test.uz');
    const { user: lawyer, lp } = await makeLawyer('wlawyer3@test.uz', { balance: 300000 });

    const id = await requestWithdrawal(lawyer, 120000);
    await lp.reload();
    expect(Number(lp.balance)).toBe(180000);

    const res = await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ status: 'cancelled', note: 'Неверные реквизиты' });
    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(true);

    await lp.reload();
    expect(Number(lp.balance)).toBe(300000); // деньги вернулись полностью
  });

  test('повторная обработка → 409, деньги НЕ возвращаются дважды', async () => {
    const admin = await makeAdmin('wadmin4@test.uz');
    const { user: lawyer, lp } = await makeLawyer('wlawyer4@test.uz', { balance: 400000 });

    const id = await requestWithdrawal(lawyer, 150000);
    const token = tokenFor(admin);

    const first = await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' });
    expect(first.status).toBe(200);

    const second = await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' });
    expect(second.status).toBe(409);

    await lp.reload();
    expect(Number(lp.balance)).toBe(400000); // ровно один возврат, не два
  });

  test('гонка двух админов: возврат ровно один раз', async () => {
    const admin = await makeAdmin('wadmin5@test.uz');
    const { user: lawyer, lp } = await makeLawyer('wlawyer5@test.uz', { balance: 500000 });

    const id = await requestWithdrawal(lawyer, 200000);
    const token = tokenFor(admin);

    const [a, b] = await Promise.all([
      request(app).patch(`/api/admin/withdrawals/${id}`).set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' }),
      request(app).patch(`/api/admin/withdrawals/${id}`).set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' }),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);

    await lp.reload();
    expect(Number(lp.balance)).toBe(500000);
  });

  test('юрист получает уведомление об исходе', async () => {
    const admin = await makeAdmin('wadmin6@test.uz');
    const { user: lawyer } = await makeLawyer('wlawyer6@test.uz', { balance: 200000 });

    const id = await requestWithdrawal(lawyer, 50000);
    await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'paid' });

    const notes = await models.Notification.findAll({ where: { userId: lawyer.id, type: 'withdrawal' } });
    expect(notes.length).toBe(1);
    expect(notes[0].metadata.withdrawalId).toBe(id);
  });

  test('недопустимый статус → 400; клиент не имеет доступа → 403', async () => {
    const admin = await makeAdmin('wadmin7@test.uz');
    const client = await makeClient('wclient7@test.uz');
    const { user: lawyer } = await makeLawyer('wlawyer7@test.uz', { balance: 100000 });
    const id = await requestWithdrawal(lawyer, 10000);

    const bad = await request(app).patch(`/api/admin/withdrawals/${id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`).send({ status: 'pending' });
    expect(bad.status).toBe(400);

    const forbidden = await request(app).get('/api/admin/withdrawals')
      .set('Authorization', `Bearer ${tokenFor(client)}`);
    expect(forbidden.status).toBe(403);
  });
});

describe('admin: журнал платежей', () => {
  test('список платежей с итогом по оплаченным', async () => {
    const admin = await makeAdmin('padmin1@test.uz');
    const client = await makeClient('pclient1@test.uz');

    await models.Payment.create({ userId: client.id, amount: 250000, status: 'paid', provider: 'payme' });
    await models.Payment.create({ userId: client.id, amount: 90000, status: 'pending', provider: 'payme' });

    const res = await request(app).get('/api/admin/payments')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body.counts.paidAmount).toBeGreaterThanOrEqual(250000);
    expect(res.body.payments[0].user).toBeTruthy();

    const onlyPaid = await request(app).get('/api/admin/payments?status=paid')
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(onlyPaid.body.payments.every((p) => p.status === 'paid')).toBe(true);
  });
});
