const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient } = require('./helpers');

const { User } = models;

beforeAll(async () => {
  await resetDb();
});

describe('auth-закалка из аудита', () => {
  test('токен, выданный ДО смены пароля, отклоняется (passwordChangedAt)', async () => {
    const user = await makeClient('ah-c1@test.uz');
    const token = tokenFor(user); // iat ≈ сейчас

    // до смены пароля токен рабочий
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    // пароль сменён «в будущем» → старый токен инвалиден
    await User.update({ passwordChangedAt: new Date(Date.now() + 5000) }, { where: { id: user.id } });
    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  test('resend-verification без пользователя не роняет (404, не 500)', async () => {
    // токен валиден, но пользователя нет в БД
    const ghost = await makeClient('ah-ghost@test.uz');
    const token = tokenFor(ghost);
    await User.destroy({ where: { id: ghost.id } });
    const res = await request(app).post('/api/auth/resend-verification').set('Authorization', `Bearer ${token}`);
    expect([401, 404]).toContain(res.status); // 401 (нет юзера в authenticate) или 404 — но не 500
  });
});
