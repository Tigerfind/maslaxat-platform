const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeAdmin, makeLawyer, tokenFor } = require('./helpers');
const { countWeeklySlots, scheduleMeetsMinimum } = require('../src/services/schedulePolicy');

beforeEach(resetDb);

async function makeReviewableLawyer(email, schedule) {
  const { user, lp } = await makeLawyer(email, { verificationStatus: 'draft', isAvailable: false, schedule });
  await user.update({ avatar: '/uploads/schedule-test.png', twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  await models.LawyerDocument.create({ userId: user.id, type: 'license', name: 'license.pdf', path: '/private/license.pdf' });
  return { user, lp };
}

test('считает только реальные 30-минутные слоты', () => {
  expect(countWeeklySlots({ mon: { enabled: true, from: '09:00', to: '09:29' } })).toBe(0);
  expect(countWeeklySlots({ mon: { enabled: true, from: '09:00', to: '10:00' } })).toBe(2);
  expect(countWeeklySlots({ mon: { enabled: true, from: '09:00', to: '10:30' } })).toBe(3);
  expect(countWeeklySlots({ mon: { enabled: true, from: '18:00', to: '09:00' } })).toBe(0);
  expect(scheduleMeetsMinimum({ mon: { enabled: true, from: '09:00', to: '10:30' } })).toBe(true);
});

test('submit отклоняет профиль с двумя слотами и возвращает точный прогресс', async () => {
  const { user } = await makeReviewableLawyer('schedule-two@test.uz', {
    mon: { enabled: true, from: '09:00', to: '10:00' },
  });
  const response = await request(app).post('/api/lawyer/verification/submit')
    .set('Authorization', `Bearer ${tokenFor(user)}`).set('X-Maslaxat-Mode', 'lawyer');
  expect(response.status).toBe(400);
  expect(response.body.missing).toContain('schedule');

  const checklist = await request(app).get('/api/lawyer/verification/checklist')
    .set('Authorization', `Bearer ${tokenFor(user)}`).set('X-Maslaxat-Mode', 'lawyer');
  expect(checklist.body).toMatchObject({ scheduleSlots: 2, requiredScheduleSlots: 3 });
});

test('ровно три слота проходят submit и повторную проверку админом', async () => {
  const { user } = await makeReviewableLawyer('schedule-three@test.uz', {
    mon: { enabled: true, from: '09:00', to: '10:30' },
  });
  const submit = await request(app).post('/api/lawyer/verification/submit')
    .set('Authorization', `Bearer ${tokenFor(user)}`).set('X-Maslaxat-Mode', 'lawyer');
  expect(submit.status).toBe(200);

  const admin = await makeAdmin('schedule-admin@test.uz');
  await admin.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  const approve = await request(app).post(`/api/admin/lawyers/${user.id}/approve`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`).set('X-Maslaxat-Mode', 'admin');
  expect(approve.status).toBe(200);
});

test('существующий approved без расписания остаётся публичным, но получает предупреждение', async () => {
  const { user } = await makeLawyer('schedule-grandfathered@test.uz', {
    verificationStatus: 'approved', isAvailable: true, schedule: {},
  });
  await user.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  expect((await request(app).get(`/api/lawyers/${user.id}`)).status).toBe(200);

  const dashboard = await request(app).get('/api/dashboard/lawyer/stats')
    .set('Authorization', `Bearer ${tokenFor(user, 'mfa')}`).set('X-Maslaxat-Mode', 'lawyer');
  expect(dashboard.body).toMatchObject({ scheduleComplete: false, scheduleSlots: 0, requiredScheduleSlots: 3 });
});

test('новый approved не может очистить расписание, grandfathered профиль может заполнить его постепенно', async () => {
  const { user: governed } = await makeLawyer('schedule-governed@test.uz', {
    schedulePolicyAcceptedAt: new Date(),
  });
  await governed.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  const governedResponse = await request(app).put('/api/lawyer/availability')
    .set('Authorization', `Bearer ${tokenFor(governed, 'mfa')}`).set('X-Maslaxat-Mode', 'lawyer')
    .send({ schedule: { mon: { enabled: true, from: '09:00', to: '10:00' } } });
  expect(governedResponse.status).toBe(400);
  expect(governedResponse.body.code).toBe('SCHEDULE_MINIMUM_REQUIRED');

  const { user: grandfathered, lp } = await makeLawyer('schedule-legacy@test.uz', {
    schedulePolicyAcceptedAt: null, schedule: {}, verificationStatus: 'approved',
  });
  await grandfathered.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
  const legacyResponse = await request(app).put('/api/lawyer/availability')
    .set('Authorization', `Bearer ${tokenFor(grandfathered, 'mfa')}`).set('X-Maslaxat-Mode', 'lawyer')
    .send({ schedule: { mon: { enabled: true, from: '09:00', to: '10:00' } } });
  expect(legacyResponse.status).toBe(200);
  await lp.reload();
  expect(lp.verificationStatus).toBe('approved');
});
