const { resetDb, models, makeApplicant } = require('./helpers');
const { createProfileImportService } = require('../src/services/profileImportService');

const NOW = new Date('2026-08-16T12:00:00.000Z');

function service() {
  return createProfileImportService({
    models,
    storage: {},
    parser: { isAvailable: () => true, parse: async () => ({}) },
    quota: { consume: async () => 1 },
    clock: () => new Date(NOW),
  });
}

async function importRow(userId, overrides = {}) {
  return models.LawyerProfileImport.create({
    userId,
    storageKey: `profile-imports/${userId}/${Math.random()}`,
    originalName: 'profile.pdf',
    mimeType: 'application/pdf',
    size: 8,
    sha256: 'a'.repeat(64),
    parsedData: { headline: 'Draft' },
    warnings: [],
    expiresAt: new Date('2026-08-17T12:00:00.000Z'),
    ...overrides,
  });
}

beforeEach(resetDb, 180000);

test('retention worker discards expired unconfirmed and 30-day confirmed content exactly once', async () => {
  const applicant = await makeApplicant('retention@test.uz');
  const expired = await importRow(applicant.user.id, {
    status: 'draft', expiresAt: new Date('2026-08-16T11:59:59.000Z'),
  });
  const oldConfirmed = await importRow(applicant.user.id, {
    status: 'confirmed', confirmedAt: new Date('2026-07-17T11:59:59.000Z'),
  });
  const recentConfirmed = await importRow(applicant.user.id, {
    status: 'confirmed', confirmedAt: new Date('2026-07-18T12:00:00.000Z'),
  });
  const worker = service();

  const first = await worker.processRetentionJobs({ limit: 10 });
  const second = await worker.processRetentionJobs({ limit: 10 });

  expect(first).toMatchObject({ claimed: 2, discarded: 2 });
  expect(second).toMatchObject({ claimed: 0, discarded: 0 });
  await expect(models.LawyerProfileImport.findByPk(expired.id)).resolves.toBeNull();
  await expect(models.LawyerProfileImport.findByPk(oldConfirmed.id)).resolves.toBeNull();
  await expect(recentConfirmed.reload()).resolves.toMatchObject({ status: 'confirmed' });
  expect(await models.ObjectCleanupTask.count()).toBe(2);
  expect(await models.ProfileImportAudit.count({ where: { event: 'retention_cleanup' } })).toBe(2);
});

test('admin review schedules confirmed raw and draft cleanup earlier than 30 days', async () => {
  const applicant = await makeApplicant('review-cleanup@test.uz');
  const confirmed = await importRow(applicant.user.id, {
    status: 'confirmed', confirmedAt: new Date('2026-08-16T11:00:00.000Z'),
  });
  const worker = service();

  const first = await worker.scheduleReviewedImportCleanup({ userId: applicant.user.id });
  const second = await worker.scheduleReviewedImportCleanup({ userId: applicant.user.id });

  expect(first).toBe(1);
  expect(second).toBe(0);
  await expect(models.LawyerProfileImport.findByPk(confirmed.id)).resolves.toBeNull();
  expect(await models.ObjectCleanupTask.count({ where: { storageKey: confirmed.storageKey } })).toBe(1);
  expect(await models.ProfileImportAudit.count({
    where: { importId: confirmed.id, event: 'profile_review_cleanup' },
  })).toBe(1);
});

test('admin review redacts only IDs selected before a concurrent confirmation', async () => {
  const applicant = await makeApplicant('review-locked-ids@test.uz');
  const selected = await importRow(applicant.user.id, {
    status: 'confirmed', confirmedAt: new Date('2026-08-16T11:00:00.000Z'),
  });
  let concurrentlyConfirmed;
  let candidateQuerySeen = false;
  const originalFindAll = models.LawyerProfileImport.findAll.bind(models.LawyerProfileImport);
  const findSpy = jest.spyOn(models.LawyerProfileImport, 'findAll').mockImplementation(async (options) => {
    const rows = await originalFindAll(options);
    if (!candidateQuerySeen && options.attributes?.includes('id')) {
      candidateQuerySeen = true;
      concurrentlyConfirmed = await importRow(applicant.user.id, {
        status: 'confirmed', confirmedAt: new Date('2026-08-16T11:30:00.000Z'),
      });
    }
    return rows;
  });

  const discarded = await service().scheduleReviewedImportCleanup({ userId: applicant.user.id });

  expect(discarded).toBe(1);
  await expect(models.LawyerProfileImport.findByPk(selected.id)).resolves.toBeNull();
  await expect(models.LawyerProfileImport.findByPk(concurrentlyConfirmed.id)).resolves.toMatchObject({
    status: 'confirmed', parsedData: { headline: 'Draft' },
  });
  expect(await models.ObjectCleanupTask.count({
    where: { storageKey: concurrentlyConfirmed.storageKey },
  })).toBe(0);
  expect(await models.ProfileImportAudit.count({
    where: { importId: concurrentlyConfirmed.id },
  })).toBe(0);
  findSpy.mockRestore();
});

test('audit retention deletes only audit metadata whose 90-day expiry has passed', async () => {
  const applicant = await makeApplicant('audit-retention@test.uz');
  const imported = await importRow(applicant.user.id);
  await models.ProfileImportAudit.bulkCreate([
    {
      importId: imported.id, ownerUserId: applicant.user.id, event: 'owner_delete',
      createdAt: new Date('2026-05-18T11:59:59.000Z'), expiresAt: new Date('2026-08-16T11:59:59.000Z'),
    },
    {
      importId: imported.id, ownerUserId: applicant.user.id, event: 'owner_delete',
      createdAt: new Date('2026-05-18T12:00:01.000Z'), expiresAt: new Date('2026-08-16T12:00:01.000Z'),
    },
  ]);

  const deleted = await service().processAuditRetentionJobs({ limit: 10 });

  expect(deleted).toBe(1);
  expect(await models.ProfileImportAudit.count()).toBe(1);
});
