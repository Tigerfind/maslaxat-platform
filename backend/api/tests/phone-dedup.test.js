// Дедуп по телефону: один номер — один аккаунт (регистрация по email тоже проверяет).
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));
jest.mock('../src/services/smsService', () => ({
  sendSms: jest.fn().mockResolvedValue({ sent: true }),
  isConfigured: () => false,
  normalizePhone: (p) => {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('998')) return '+' + d;
    if (d.length === 9) return '+998' + d;
    return null;
  },
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models } = require('./helpers');

const { User, LawyerProfile } = models;

beforeAll(async () => { await resetDb(); });

const reg = (email, phone) => request(app).post('/api/auth/register').send({
  name: 'Тест', email, password: 'passw0rd', phone, role: 'client',
});

describe('дедуп по телефону при регистрации', () => {
  test('первый номер регистрируется, второй тот же → 409', async () => {
    const r1 = await reg('pd-a@test.uz', '+998901112233');
    expect(r1.status).toBe(201);

    const r2 = await reg('pd-b@test.uz', '998901112233'); // тот же номер, другой формат
    expect(r2.status).toBe(409);
    expect(r2.body.error).toMatch(/телефон/i);
  });

  test('невалидный номер → 400', async () => {
    const r = await reg('pd-c@test.uz', '12345');
    expect(r.status).toBe(400);
  });

  test('без телефона регистрация проходит', async () => {
    const r = await reg('pd-d@test.uz', undefined);
    expect(r.status).toBe(201);
  });
});

describe('усиление регистрации (Фаза 5)', () => {
  test('короткий пароль (<8) → 400', async () => {
    const r = await request(app).post('/api/auth/register').send({
      name: 'Тест', email: 'pd-short@test.uz', password: 'short12', role: 'client',
    });
    expect(r.status).toBe(400);
  });

  test('email регистронезависим: User@x и user@x → второй 409', async () => {
    const r1 = await request(app).post('/api/auth/register').send({
      name: 'Тест', email: 'CaseTest@x.uz', password: 'passw0rd', role: 'client',
    });
    expect(r1.status).toBe(201);
    const r2 = await request(app).post('/api/auth/register').send({
      name: 'Тест', email: 'casetest@x.uz', password: 'passw0rd', role: 'client',
    });
    expect(r2.status).toBe(409);
  });

  test('вход регистронезависим по email', async () => {
    await request(app).post('/api/auth/register').send({
      name: 'Тест', email: 'login-case@x.uz', password: 'passw0rd', role: 'client',
    });
    const login = await request(app).post('/api/auth/login').send({
      email: 'LOGIN-CASE@x.uz', password: 'passw0rd',
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });
});

describe('регистрация юриста с несколькими специализациями', () => {
  test('specializations[] сохраняются, primary = первая', async () => {
    const r = await request(app).post('/api/auth/register').send({
      name: 'Юрист', email: 'pd-lawyer@test.uz', password: 'passw0rd', role: 'lawyer',
      specializations: ['Семейное право', 'Налоговое право', 'Семейное право'],
    });
    expect(r.status).toBe(201);
    const user = await User.findOne({ where: { email: 'pd-lawyer@test.uz' } });
    const lp = await LawyerProfile.findOne({ where: { userId: user.id } });
    expect(lp.specializations).toEqual(['Семейное право', 'Налоговое право']); // дедуп
    expect(lp.specialization).toBe('Семейное право'); // primary
  });
});
