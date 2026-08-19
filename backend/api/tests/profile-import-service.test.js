const crypto = require('crypto');
const { resetDb, models, makeApplicant } = require('./helpers');
const { createProfileImportRateLimit } = require('../src/middleware/profileImportRateLimit');

const NOW = new Date('2026-08-16T12:00:00.000Z');

function loadServiceFactory() {
  return require('../src/services/profileImportService').createProfileImportService;
}

function createStorage(body = Buffer.from('%PDF-1.7\nsafe')) {
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  return {
    body,
    sha256,
    putCalls: [],
    async putWithCleanupIntent({ object, persist }) {
      this.putCalls.push(object);
      return persist({ transaction: undefined, cleanupIntentId: 'intent-id' });
    },
    async headPrivateObject() {
      return {
        ContentLength: this.body.length,
        ContentType: 'application/pdf',
        Metadata: { sha256: this.sha256 },
      };
    },
    async readPrivateObjectBuffer() {
      return Buffer.from(this.body);
    },
  };
}

function createParser(overrides = {}) {
  return {
    isAvailable: () => true,
    parse: async () => ({
      data: {
        headline: 'Legal specialist',
        summary: 'Safe summary',
        positions: [],
        education: [],
        skills: [],
        languages: ['Russian'],
        certificates: [],
      },
      warnings: [],
      parserVersion: 'linkedin-pdf-v1',
    }),
    ...overrides,
  };
}

function createQuota(overrides = {}) {
  const reservations = new WeakMap();
  const quota = {
    calls: [],
    async consume(kind, ownerId) {
      this.calls.push([kind, ownerId]);
      return 1;
    },
    ...overrides,
  };
  quota.reserve = async function reserve(kind, ownerId) {
    await this.consume(kind, ownerId);
    const token = Object.freeze({});
    reservations.set(token, { kind, ownerId: String(ownerId), used: false });
    return token;
  };
  quota.consumeReservation = function consumeReservation(token, kind, ownerId) {
    const reservation = reservations.get(token);
    if (!reservation || reservation.used || reservation.kind !== kind
      || reservation.ownerId !== String(ownerId)) {
      throw Object.assign(new Error('invalid reservation'), {
        status: 403, code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID',
      });
    }
    reservation.used = true;
  };
  return quota;
}

function createService({ storage, parser, quota, reportException } = {}) {
  const resolvedQuota = quota || createQuota();
  const service = loadServiceFactory()({
    storage: storage || createStorage(),
    parser: parser || createParser(),
    models,
    clock: () => new Date(NOW),
    quota: resolvedQuota,
    reportException,
  });
  service.__testQuota = resolvedQuota;
  return service;
}

