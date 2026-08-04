// Фаза A — модерация юриста админом (verificationStatus).
// Проверяем: непроверенные скрыты из каталога и профиля, бронировать нельзя;
// approve → виден и бронируется; reject с причиной → скрыт + уведомление;
// email-подтверждение (User.isVerified) НЕ влияет на видимость в каталоге.
jest.mock('../src/services/emailService', () => ({
  sendMail: jest.fn().mockResolvedValue({}),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({}),
  sendVerificationEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, tokenFor, makeClient, makeLawyer, makeAdmin } = require('./helpers');

const { User, LawyerProfile, Notification } = models;

beforeAll(async () => {
  await resetDb();
});

describe('каталог показывает только одобренных (GET /lawyers)', () => {
  test('pending и rejected не видны, approved виден', async () => {
    await makeLawyer('vs-approved@test.uz', { verificationStatus: 'approved' });
    await makeLawyer('vs-pending@test.uz', { verificationStatus: 'pending' });
    await makeLawyer('vs-rejected@test.uz', { verificationStatus: 'rejected' });

    const res = await request(app).get('/api/lawyers?limit=50');
    expect(res.status).toBe(200);
    const emails = res.body.lawyers.map((l) => l.profile.verificationStatus);
    // все возвращённые — approved
    expect(emails.every((s) => s === 'approved')).toBe(true);
    expect(res.body.lawyers.length).toBe(1);
  });
});

describe('публичный профиль (GET /lawyers/:id)', () => {
  test('pending-юрист → 404, approved → 200', async () => {
    const { user: pending } = await makeLawyer('vs-p2@test.uz', { verificationStatus: 'pending' });
    const { user: approved } = await makeLawyer('vs-a2@test.uz', { verificationStatus: 'approved' });

    const r1 = await request(app).get(`/api/lawyers/${pending.id}`);
    expect(r1.status).toBe(404);

    const r2 = await request(app).get(`/api/lawyers/${approved.id}`);
    expect(r2.status).toBe(200);
    expect(r2.body.lawyer.id).toBe(approved.id);
  });
});

describe('бронирование гейтится модерацией (POST /lawyers/:id/book)', () => {
  test('нельзя бронировать pending-юриста', async () => {
    const client = await makeClient('vs-client1@test.uz');
    const { user: pending } = await makeLawyer('vs-p3@test.uz', { verificationStatus: 'pending' });

    const res = await request(app)
      .post(`/api/lawyers/${pending.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ type: 'video', duration: 60 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/проверку/i);
  });

  test('можно бронировать approved-юриста', async () => {
    const client = await makeClient('vs-client2@test.uz');
    const { user: approved } = await makeLawyer('vs-a3@test.uz', { verificationStatus: 'approved' });

    const res = await request(app)
      .post(`/api/lawyers/${approved.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ type: 'video', duration: 60, problems: [{ text: 'Мой вопрос', categories: ['Гражданское право'] }] });
    expect([200, 201]).toContain(res.status);
  });
});

describe('админ approve/reject', () => {
  test('approve делает юриста видимым + уведомление', async () => {
    const admin = await makeAdmin('vs-admin1@test.uz');
    const { user: lawyer } = await makeLawyer('vs-p4@test.uz', { verificationStatus: 'pending' });

    const res = await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`);
    expect(res.status).toBe(200);

    const lp = await LawyerProfile.findOne({ where: { userId: lawyer.id } });
    expect(lp.verificationStatus).toBe('approved');
    expect(lp.rejectionReason).toBeNull();

    const notif = await Notification.findOne({ where: { userId: lawyer.id, type: 'verification' } });
    expect(notif).toBeTruthy();

    // теперь в каталоге
    const cat = await request(app).get('/api/lawyers?limit=50');
    expect(cat.body.lawyers.map((l) => l.id)).toContain(lawyer.id);
  });

  test('reject с причиной убирает из каталога + пишет причину + уведомление', async () => {
    const admin = await makeAdmin('vs-admin2@test.uz');
    const { user: lawyer } = await makeLawyer('vs-a4@test.uz', { verificationStatus: 'approved' });

    const res = await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)
      .send({ reason: 'Нет диплома' });
    expect(res.status).toBe(200);

    const lp = await LawyerProfile.findOne({ where: { userId: lawyer.id } });
    expect(lp.verificationStatus).toBe('rejected');
    expect(lp.rejectionReason).toBe('Нет диплома');

    // аккаунт НЕ заблокирован (может подать снова)
    const u = await User.findByPk(lawyer.id);
    expect(u.isActive).toBe(true);

    const notif = await Notification.findOne({ where: { userId: lawyer.id, type: 'verification' } });
    expect(notif).toBeTruthy();

    const cat = await request(app).get('/api/lawyers?limit=50');
    expect(cat.body.lawyers.map((l) => l.id)).not.toContain(lawyer.id);
  });
});

describe('email-подтверждение отделено от одобрения админом', () => {
  test('User.isVerified=true, но profile pending → в каталоге НЕ виден', async () => {
    const { user, lp } = await makeLawyer('vs-email@test.uz', { verificationStatus: 'pending' });
    await user.update({ isVerified: true }); // подтвердил email
    expect(lp.verificationStatus).toBe('pending');

    const cat = await request(app).get('/api/lawyers?limit=50');
    expect(cat.body.lawyers.map((l) => l.id)).not.toContain(user.id);
  });
});
