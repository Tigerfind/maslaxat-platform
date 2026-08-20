const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeAdmin, makeLawyer, tokenFor } = require('./helpers');

beforeEach(resetDb);

test('публично отдаёт только типы индивидуально проверенных документов', async () => {
  const { user } = await makeLawyer('public-docs@test.uz');
  await models.LawyerDocument.bulkCreate([
    { userId: user.id, type: 'diploma', name: 'secret-diploma.pdf', path: '/private/diploma.pdf', mimeType: 'application/pdf', size: 999, verifiedAt: new Date() },
    { userId: user.id, type: 'diploma', name: 'duplicate.pdf', path: '/private/duplicate.pdf', verifiedAt: new Date() },
    { userId: user.id, type: 'license', name: 'secret-license.pdf', path: '/private/license.pdf', verifiedAt: new Date() },
    { userId: user.id, type: 'certificate', name: 'pending.pdf', path: '/private/pending.pdf' },
    { userId: user.id, type: 'other', name: 'other.pdf', path: '/private/other.pdf', verifiedAt: new Date() },
  ]);

  const [catalog, profile] = await Promise.all([
    request(app).get('/api/lawyers?sortBy=recommended'),
    request(app).get(`/api/lawyers/${user.id}`),
  ]);
  const card = catalog.body.lawyers.find((item) => item.id === user.id);
  expect(card.profile.verifiedDocumentTypes).toEqual(['diploma', 'license']);
  expect(profile.body.lawyer.profile.verifiedDocumentTypes).toEqual(['diploma', 'license']);

  const publicJson = JSON.stringify({ card, profile: profile.body });
  expect(publicJson).not.toContain('secret-diploma.pdf');
  expect(publicJson).not.toContain('/private/');
  expect(publicJson).not.toContain('mimeType');
  expect(publicJson).not.toContain('verifiedAt');
  expect(publicJson).not.toContain('verifiedBy');
});

test('admin approval проверяет текущие документы, новая загрузка не наследует статус', async () => {
  const { user } = await makeLawyer('approve-docs@test.uz', { verificationStatus: 'pending_review', isAvailable: false });
  await user.update({ avatar: '/uploads/approve-docs.png' });
  const reviewed = await models.LawyerDocument.create({ userId: user.id, type: 'license', name: 'license.pdf', path: '/private/license.pdf' });
  const admin = await makeAdmin('approve-docs-admin@test.uz');
  const approve = await request(app).post(`/api/admin/lawyers/${user.id}/approve`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`);
  expect(approve.status).toBe(200);
  await reviewed.reload();
  expect(reviewed.verifiedAt).toBeTruthy();
  expect(reviewed.verifiedBy).toBe(admin.id);

  await models.LawyerDocument.create({ userId: user.id, type: 'diploma', name: 'new.pdf', path: '/private/new.pdf' });
  const profile = await request(app).get(`/api/lawyers/${user.id}`);
  expect(profile.body.lawyer.profile.verifiedDocumentTypes).toEqual(['license']);

  const diploma = await models.LawyerDocument.findOne({ where: { userId: user.id, type: 'diploma' } });
  const verify = await request(app).patch(`/api/admin/lawyers/${user.id}/verification-documents/${diploma.id}/verify`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`);
  expect(verify.status).toBe(200);
  const updated = await request(app).get(`/api/lawyers/${user.id}`);
  expect(updated.body.lawyer.profile.verifiedDocumentTypes).toEqual(['diploma', 'license']);
});

test('удаление последнего проверенного документа снимает публикацию даже при наличии нового файла', async () => {
  const { user, lp } = await makeLawyer('delete-verified@test.uz', { verificationStatus: 'approved' });
  const verified = await models.LawyerDocument.create({ userId: user.id, type: 'license', name: 'verified.pdf', path: '/private/verified.pdf', verifiedAt: new Date() });
  await models.LawyerDocument.create({ userId: user.id, type: 'diploma', name: 'new.pdf', path: '/private/new.pdf' });
  const response = await request(app).delete(`/api/lawyer/verification-documents/${verified.id}`)
    .set('Authorization', `Bearer ${tokenFor(user)}`);
  expect(response.status).toBe(200);
  await lp.reload();
  expect(lp.verificationStatus).toBe('draft');
  expect(lp.isAvailable).toBe(false);
});
