const { resetDb, models } = require('./helpers');
const { completeConsultation } = require('../src/services/escrow');

const { User, LawyerProfile, Consultation, Payment } = models;

beforeAll(async () => {
  await resetDb();
});

async function seedPaidConsultation({ price = 500000, pending = 500000 } = {}) {
  const client = await User.create({ name: 'C', email: `c${Date.now()}${Math.floor(price)}@t.uz`, password: 'p', role: 'client', isActive: true });
  const lawyer = await User.create({ name: 'L', email: `l${Date.now()}${Math.floor(price)}@t.uz`, password: 'p', role: 'lawyer', isActive: true });
  const lp = await LawyerProfile.create({ userId: lawyer.id, balance: 0, pendingBalance: pending, price, specialization: 'Гражданское право' });
  const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'in_progress', price });
  await Payment.create({ userId: client.id, consultationId: cons.id, amount: price, currency: 'UZS', provider: 'payme', status: 'paid' });
  return { client, lawyer, lp, cons };
}

describe('escrow.completeConsultation', () => {
  test('высвобождает эскроу юристу ровно один раз (pendingBalance → balance)', async () => {
    const { lp, cons } = await seedPaidConsultation({ price: 500000, pending: 500000 });

    const r1 = await completeConsultation(cons.id);
    expect(r1.released).toBe(true);
    expect(r1.alreadyCompleted).toBe(false);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.balance)).toBe(500000);
    expect(Number(after.pendingBalance)).toBe(0);
    expect(after.completedCases).toBe(1);
  });

  test('идемпотентность: повторное завершение НЕ платит второй раз', async () => {
    const { lp, cons } = await seedPaidConsultation({ price: 300000, pending: 300000 });

    await completeConsultation(cons.id);
    const r2 = await completeConsultation(cons.id);

    expect(r2.alreadyCompleted).toBe(true);
    expect(r2.released).toBe(false);

    const after = await LawyerProfile.findByPk(lp.id);
    expect(Number(after.balance)).toBe(300000); // не задвоилось
    expect(Number(after.pendingBalance)).toBe(0);
    expect(after.completedCases).toBe(1); // и completedCases не задвоился
  });

  test('статус консультации становится completed', async () => {
    const { cons } = await seedPaidConsultation({ price: 100000, pending: 100000 });
    const res = await completeConsultation(cons.id, 'заметка');
    expect(res.consultation.status).toBe('completed');
    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('completed');
    expect(reloaded.notes).toBe('заметка');
  });

  test('без оплаты эскроу не высвобождается, но консультация завершается', async () => {
    const client = await User.create({ name: 'C', email: `cf${Date.now()}@t.uz`, password: 'p', role: 'client', isActive: true });
    const lawyer = await User.create({ name: 'L', email: `lf${Date.now()}@t.uz`, password: 'p', role: 'lawyer', isActive: true });
    await LawyerProfile.create({ userId: lawyer.id, balance: 0, pendingBalance: 0, price: 100000, specialization: 'Гражданское право' });
    const cons = await Consultation.create({ clientId: client.id, lawyerId: lawyer.id, question: 'q', status: 'in_progress', price: 100000 });

    const res = await completeConsultation(cons.id);
    expect(res.released).toBe(false);
    expect(res.alreadyCompleted).toBe(false);
    const reloaded = await Consultation.findByPk(cons.id);
    expect(reloaded.status).toBe('completed');
  });
});
