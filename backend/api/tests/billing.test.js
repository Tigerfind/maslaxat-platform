// Модель B — «оплата через 5 минут звонка»: холд при брони → захват на 5-й минуте.
// Проверяем: бронь = held без предоплаты; captureHold идемпотентен; захват создаёт
// оплаченный Payment + резерв эскроу; завершение отдаёт деньги (released);
// бесплатная не списывается; джоб берёт только «дозревшие».
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');
const billing = require('../src/services/billingService');
const { completeConsultation } = require('../src/services/escrow');

const { Consultation, Payment, LawyerProfile } = models;

beforeAll(async () => { await resetDb(); });

async function book(client, lawyer) {
  return request(app)
    .post(`/api/lawyers/${lawyer.id}/book`)
    .set('Authorization', `Bearer ${tokenFor(client)}`)
    .send({ type: 'video', duration: 60, problems: [{ text: 'Вопрос', categories: ['civil'] }], acceptedTerms: true, legalVersion: '2026-08-13' });
}

describe('бронь = холд без предоплаты', () => {
  test('платная бронь → pending + billingStatus=held, без Payment', async () => {
    const client = await makeClient('bl-c1@test.uz');
    const { user: lawyer } = await makeLawyer('bl-l1@test.uz', { price: 200000 });
    const res = await book(client, lawyer);
    expect(res.status).toBe(201);
    expect(res.body.consultation.status).toBe('pending');
    expect(res.body.consultation.billingStatus).toBe('held');

    const pay = await Payment.findOne({ where: { consultationId: res.body.consultation.id } });
    expect(pay).toBeNull(); // деньги ещё не тронуты
  });
});

describe('captureHold — захват на 5-й минуте', () => {
  test('создаёт оплаченный Payment + резерв эскроу, помечает charged', async () => {
    const client = await makeClient('bl-c2@test.uz');
    const { user: lawyer, lp } = await makeLawyer('bl-l2@test.uz', { price: 300000 });
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Q', price: 300000, billingStatus: 'held', callStartedAt: new Date(Date.now() - 6 * 60 * 1000),
    });

    const r = await billing.captureHold(c.id);
    expect(r.captured).toBe(true);

    await c.reload();
    expect(c.billingStatus).toBe('charged');
    expect(c.chargedAt).toBeTruthy();

    const pay = await Payment.findOne({ where: { consultationId: c.id, status: 'paid' } });
    expect(pay).toBeTruthy();
    expect(Number(pay.amount)).toBe(300000);

    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(300000); // эскроу зарезервирован
  });

  test('идемпотентность — повторный захват не двоит деньги', async () => {
    const client = await makeClient('bl-c3@test.uz');
    const { user: lawyer, lp } = await makeLawyer('bl-l3@test.uz', { price: 150000 });
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Q', price: 150000, billingStatus: 'held', callStartedAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    await billing.captureHold(c.id);
    const second = await billing.captureHold(c.id);
    expect(second.captured).toBe(false); // already

    const pays = await Payment.findAll({ where: { consultationId: c.id, status: 'paid' } });
    expect(pays.length).toBe(1); // ровно один платёж
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(150000);
  });

  test('параллельный захват создаёт один Payment и один резерв', async () => {
    const client = await makeClient('bl-race-client@test.uz');
    const { user: lawyer, lp } = await makeLawyer('bl-race-lawyer@test.uz', { price: 175000 });
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Race', price: 175000, billingStatus: 'held', callStartedAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const results = await Promise.all([billing.captureHold(c.id), billing.captureHold(c.id)]);
    expect(results.filter((result) => result.reason === 'captured')).toHaveLength(1);
    expect(await Payment.count({ where: { consultationId: c.id, status: 'paid' } })).toBe(1);
    await lp.reload();
    expect(Number(lp.pendingBalance)).toBe(175000);
  });

  test('бесплатная консультация не списывается', async () => {
    const client = await makeClient('bl-c4@test.uz');
    const { user: lawyer } = await makeLawyer('bl-l4@test.uz', { price: 200000 });
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Q', price: 0, isFree: true, billingStatus: 'none', callStartedAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    const r = await billing.captureHold(c.id);
    expect(r.captured).toBe(false);
    const pay = await Payment.findOne({ where: { consultationId: c.id } });
    expect(pay).toBeNull();
  });
});

describe('захват → завершение отдаёт эскроу юристу', () => {
  test('после captureHold + completeConsultation деньги в balance, billingStatus=released', async () => {
    const client = await makeClient('bl-c5@test.uz');
    const { user: lawyer, lp } = await makeLawyer('bl-l5@test.uz', { price: 250000 });
    const c = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Q', price: 250000, billingStatus: 'held', callStartedAt: new Date(Date.now() - 6 * 60 * 1000),
    });
    await billing.captureHold(c.id);
    await completeConsultation(c.id, undefined, 400);

    await c.reload(); await lp.reload();
    expect(c.status).toBe('completed');
    expect(c.billingStatus).toBe('released');
    expect(Number(lp.balance)).toBe(250000);
    expect(Number(lp.pendingBalance)).toBe(0);
  });
});

describe('джоб берёт только дозревшие (≥5 мин)', () => {
  test('свежий звонок (2 мин) не захватывается', async () => {
    const client = await makeClient('bl-c6@test.uz');
    const { user: lawyer } = await makeLawyer('bl-l6@test.uz', { price: 100000 });
    const fresh = await Consultation.create({
      clientId: client.id, lawyerId: lawyer.id, type: 'video', status: 'in_progress',
      question: 'Q', price: 100000, billingStatus: 'held', callStartedAt: new Date(Date.now() - 2 * 60 * 1000),
    });
    await billing.checkCaptureDue();
    await fresh.reload();
    expect(fresh.billingStatus).toBe('held'); // ещё не 5 минут
    const pay = await Payment.findOne({ where: { consultationId: fresh.id } });
    expect(pay).toBeNull();
  });
});