test('worker reports a swallowed parser failure with operational IDs only', async () => {
  const storage = createStorage();
  const parserError = new Error('private parsed document content');
  const reportException = jest.fn();
  const service = createService({
    storage,
    reportException,
    parser: createParser({ parse: async () => { throw parserError; } }),
  });
  const applicant = await makeApplicant('service-report@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  await expect(service.processImportJobs({ limit: 1 })).resolves.toMatchObject({ failed: 1 });
  expect(reportException).toHaveBeenCalledWith(parserError, {
    operation: 'profile_import_job',
    importId: imported.id,
    userId: applicant.user.id,
  });
});

async function uploadFixture(service, applicant, storage, overrides = {}) {
  const quotaReservation = Object.hasOwn(overrides, 'quotaReservation')
    ? overrides.quotaReservation
    : await service.__testQuota.reserve('upload', applicant.user.id);
  return service.uploadImport({
    userId: applicant.user.id,
    idempotencyKey: 'upload-key-1',
    file: {
      buffer: storage.body,
      checksum: storage.sha256,
      objectKey: `profile-imports/${applicant.user.id}/object-1`,
      originalname: 'profile.pdf',
      mimetype: 'application/pdf',
      size: storage.body.length,
    },
    quotaReservation,
    ...overrides,
  });
}

beforeEach(resetDb);

test('service factory is injected and upload fails closed before storage when parser startup is unavailable', async () => {
  expect(loadServiceFactory).not.toThrow();
  const storage = createStorage();
  const quota = createQuota();
  const service = createService({
    storage,
    quota,
    parser: createParser({ isAvailable: () => false }),
  });
  const applicant = await makeApplicant('service-unavailable@test.uz');

  await expect(uploadFixture(service, applicant, storage)).rejects.toMatchObject({
    status: 503,
    code: 'PDF_IMPORT_UNAVAILABLE',
  });
  expect(storage.putCalls).toHaveLength(0);
  expect(quota.calls).toEqual([['upload', applicant.user.id]]);
});

test('upload uses durable put persistence, snapshots profile revision, and recovers by idempotency key', async () => {
  const storage = createStorage();
  const quota = createQuota();
  const service = createService({ storage, quota });
  const applicant = await makeApplicant('service-upload@test.uz', { revision: 7 });

  const first = await uploadFixture(service, applicant, storage);
  const recovered = await uploadFixture(service, applicant, storage);

  expect(first.toJSON()).toMatchObject({
    userId: applicant.user.id,
    uploadIdempotencyKey: 'upload-key-1',
    status: 'uploaded',
    profileRevision: 7,
    expiresAt: new Date('2026-08-17T12:00:00.000Z'),
  });
  expect(recovered.id).toBe(first.id);
  expect(storage.putCalls).toHaveLength(1);
  expect(storage.putCalls[0]).toEqual({
    key: `profile-imports/${applicant.user.id}/object-1`,
    body: storage.body,
    contentType: 'application/pdf',
    checksum: storage.sha256,
  });
  expect(quota.calls).toEqual([
    ['upload', applicant.user.id],
    ['upload', applicant.user.id],
  ]);
});

test('upload rejects forged, missing, reused, and wrong-owner quota reservations', async () => {
  let count = 0;
  const quota = createProfileImportRateLimit({
    getRedisClient: () => ({ eval: async () => { count += 1; return count; } }),
  });
  expect(quota.reserve).toEqual(expect.any(Function));
  const storage = createStorage();
  const factory = loadServiceFactory();
  const service = factory({ storage, parser: createParser(), models, clock: () => new Date(NOW), quota });
  const owner = await makeApplicant('service-reservation-owner@test.uz');
  const other = await makeApplicant('service-reservation-other@test.uz');

  await expect(uploadFixture(service, owner, storage, { quotaReservation: true }))
    .rejects.toMatchObject({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' });
  await expect(uploadFixture(service, owner, storage, { quotaReservation: {} }))
    .rejects.toMatchObject({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' });
  const wrongOwner = await quota.reserve('upload', owner.user.id);
  await expect(uploadFixture(service, other, storage, { quotaReservation: wrongOwner }))
    .rejects.toMatchObject({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' });

  const valid = await quota.reserve('upload', owner.user.id);
  await expect(uploadFixture(service, owner, storage, { quotaReservation: valid })).resolves.toBeTruthy();
  await expect(uploadFixture(service, owner, storage, {
    idempotencyKey: 'upload-key-reused', quotaReservation: valid,
  })).rejects.toMatchObject({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' });
  await expect(uploadFixture(service, owner, storage, {
    idempotencyKey: 'upload-key-missing', quotaReservation: undefined,
  })).rejects.toMatchObject({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' });
});

test('two workers claim an uploaded import once and persist a normalized draft', async () => {
  const storage = createStorage();
  let parseCalls = 0;
  const parser = createParser({
    parse: async () => {
      parseCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return createParser().parse();
    },
  });
  const quota = createQuota();
  const service = createService({ storage, parser, quota });
  const applicant = await makeApplicant('service-worker@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  const [left, right] = await Promise.all([
    service.processImportJobs({ limit: 1 }),
    service.processImportJobs({ limit: 1 }),
  ]);
  const updated = await models.LawyerProfileImport.findByPk(imported.id);

  expect(parseCalls).toBe(1);
  expect(left.claimed + right.claimed).toBe(1);
  expect(updated.toJSON()).toMatchObject({
    status: 'draft',
    parsedData: { headline: 'Legal specialist' },
    parserVersion: 'linkedin-pdf-v1',
  });
  expect(quota.calls).toContainEqual(['parse', applicant.user.id]);
});

test('worker rejects exact size, SHA, or R2 metadata mismatch without invoking parser', async () => {
  const storage = createStorage();
  storage.headPrivateObject = async () => ({
    ContentLength: storage.body.length + 1,
    ContentType: 'application/pdf',
    Metadata: { sha256: storage.sha256 },
  });
  const parser = createParser({ parse: jest.fn() });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-integrity@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  await service.processImportJobs({ limit: 1 });
  const updated = await models.LawyerProfileImport.findByPk(imported.id);

  expect(updated.status).toBe('failed');
  expect(updated.parsedData).toBeNull();
  expect(parser.parse).not.toHaveBeenCalled();
});

test('parser quota failure returns the claim to uploaded instead of losing the queued import', async () => {
  const storage = createStorage();
  const quota = createQuota({
    async consume(kind, ownerId) {
      this.calls.push([kind, ownerId]);
      if (kind === 'parse') {
        throw Object.assign(new Error('limited'), {
          status: 429,
          code: 'PROFILE_IMPORT_RATE_LIMITED',
          retryAfter: 1800,
        });
      }
      return 1;
    },
  });
  const parser = createParser({ parse: jest.fn() });
  const service = createService({ storage, parser, quota });
  const applicant = await makeApplicant('service-quota@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  const summary = await service.processImportJobs({ limit: 1 });
  const updated = await models.LawyerProfileImport.findByPk(imported.id);

  expect(summary.deferred).toBe(1);
  expect(updated.status).toBe('uploaded');
  expect(parser.parse).not.toHaveBeenCalled();
});

test('worker reclaims stale parsing and a version fence prevents obsolete finalization', async () => {
  const storage = createStorage();
  let imported;
  const parser = createParser({
    parse: async () => {
      await models.LawyerProfileImport.update(
        { status: 'failed', version: 99 },
        { where: { id: imported.id } }
      );
      return createParser().parse();
    },
  });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-fence@test.uz');
  imported = await uploadFixture(service, applicant, storage);
  await models.sequelize.query(`
    UPDATE lawyer_profile_imports
    SET status = 'parsing', updated_at = '2026-08-16T11:00:00.000Z'
    WHERE id = :id
  `, { replacements: { id: imported.id } });

  const summary = await service.processImportJobs({ limit: 1, staleAfterMs: 10 * 60 * 1000 });
  const updated = await models.LawyerProfileImport.findByPk(imported.id);

  expect(summary.claimed).toBe(1);
  expect(summary.lost).toBe(1);
  expect(updated.status).toBe('failed');
  expect(updated.version).toBe(99);
});

test('worker leaves an upload queued when parser availability is lost after acceptance', async () => {
  const storage = createStorage();
  let available = true;
  const parser = createParser({
    isAvailable: () => available,
    parse: jest.fn(),
  });
  const quota = createQuota();
  const service = createService({ storage, parser, quota });
  const applicant = await makeApplicant('service-lost-availability@test.uz');
  const imported = await uploadFixture(service, applicant, storage);
  available = false;

  const summary = await service.processImportJobs({ limit: 1 });

  await expect(models.LawyerProfileImport.findByPk(imported.id)).resolves.toMatchObject({ status: 'uploaded' });
  expect(summary.deferred).toBe(1);
  expect(parser.parse).not.toHaveBeenCalled();
  expect(quota.calls).toEqual([['upload', applicant.user.id]]);
});

test('worker strictly sanitizes the injected parser result before persisting a draft', async () => {
  const storage = createStorage();
  const parser = createParser({
    parse: async () => ({
      data: {
        headline: '<script>bad()</script><b>Senior</b> lawyer@example.test',
        summary: 'Summary', positions: [], education: [], skills: [], languages: [], certificates: [],
      },
      warnings: [],
      parserVersion: 'injected-v1',
    }),
  });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-sanitize@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  await service.processImportJobs({ limit: 1 });

  const updated = await models.LawyerProfileImport.findByPk(imported.id);
  expect(updated.parsedData.headline).toBe('Senior');
  expect(updated.parsedData.specializations).toEqual([]);
});

test('worker re-sanitizes and bounds injected parser warnings before persistence', async () => {
  const storage = createStorage();
  const warnings = Array.from({ length: 40 }, (_, index) => ({
    code: index % 2 ? 'UNKNOWN_SECTION' : 'MALFORMED_ENTRY',
    section: `<script>bad()</script> +998901234567 private${index}@example.test \u202e document text`,
    message: 'provider-controlled message',
  }));
  warnings.push({ code: 'ECONNREFUSED', message: 'infrastructure detail' });
  const parser = createParser({
    parse: async () => ({
      data: {
        headline: 'Safe', summary: '', positions: [], education: [], skills: [],
        languages: [], certificates: [],
      },
      warnings,
      parserVersion: 'injected-v1',
    }),
  });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-warning-sanitize@test.uz');
  const imported = await uploadFixture(service, applicant, storage);

  await service.processImportJobs({ limit: 1 });

  const updated = await models.LawyerProfileImport.findByPk(imported.id);
  expect(updated.warnings).toEqual([
    { code: 'MALFORMED_ENTRY', message: 'Some profile entries could not be imported.' },
    { code: 'UNKNOWN_SECTION', message: 'Some unsupported profile sections were skipped.' },
  ]);
  expect(JSON.stringify(updated.warnings)).not.toMatch(/ECONNREFUSED|998|example|script|document text/i);
});

test('processor claims only bounded jobs immediately before parsing instead of marking limit=100 parsing', async () => {
  const storage = createStorage();
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  let active = 0;
  let maxActive = 0;
  const parser = createParser({
    parse: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      entered();
      await blocker;
      active -= 1;
      return createParser().parse();
    },
  });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-incremental-claim@test.uz');
  for (let index = 0; index < 6; index += 1) {
    await models.LawyerProfileImport.create({
      userId: applicant.user.id,
      storageKey: `profile-imports/${applicant.user.id}/incremental-${index}`,
      originalName: 'profile.pdf', mimeType: 'application/pdf', size: storage.body.length,
      sha256: storage.sha256, expiresAt: new Date('2026-08-17T12:00:00.000Z'),
    });
  }

  const processing = service.processImportJobs({ limit: 100, concurrency: 2 });
  await firstEntered;
  await new Promise((resolve) => setTimeout(resolve, 50));
  const parsingCount = await models.LawyerProfileImport.count({ where: { status: 'parsing' } });
  const uploadedCount = await models.LawyerProfileImport.count({ where: { status: 'uploaded' } });
  release();
  const summary = await processing;

  expect(parsingCount).toBeLessThanOrEqual(2);
  expect(uploadedCount).toBeGreaterThanOrEqual(4);
  expect(maxActive).toBeLessThanOrEqual(2);
  expect(summary.claimed).toBe(6);
});

test('heartbeat prevents a delayed parse from stale reclaim by a second worker', async () => {
  const storage = createStorage();
  let currentMs = Date.now();
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  let parseCalls = 0;
  const parser = createParser({
    parse: async () => {
      parseCalls += 1;
      if (parseCalls === 1) {
        entered();
        await blocker;
      }
      return createParser().parse();
    },
  });
  const quota = createQuota();
  const factory = require('../src/services/profileImportService').createProfileImportService;
  const dependencies = {
    storage, parser, models, quota, clock: () => new Date(currentMs),
  };
  const firstWorker = factory(dependencies);
  const secondWorker = factory(dependencies);
  const applicant = await makeApplicant('service-heartbeat@test.uz');
  const quotaReservation = await quota.reserve('upload', applicant.user.id);
  const imported = await uploadFixture(firstWorker, applicant, storage, { quotaReservation });

  const first = firstWorker.processImportJobs({ limit: 1, concurrency: 1, staleAfterMs: 1000 });
  await firstEntered;
  await models.sequelize.query(`
    UPDATE lawyer_profile_imports SET updated_at = :updatedAt WHERE id = :id
  `, { replacements: { id: imported.id, updatedAt: new Date(currentMs) } });
  currentMs += 1100;
  await new Promise((resolve) => setTimeout(resolve, 450));
  const second = await secondWorker.processImportJobs({ limit: 1, concurrency: 1, staleAfterMs: 1000 });
  release();
  const firstSummary = await first;
  const updated = await models.LawyerProfileImport.findByPk(imported.id);

  expect(parseCalls).toBe(1);
  expect(firstSummary.completed).toBe(1);
  expect(second.claimed).toBe(0);
  expect(updated.status).toBe('draft');
});

test('heartbeat database failure aborts the active parser before safe requeue and retry', async () => {
  const storage = createStorage();
  let parseCalls = 0;
  let live = 0;
  let maxLive = 0;
  let abortObserved = false;
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  const parser = createParser({
    parse: async (_body, { signal } = {}) => {
      parseCalls += 1;
      live += 1;
      maxLive = Math.max(maxLive, live);
      try {
        if (parseCalls === 1) {
          entered();
          await Promise.race([
            new Promise((resolve, reject) => {
              signal?.addEventListener('abort', () => {
                abortObserved = true;
                reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
              }, { once: true });
            }),
            new Promise((resolve) => setTimeout(resolve, 1200)),
          ]);
        }
        return createParser().parse();
      } finally {
        live -= 1;
      }
    },
  });
  const service = createService({ storage, parser });
  const applicant = await makeApplicant('service-heartbeat-failure@test.uz');
  const imported = await uploadFixture(service, applicant, storage);
  const originalQuery = models.sequelize.query.bind(models.sequelize);
  let failedHeartbeat = false;
  const querySpy = jest.spyOn(models.sequelize, 'query').mockImplementation((sql, options) => {
    if (!failedHeartbeat && String(sql).includes('SET updated_at = :heartbeatAt')) {
      failedHeartbeat = true;
      return Promise.reject(new Error('heartbeat database unavailable'));
    }
    return originalQuery(sql, options);
  });

  const first = service.processImportJobs({ limit: 1, concurrency: 1, staleAfterMs: 1000 });
  await firstEntered;
  const firstSummary = await first;
  querySpy.mockRestore();
  const afterAbort = await models.LawyerProfileImport.findByPk(imported.id);
  const secondSummary = await service.processImportJobs({ limit: 1, concurrency: 1, staleAfterMs: 1000 });
  const final = await models.LawyerProfileImport.findByPk(imported.id);

  expect(abortObserved).toBe(true);
  expect(firstSummary.deferred).toBe(1);
  expect(afterAbort.status).toBe('uploaded');
  expect(secondSummary.completed).toBe(1);
  expect(parseCalls).toBe(2);
  expect(maxLive).toBe(1);
  expect(final.status).toBe('draft');
}, 10000);
