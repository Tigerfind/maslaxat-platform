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

const {
  User,
  LawyerProfile,
  LawyerDocument,
  LawyerProfileImport,
  ProfileImportAudit,
  ObjectCleanupTask,
  Notification,
} = models;

beforeAll(async () => {
  await resetDb();
}, 60000);

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

  test('клиент без подтверждённого контакта не может бронировать (403)', async () => {
    const client = await makeClient('vs-unverified@test.uz', { isVerified: false });
    const { user: approved } = await makeLawyer('vs-a3b@test.uz', { verificationStatus: 'approved' });
    const res = await request(app)
      .post(`/api/lawyers/${approved.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .send({ type: 'video', duration: 60, problems: [{ text: 'Q', categories: ['civil'] }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONTACT_UNVERIFIED');
  });

  test('можно бронировать approved-юриста', async () => {
    const client = await makeClient('vs-client2@test.uz');
    const { user: approved } = await makeLawyer('vs-a3@test.uz', { verificationStatus: 'approved' });

    const res = await request(app)
      .post(`/api/lawyers/${approved.id}/book`)
      .set('Authorization', `Bearer ${tokenFor(client)}`)
      .set('Idempotency-Key', 'lawyer-verification-booking')
      .send({ type: 'video', duration: 60, problems: [{ text: 'Мой вопрос', categories: ['Гражданское право'] }] });
    expect([200, 201]).toContain(res.status);
  });
});

describe('админ approve/reject', () => {
  test('approve делает юриста видимым + уведомление', async () => {
    const admin = await makeAdmin('vs-admin1@test.uz');
    const { user: lawyer } = await makeLawyer('vs-p4@test.uz', { verificationStatus: 'pending' });
    await Promise.all([
      admin.update({ twoFactorEnabled: true }),
      lawyer.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' }),
    ]);

    const res = await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin');
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
    await admin.update({ twoFactorEnabled: true });

    const res = await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/reject`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
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

describe('field-level document provenance', () => {
  test('admin atomically verifies an allowed field from an approved compatible document', async () => {
    const admin = await makeAdmin('field-admin@test.uz');
    const { user: lawyer, lp } = await makeLawyer('field-lawyer@test.uz', {
      education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2020' }],
      profileSources: { education: { source: 'linkedin_pdf', verificationLevel: 'self_reported' } },
    });
    await admin.update({ twoFactorEnabled: true });
    const document = await LawyerDocument.create({
      userId: lawyer.id,
      type: 'diploma',
      name: 'diploma.pdf',
      path: '/tmp/diploma.pdf',
      mimeType: 'application/pdf',
      size: 100,
      verificationStatus: 'approved',
      approvedByUserId: admin.id,
      approvedAt: new Date(),
    });

    const response = await request(app)
      .patch(`/api/admin/lawyers/${lawyer.id}/profile-fields/education/verify`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .send({ documentId: document.id });

    expect(response.status).toBe(200);
    await lp.reload();
    expect(lp.profileSources.education).toMatchObject({
      source: 'supporting_document',
      verificationLevel: 'document_checked',
      documentId: document.id,
      reviewedByUserId: admin.id,
    });
    expect(lp.verifiedSnapshot.education).toEqual(lp.education);
    expect(lp.verifiedAt).toBeTruthy();
    await expect(ProfileImportAudit.findOne({
      where: { ownerUserId: lawyer.id, actorUserId: admin.id, event: 'field_verified' },
    })).resolves.toBeTruthy();
  });

  test('field verification rejects disallowed fields and incompatible or unapproved evidence', async () => {
    const admin = await makeAdmin('field-invalid-admin@test.uz');
    const { user: lawyer } = await makeLawyer('field-invalid-lawyer@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const pendingDiploma = await LawyerDocument.create({
      userId: lawyer.id, type: 'diploma', name: 'pending.pdf', path: '/tmp/pending.pdf',
      verificationStatus: 'pending',
    });
    const approvedDiploma = await LawyerDocument.create({
      userId: lawyer.id, type: 'diploma', name: 'approved.pdf', path: '/tmp/approved.pdf',
      verificationStatus: 'approved', approvedByUserId: admin.id, approvedAt: new Date(),
    });
    const auth = { Authorization: `Bearer ${tokenFor(admin, 'mfa')}`, 'X-Maslaxat-Mode': 'admin' };

    await request(app)
      .patch(`/api/admin/lawyers/${lawyer.id}/profile-fields/headline/verify`)
      .set(auth).send({ documentId: approvedDiploma.id }).expect(400);
    await request(app)
      .patch(`/api/admin/lawyers/${lawyer.id}/profile-fields/experience/verify`)
      .set(auth).send({ documentId: approvedDiploma.id }).expect(400);
    await request(app)
      .patch(`/api/admin/lawyers/${lawyer.id}/profile-fields/education/verify`)
      .set(auth).send({ documentId: pendingDiploma.id }).expect(400);
  });

  test('manual protected changes invalidate checked provenance and downgrade without affecting no-op saves', async () => {
    const { user: lawyer, lp } = await makeLawyer('field-manual@test.uz', {
      education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2020' }],
      profileSources: {
        education: { source: 'supporting_document', verificationLevel: 'document_checked', documentId: 'doc-id' },
      },
      verifiedSnapshot: { education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2020' }] },
      verifiedAt: new Date(),
    });
    const auth = { Authorization: `Bearer ${tokenFor(lawyer)}`, 'X-Maslaxat-Mode': 'lawyer' };

    await request(app).put('/api/lawyer/profile').set(auth).send({
      profileRevision: lp.revision,
      education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2020' }],
    }).expect(200);
    await lp.reload();
    expect(lp.profileSources.education.verificationLevel).toBe('document_checked');

    await request(app).put('/api/lawyer/profile').set(auth).send({
      profileRevision: lp.revision,
      education: [{ institution: 'TSUL', degree: 'LLM', endDate: '2022' }],
    }).expect(200);
    await lp.reload();
    expect(lp.profileSources.education).toBeUndefined();
    expect(lp.verifiedSnapshot.education).toBeUndefined();
    expect(lp.verificationStatus).toBe('pending');
    expect(lp.operatingStatus).toBe('suspended');
    expect(lp.isAvailable).toBe(false);
  });

  test('later document rejection invalidates dependent provenance/snapshot and downgrades profile', async () => {
    const admin = await makeAdmin('field-reject-admin@test.uz');
    const { user: lawyer, lp } = await makeLawyer('field-reject-lawyer@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const document = await LawyerDocument.create({
      userId: lawyer.id, type: 'diploma', name: 'diploma.pdf', path: '/tmp/reject.pdf',
      verificationStatus: 'approved', approvedByUserId: admin.id, approvedAt: new Date(),
    });
    await lp.update({
      education: [{ institution: 'TSUL' }],
      profileSources: {
        education: {
          source: 'supporting_document', verificationLevel: 'document_checked', documentId: document.id,
        },
      },
      verifiedSnapshot: { education: [{ institution: 'TSUL' }] },
      verifiedAt: new Date(),
    });

    await request(app)
      .patch(`/api/admin/lawyers/${lawyer.id}/verification-documents/${document.id}/status`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .send({ status: 'rejected', reason: 'Mismatch' })
      .expect(200);

    await lp.reload();
    expect(lp.profileSources.education).toBeUndefined();
    expect(lp.verifiedSnapshot.education).toBeUndefined();
    expect(lp.verificationStatus).toBe('pending');
    expect(lp.operatingStatus).toBe('suspended');
    expect(lp.isAvailable).toBe(false);
  });

  test('field verification follows global profile-before-document lock order', async () => {
    const admin = await makeAdmin('field-lock-order-admin@test.uz');
    const { user: lawyer } = await makeLawyer('field-lock-order-lawyer@test.uz');
    const document = await LawyerDocument.create({
      userId: lawyer.id, type: 'diploma', name: 'order.pdf', path: '/tmp/order.pdf',
      verificationStatus: 'approved', approvedByUserId: admin.id, approvedAt: new Date(),
    });
    const order = [];
    const originalDocumentFind = LawyerDocument.findOne.bind(LawyerDocument);
    const originalProfileFind = LawyerProfile.findOne.bind(LawyerProfile);
    const documentSpy = jest.spyOn(LawyerDocument, 'findOne').mockImplementation(async (...args) => {
      order.push('document');
      return originalDocumentFind(...args);
    });
    const profileSpy = jest.spyOn(LawyerProfile, 'findOne').mockImplementation(async (...args) => {
      order.push('profile');
      return originalProfileFind(...args);
    });
    const service = require('../src/services/profileImportService').createProfileImportService({
      models,
      storage: {},
      parser: { isAvailable: () => true, parse: async () => ({}) },
      quota: { consume: async () => 1 },
    });

    await service.verifyProfileField({
      userId: lawyer.id, field: 'education', documentId: document.id, reviewerUserId: admin.id,
    });

    expect(order.slice(0, 2)).toEqual(['profile', 'document']);
    documentSpy.mockRestore();
    profileSpy.mockRestore();
  });

  test('concurrent verify and reject complete without a document/profile deadlock', async () => {
    const admin = await makeAdmin('field-deadlock-admin@test.uz');
    const { user: lawyer } = await makeLawyer('field-deadlock-lawyer@test.uz');
    await admin.update({ twoFactorEnabled: true });
    const document = await LawyerDocument.create({
      userId: lawyer.id, type: 'diploma', name: 'deadlock.pdf', path: '/tmp/deadlock.pdf',
      verificationStatus: 'approved', approvedByUserId: admin.id, approvedAt: new Date(),
    });
    const auth = { Authorization: `Bearer ${tokenFor(admin, 'mfa')}`, 'X-Maslaxat-Mode': 'admin' };

    const outcomes = await Promise.race([
      Promise.all([
        request(app)
          .patch(`/api/admin/lawyers/${lawyer.id}/profile-fields/education/verify`)
          .set(auth).send({ documentId: document.id }),
        request(app)
          .patch(`/api/admin/lawyers/${lawyer.id}/verification-documents/${document.id}/status`)
          .set(auth).send({ status: 'rejected', reason: 'Concurrent check' }),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('deadlock timeout')), 5000)),
    ]);

    expect(outcomes.every((response) => response.status < 500)).toBe(true);
  });
});

describe('profile review import retention trigger', () => {
  test.each([
    ['approve', {}],
    ['reject', { reason: 'Needs changes' }],
  ])('%s schedules early cleanup of confirmed imports', async (action, body) => {
    const admin = await makeAdmin(`review-${action}-admin@test.uz`);
    const { user: lawyer } = await makeLawyer(`review-${action}-lawyer@test.uz`, {
      verificationStatus: 'pending',
    });
    await admin.update({ twoFactorEnabled: true });
    if (action === 'approve') {
      await lawyer.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' });
    }
    const imported = await LawyerProfileImport.create({
      userId: lawyer.id,
      status: 'confirmed',
      storageKey: `profile-imports/${lawyer.id}/${action}`,
      originalName: 'profile.pdf', mimeType: 'application/pdf', size: 8,
      sha256: 'b'.repeat(64), parsedData: { headline: 'Draft' }, warnings: [],
      expiresAt: new Date(Date.now() + 30 * 86400000), confirmedAt: new Date(),
    });

    await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/${action}`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .send(body)
      .expect(200);

    await expect(LawyerProfileImport.findByPk(imported.id)).resolves.toBeNull();
    expect(await ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } })).toBe(1);
  });

  test('approval rolls back when confirmed-import cleanup audit fails', async () => {
    const admin = await makeAdmin('review-atomic-admin@test.uz');
    const { user: lawyer, lp } = await makeLawyer('review-atomic-lawyer@test.uz', {
      verificationStatus: 'pending', operatingStatus: 'suspended', isAvailable: false,
    });
    await Promise.all([
      admin.update({ twoFactorEnabled: true }),
      lawyer.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' }),
    ]);
    const imported = await LawyerProfileImport.create({
      userId: lawyer.id, status: 'confirmed', storageKey: `profile-imports/${lawyer.id}/atomic`,
      originalName: 'profile.pdf', mimeType: 'application/pdf', size: 8,
      sha256: 'c'.repeat(64), parsedData: { headline: 'Draft' }, warnings: [],
      expiresAt: new Date(Date.now() + 86400000), confirmedAt: new Date(),
    });
    const failure = jest.spyOn(ProfileImportAudit, 'create').mockRejectedValueOnce(new Error('audit unavailable'));

    const response = await request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin');

    expect(response.status).toBe(500);
    await lp.reload();
    expect(lp.verificationStatus).toBe('pending');
    expect(lp.operatingStatus).toBe('suspended');
    await expect(LawyerProfileImport.findByPk(imported.id)).resolves.toBeTruthy();
    expect(await ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } })).toBe(0);
    failure.mockRestore();
  });

  test('approval waits for every confirmed import lock instead of skipping cleanup gaps', async () => {
    const admin = await makeAdmin('review-lock-admin@test.uz');
    const { user: lawyer } = await makeLawyer('review-lock-lawyer@test.uz', { verificationStatus: 'pending' });
    await Promise.all([
      admin.update({ twoFactorEnabled: true }),
      lawyer.update({ twoFactorEnabled: true, twoFactorSecret: 'TESTSECRET' }),
    ]);
    const imported = await LawyerProfileImport.create({
      userId: lawyer.id, status: 'confirmed', storageKey: `profile-imports/${lawyer.id}/locked`,
      originalName: 'profile.pdf', mimeType: 'application/pdf', size: 8,
      sha256: 'd'.repeat(64), parsedData: { headline: 'Draft' }, warnings: [],
      expiresAt: new Date(Date.now() + 86400000), confirmedAt: new Date(),
    });
    const lockTransaction = await models.sequelize.transaction();
    await LawyerProfileImport.findByPk(imported.id, {
      transaction: lockTransaction,
      lock: lockTransaction.LOCK.UPDATE,
    });
    let settled = false;
    const approval = request(app)
      .post(`/api/admin/lawyers/${lawyer.id}/approve`)
      .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
      .set('X-Maslaxat-Mode', 'admin')
      .then((response) => { settled = true; return response; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settledBeforeUnlock = settled;
    await lockTransaction.commit();
    const response = await approval;
    expect(settledBeforeUnlock).toBe(false);
    expect(response.status).toBe(200);
    await expect(LawyerProfileImport.findByPk(imported.id)).resolves.toBeNull();
  });
});

describe('manual profile optimistic concurrency', () => {
  test('stale protected update returns conflict and preserves newer provenance', async () => {
    const { user: lawyer, lp } = await makeLawyer('manual-stale@test.uz', {
      education: [{ institution: 'Old' }],
      profileSources: { education: { verificationLevel: 'document_checked', documentId: 'old-doc' } },
      verifiedSnapshot: { education: [{ institution: 'Old' }] },
    });
    const staleRevision = lp.revision;
    await lp.update({
      revision: lp.revision + 1,
      profileSources: { education: { verificationLevel: 'document_checked', documentId: 'new-doc' } },
      verifiedSnapshot: { education: [{ institution: 'New verified' }] },
    });

    const response = await request(app)
      .put('/api/lawyer/profile')
      .set('Authorization', `Bearer ${tokenFor(lawyer)}`)
      .set('X-Maslaxat-Mode', 'lawyer')
      .send({ profileRevision: staleRevision, education: [{ institution: 'Stale write' }] });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PROFILE_REVISION_CONFLICT');
    await lp.reload();
    expect(lp.education).toEqual([{ institution: 'Old' }]);
    expect(lp.profileSources.education.documentId).toBe('new-doc');
  });
});
