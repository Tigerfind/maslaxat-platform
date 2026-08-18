const request = require('supertest');
const { authenticator } = require('otplib');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeLawyer, makeClient } = require('./helpers');

const { User } = models;

beforeAll(async () => {
  await resetDb();
});

describe('2FA (TOTP)', () => {
  test('setup → enable → login требует код → verify выдаёт токен', async () => {
    const { user: lawyer } = await makeLawyer('twofa1@test.uz');
    const token = tokenFor(lawyer);

    // setup
    const setup = await request(app).post('/api/2fa/setup').set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png/);

    // enable верным кодом
    const code = authenticator.generate(setup.body.secret);
    const enable = await request(app).post('/api/2fa/enable')
      .set('Authorization', `Bearer ${token}`).send({ token: code });
    expect(enable.status).toBe(200);
    expect(enable.body.backupCodes).toHaveLength(8);
    expect(enable.body.token).toBeTruthy();
    const oldSession = await request(app).get('/api/2fa/status').set('Authorization', `Bearer ${token}`);
    const currentSession = await request(app).get('/api/2fa/status').set('Authorization', `Bearer ${enable.body.token}`);
    expect(oldSession.status).toBe(401);
    expect(currentSession.status).toBe(200);

    // логин теперь требует 2FA (пароль из хелпера makeLawyer — 'passw0rd')
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'twofa1@test.uz', password: 'passw0rd' });
    expect(login.status).toBe(200);
    expect(login.body.twoFactorRequired).toBe(true);
    expect(login.body.token).toBeUndefined();
    expect(login.body.tempToken).toBeTruthy();

    // verify верным TOTP → полный токен
    const code2 = authenticator.generate(setup.body.secret);
    const verify = await request(app).post('/api/auth/login/2fa')
      .send({ tempToken: login.body.tempToken, code: code2 });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
    expect(verify.body.role).toBe('lawyer');
  });

  test('verify неверным кодом → 400', async () => {
    const { user: lawyer } = await makeLawyer('twofa2@test.uz');
    const token = tokenFor(lawyer);
    const setup = await request(app).post('/api/2fa/setup').set('Authorization', `Bearer ${token}`);
    await request(app).post('/api/2fa/enable').set('Authorization', `Bearer ${token}`)
      .send({ token: authenticator.generate(setup.body.secret) });

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'twofa2@test.uz', password: 'passw0rd' });
    const bad = await request(app).post('/api/auth/login/2fa')
      .send({ tempToken: login.body.tempToken, code: '000000' });
    expect(bad.status).toBe(400);
  });

  test('резервный код работает один раз', async () => {
    const { user: lawyer } = await makeLawyer('twofa3@test.uz');
    const token = tokenFor(lawyer);
    const setup = await request(app).post('/api/2fa/setup').set('Authorization', `Bearer ${token}`);
    const enable = await request(app).post('/api/2fa/enable').set('Authorization', `Bearer ${token}`)
      .send({ token: authenticator.generate(setup.body.secret) });
    const backup = enable.body.backupCodes[0];

    const l1 = await request(app).post('/api/auth/login').send({ email: 'twofa3@test.uz', password: 'passw0rd' });
    const v1 = await request(app).post('/api/auth/login/2fa').send({ tempToken: l1.body.tempToken, code: backup });
    expect(v1.status).toBe(200);
    expect(v1.body.token).toBeTruthy();

    // повтор того же резервного кода → 400
    const l2 = await request(app).post('/api/auth/login').send({ email: 'twofa3@test.uz', password: 'passw0rd' });
    const v2 = await request(app).post('/api/auth/login/2fa').send({ tempToken: l2.body.tempToken, code: backup });
    expect(v2.status).toBe(400);
  });

  test('challenge-токен (twoFactorRequired) НЕ пускает на защищённые роуты', async () => {
    const { user: lawyer } = await makeLawyer('twofa4@test.uz');
    const token = tokenFor(lawyer);
    const setup = await request(app).post('/api/2fa/setup').set('Authorization', `Bearer ${token}`);
    await request(app).post('/api/2fa/enable').set('Authorization', `Bearer ${token}`)
      .send({ token: authenticator.generate(setup.body.secret) });

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'twofa4@test.uz', password: 'passw0rd' });
    const tempToken = login.body.tempToken;
    expect(tempToken).toBeTruthy();

    // С challenge-токеном нельзя ходить по защищённым роутам (иначе обход 2FA)
    const res = await request(app).get('/api/2fa/status').set('Authorization', `Bearer ${tempToken}`);
    expect(res.status).toBe(401);
  });

  test('клиенту 2FA setup запрещён → 403', async () => {
    const client = await makeClient('twofaclient@test.uz');
    const token = tokenFor(client);
    const res = await request(app).post('/api/2fa/setup').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
