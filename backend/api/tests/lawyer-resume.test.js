const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeLawyer, makeAdmin, tokenFor } = require('./helpers');

beforeEach(resetDb);

const resumePayload = {
  step: 5,
  professionalTitle: 'Адвокат по семейному праву',
  description: 'Опытный адвокат с многолетней практикой по семейным и гражданским делам в судах Узбекистана.',
  location: 'Ташкент', region: 'Ташкент', languages: ['ru', 'uz'],
  linkedinUrl: 'https://www.linkedin.com/in/test-lawyer/',
  licenseNumber: 'LIC-2026', licenseIssuer: 'Палата адвокатов', licenseIssuedAt: '2020-01-01',
  experience: 8, price: 250000, specializations: ['Семейное право'],
  timezone: 'Asia/Tashkent', consultationFormats: ['chat', 'webrtc'], consultationDurations: [30, 60],
  schedule: { mon: { enabled: true, from: '09:00', to: '18:00' } },
  experiences: [{ organization: 'Legal Group', position: 'Адвокат', startDate: '2020-01-01', isCurrent: true, description: 'Судебная практика' }],
  educations: [{ university: 'ТГЮУ', specialty: 'Юриспруденция', degree: 'Магистр', startYear: 2014, endYear: 2020, country: 'Узбекистан', city: 'Ташкент' }],
  certificates: [{ title: 'Медиация', organization: 'Центр медиации', issuedAt: '2024-01-01', credentialUrl: 'https://example.test/cert' }],
};

test('draft сохраняет структурированное резюме и owner preview после refresh', async () => {
  const { user } = await makeLawyer('resume-draft@test.uz');
  const token = tokenFor(user);
  const save = await request(app).patch('/api/lawyer/profile/draft').set('Authorization', `Bearer ${token}`).send(resumePayload);
  expect(save.status).toBe(200);
  expect(save.body.profile.verificationStatus).toBe('draft');
  expect(await models.LawyerExperience.count({ where: { userId: user.id } })).toBe(1);
  expect(await models.LawyerEducation.count({ where: { userId: user.id } })).toBe(1);
  expect(await models.LawyerCertificate.count({ where: { userId: user.id } })).toBe(1);

  const preview = await request(app).get('/api/lawyer/profile/preview').set('Authorization', `Bearer ${token}`);
  expect(preview.status).toBe(200);
  expect(preview.body.lawyer.lawyerExperiences[0].organization).toBe('Legal Group');
  expect((await request(app).get(`/api/lawyers/${user.id}`)).status).toBe(404);
});

test('submit → approve публикует резюме и пишет status history', async () => {
  const { user } = await makeLawyer('resume-approve@test.uz');
  await user.update({ avatar: '/uploads/avatar-test.png' });
  const token = tokenFor(user);
  await request(app).patch('/api/lawyer/profile/draft').set('Authorization', `Bearer ${token}`).send(resumePayload);
  await models.LawyerDocument.create({ userId: user.id, type: 'license', name: 'license.pdf', path: '/private/license.pdf' });
  const submit = await request(app).post('/api/lawyer/verification/submit').set('Authorization', `Bearer ${token}`);
  expect(submit.status).toBe(200);
  expect(submit.body.verificationStatus).toBe('pending_review');
  expect((await request(app).post('/api/lawyer/verification/submit').set('Authorization', `Bearer ${token}`)).status).toBe(409);

  const admin = await makeAdmin('resume-admin@test.uz');
  const approve = await request(app).post(`/api/admin/lawyers/${user.id}/approve`).set('Authorization', `Bearer ${tokenFor(admin)}`);
  expect(approve.status).toBe(200);
  const publicProfile = await request(app).get(`/api/lawyers/${user.id}`);
  expect(publicProfile.status).toBe(200);
  expect(publicProfile.body.lawyer.lawyerExperiences[0].position).toBe('Адвокат');
  expect(publicProfile.body.lawyer.email).toBeUndefined();
  expect(publicProfile.body.lawyer.profile.rejectionReason).toBeUndefined();
  expect(await models.LawyerProfileStatusHistory.count({ where: { lawyerProfileId: approve.body.user.profile.id } })).toBeGreaterThanOrEqual(2);
});

test('reject требует причину и сохраняет историю для повторной отправки', async () => {
  const { user, lp } = await makeLawyer('resume-reject@test.uz', { verificationStatus: 'pending_review' });
  const admin = await makeAdmin('resume-reject-admin@test.uz');
  const auth = `Bearer ${tokenFor(admin)}`;
  expect((await request(app).post(`/api/admin/lawyers/${user.id}/reject`).set('Authorization', auth).send({})).status).toBe(400);
  const rejected = await request(app).post(`/api/admin/lawyers/${user.id}/reject`).set('Authorization', auth).send({ reason: 'Обновите лицензию' });
  expect(rejected.status).toBe(200);
  await lp.reload();
  expect(lp.verificationStatus).toBe('rejected');
  expect(lp.rejectionReason).toBe('Обновите лицензию');
  const history = await models.LawyerProfileStatusHistory.findOne({ where: { lawyerProfileId: lp.id, toStatus: 'rejected' } });
  expect(history.reason).toBe('Обновите лицензию');
});

test('валидация отклоняет невозможные даты и hostile LinkedIn URL', async () => {
  const { user } = await makeLawyer('resume-validation@test.uz');
  const token = tokenFor(user);
  const bad = await request(app).patch('/api/lawyer/profile/draft').set('Authorization', `Bearer ${token}`).send({
    linkedinUrl: 'javascript:alert(1)',
    experiences: [{ organization: 'A', position: 'B', startDate: '2025-01-01', endDate: '2024-01-01' }],
  });
  expect(bad.status).toBe(400);
});
