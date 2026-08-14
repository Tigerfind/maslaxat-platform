// Тесты на недавние фичи: фильтр цены каталога, категория права в брони,
// привязка настоящего email к аккаунту. Email мокаем — иначе sendVerificationEmail
// лезет в сеть (Ethereal) и делает тесты флейки.
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer } = require('./helpers');

const { Consultation, User } = models;

beforeAll(async () => {
  await resetDb();
});

describe('фильтр цены каталога (GET /lawyers)', () => {
  test('minPrice/maxPrice фильтруют по profile.price', async () => {
    await makeLawyer('pf-a@test.uz', { price: 100000 });
    await makeLawyer('pf-b@test.uz', { price: 300000 });
    await makeLawyer('pf-c@test.uz', { price: 500000 });

    const cheap = await request(app).get('/api/lawyers?maxPrice=200000&limit=50');
    expect(cheap.status).toBe(200);
    const cheapPrices = cheap.body.lawyers.map((l) => l.profile.price);
    expect(cheapPrices).toContain(100000);
    expect(cheapPrices).not.toContain(300000);
    expect(cheapPrices).not.toContain(500000);

    const pricey = await request(app).get('/api/lawyers?minPrice=400000&limit=50');
    const priceyPrices = pricey.body.lawyers.map((l) => l.profile.price);
    expect(priceyPrices).toContain(500000);
    expect(priceyPrices).not.toContain(100000);
    expect(priceyPrices).not.toContain(300000);

    const mid = await request(app).get('/api/lawyers?minPrice=150000&maxPrice=400000&limit=50');
    const midPrices = mid.body.lawyers.map((l) => l.profile.price);
    expect(midPrices).toContain(300000);
    expect(midPrices).not.toContain(100000);
    expect(midPrices).not.toContain(500000);
  });

  test('без границ — возвращаются все', async () => {
    const all = await request(app).get('/api/lawyers?limit=50');
    expect(all.body.lawyers.length).toBeGreaterThanOrEqual(3);
  });
});

describe('несколько категорий права на проблему в брони', () => {
  test('каждая проблема хранит {text, categories[]}; question = текст первой; specialization = 1-я категория первой', async () => {
    const client = await makeClient('sp-c@test.uz');
    const { user: lawyer } = await makeLawyer('sp-l@test.uz');
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({
        acceptedTerms: true, legalVersion: '2026-08-13',
        problems: [
          { text: 'Развод', categories: ['family', 'civil'] },
          { text: 'Налоги бизнеса', categories: ['tax', 'corporate'] },
        ],
        consultationType: 'video', duration: 60,
      });
    expect(res.status).toBe(201);
    expect(res.body.consultation.specialization).toBe('family'); // 1-я категория первой проблемы
    expect(res.body.consultation.question).toBe('Развод');

    const c = await Consultation.findByPk(res.body.consultation.id);
    expect(c.specialization).toBe('family');
    expect(c.problems).toEqual([
      { text: 'Развод', categories: ['family', 'civil'] },
      { text: 'Налоги бизнеса', categories: ['tax', 'corporate'] },
    ]);
  });

  test('дубли категорий схлопываются', async () => {
    const client = await makeClient('sp-cd@test.uz');
    const { user: lawyer } = await makeLawyer('sp-ld@test.uz');
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ problems: [{ text: 'Вопрос', categories: ['civil', 'civil', 'family'] }], consultationType: 'video', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(res.status).toBe(201);
    const c = await Consultation.findByPk(res.body.consultation.id);
    expect(c.problems).toEqual([{ text: 'Вопрос', categories: ['civil', 'family'] }]);
  });

  test('проблема без категорий → categories [], specialization null', async () => {
    const client = await makeClient('sp-c2@test.uz');
    const { user: lawyer } = await makeLawyer('sp-l2@test.uz');
    const res = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ problems: [{ text: 'Вопрос', categories: [] }], consultationType: 'video', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(res.status).toBe(201);
    expect(res.body.consultation.specialization == null).toBe(true);
    const c = await Consultation.findByPk(res.body.consultation.id);
    expect(c.problems).toEqual([{ text: 'Вопрос', categories: [] }]);
  });

  test('legacy: строковые проблемы и старый одиночный category ещё принимаются', async () => {
    const client = await makeClient('sp-c3@test.uz');
    const { user: lawyer } = await makeLawyer('sp-l3@test.uz');
    // строка
    const r1 = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ question: 'Просто вопрос', consultationType: 'video', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(r1.status).toBe(201);
    const c1 = await Consultation.findByPk(r1.body.consultation.id);
    expect(c1.problems).toEqual([{ text: 'Просто вопрос', categories: [] }]);

    // старый одиночный { text, category }
    const client2 = await makeClient('sp-c4@test.uz');
    const r2 = await request(app).post(`/api/client/lawyers/${lawyer.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client2)}`)
      .send({ problems: [{ text: 'Аренда', category: 'real-estate' }], consultationType: 'video', acceptedTerms: true, legalVersion: '2026-08-13' });
    expect(r2.status).toBe(201);
    const c2 = await Consultation.findByPk(r2.body.consultation.id);
    expect(c2.problems).toEqual([{ text: 'Аренда', categories: ['real-estate'] }]);
    expect(c2.specialization).toBe('real-estate');
  });
});

describe('привязка настоящего email (PUT /client/users/email)', () => {
  test('валидный email → обновляется (нормализован), isVerified=false, токен выдан', async () => {
    const client = await makeClient('998900000001@phone.maslaxat.uz');
    await client.update({ isVerified: true }); // как телефон-аккаунт
    const res = await request(app).put('/api/client/users/email')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ email: 'Real.User@Gmail.com' });
    expect(res.status).toBe(200);

    const after = await User.findByPk(client.id);
    expect(after.email).toBe('real.user@gmail.com'); // trim + lowercase
    expect(after.isVerified).toBe(false);            // требует подтверждения
    expect(after.verificationToken).toBeTruthy();
  });

  test('неверный формат → 400', async () => {
    const client = await makeClient('em-c2@test.uz');
    const res = await request(app).put('/api/client/users/email')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('email занят другим → 409', async () => {
    await makeClient('taken@test.uz');
    const b = await makeClient('em-c3@test.uz');
    const res = await request(app).put('/api/client/users/email')
      .set('Authorization', `Bearer ${tokenFor(b)}`)
      .send({ email: 'taken@test.uz' });
    expect(res.status).toBe(409);
  });

  test('тот же email → 200 и verified НЕ сбрасывается', async () => {
    const client = await makeClient('same@test.uz');
    await client.update({ isVerified: true });
    const res = await request(app).put('/api/client/users/email')
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ email: 'same@test.uz' });
    expect(res.status).toBe(200);
    const after = await User.findByPk(client.id);
    expect(after.isVerified).toBe(true);
  });
});
