const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');
const { completeConsultation } = require('../src/services/escrow');

const { Consultation, Payment, LawyerProfile } = models;

beforeAll(async () => {
  await resetDb();
});

// Хелпер: клиент + юрист + оплаченная консультация (эскроу в pendingBalance юриста)
async function seedPaid({ status = 'accepted', price = 200000 } = {}) {
  const client = await makeClient(`ec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@t.uz`);
  const { user: lawyer, lp } = await makeLawyer(
    `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@t.uz`,
    { pendingBalance: price, balance: 0, price }
  );
  const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status, price });
  const pay = await Payment.create({
    userId: client.id, consultationId: cons.id, amount: price,
    currency: 'UZS', provider: 'payme', status: 'paid',
  });
  return { client, lawyer, lp, cons, pay, price };
}

describe('escrow released AT MOST ONCE (tied to payment, not status)', () => {
  test('pay → start → end: releases exactly once and marks payment released', async () => {
    const { lp, cons, pay, price } = await seedPaid({ status: 'in_progress' });

    const r = await completeConsultation(cons.id);
    expect(r.released).toBe(true);

    const lawyer = await LawyerProfile.findByPk(lp.id);
    expect(Number(lawyer.balance)).toBe(price);
    expect(Number(lawyer.pendingBalance)).toBe(0);

    const paid = await Payment.findByPk(pay.id);
    expect(paid.escrowReleased).toBe(true);
    expect(paid.status).toBe('paid'); // остаётся paid (учёт выручки не ломаем), но released
  });

  test('revert to in_progress → second end does NOT release again (no double-pay)', async () => {
    const { lp, cons, pay, price } = await seedPaid({ status: 'in_progress' });

    // Первое завершение — выплата
    await completeConsultation(cons.id);

    // Симулируем откат статуса (как если бы какой-то путь вернул назад),
    // затем повторное завершение — деньги НЕ должны выплатиться второй раз,
    // потому что платёж уже escrowReleased=true (гейт на платеже, не на статусе).
    await Consultation.update({ status: 'in_progress' }, { where: { id: cons.id } });
    const r2 = await completeConsultation(cons.id);

    expect(r2.released).toBe(false);
    const lawyer = await LawyerProfile.findByPk(lp.id);
    expect(Number(lawyer.balance)).toBe(price);       // НЕ 2×price
    expect(Number(lawyer.pendingBalance)).toBe(0);    // не ушло в минус
    const paid = await Payment.findByPk(pay.id);
    expect(paid.escrowReleased).toBe(true);
  });
});

describe('reject-after-pay refunds the client (from pendingBalance)', () => {
  test('lawyer rejects a paid pending consultation → payment refunded, pendingBalance restored', async () => {
    const { lawyer, lp, cons, pay, price } = await seedPaid({ status: 'pending' });
    const token = tokenFor(lawyer);

    const res = await request(app)
      .post(`/api/lawyer/consultation-requests/${cons.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'занят' });
    expect(res.status).toBe(200);

    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('rejected');

    const paid = await Payment.findByPk(pay.id);
    expect(paid.status).toBe('refunded');

    const lawyerProfile = await LawyerProfile.findByPk(lp.id);
    expect(Number(lawyerProfile.pendingBalance)).toBe(0); // возвращено, не отрицательное
    expect(Number(lawyerProfile.balance)).toBe(0);        // ничего не выплачивалось
  });

  test('cannot reject an already-completed (paid-out) consultation', async () => {
    const { lawyer, lp, cons } = await seedPaid({ status: 'in_progress' });
    await completeConsultation(cons.id); // деньги уже в balance
    const token = tokenFor(lawyer);

    const res = await request(app)
      .post(`/api/lawyer/consultations/${cons.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'поздно' });
    expect(res.status).toBe(400);

    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('completed'); // статус не откатился
    const lawyerProfile = await LawyerProfile.findByPk(lp.id);
    expect(Number(lawyerProfile.pendingBalance)).toBe(0); // не ушло в минус
  });
});

describe('status machine: lawyer cannot revert out of completed', () => {
  test('PATCH /:id/status completed → in_progress as lawyer is rejected', async () => {
    const { lawyer, cons } = await seedPaid({ status: 'in_progress' });
    await completeConsultation(cons.id);
    const token = tokenFor(lawyer);

    const res = await request(app)
      .patch(`/api/consultations/${cons.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' });
    expect(res.status).toBe(400);

    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('completed');
  });

  test('lawyer-portal start from completed is rejected', async () => {
    const { lawyer, cons } = await seedPaid({ status: 'in_progress' });
    await completeConsultation(cons.id);
    const token = tokenFor(lawyer);

    const res = await request(app)
      .post(`/api/lawyer/consultations/${cons.id}/start`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);

    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('completed');
  });

  test('even if status is forced back, re-completing does not pay twice', async () => {
    const { lp, cons, price } = await seedPaid({ status: 'in_progress' });
    await completeConsultation(cons.id);
    // грубый форс (админ/БД) в обход гейтов — деньги всё равно не задваиваются
    await Consultation.update({ status: 'in_progress' }, { where: { id: cons.id } });
    await completeConsultation(cons.id);
    const lawyer = await LawyerProfile.findByPk(lp.id);
    expect(Number(lawyer.balance)).toBe(price); // ровно один раз
  });
});
