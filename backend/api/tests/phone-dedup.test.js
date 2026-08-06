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
const { resetDb } = require('./helpers');

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
