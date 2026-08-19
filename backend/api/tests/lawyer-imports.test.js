const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Readable } = require('stream');
const { resetDb, models, tokenFor, makeApplicant, makeClient, makeAdmin } = require('./helpers');
const { errorHandler } = require('../src/middleware/errorHandler');
// Initialize the mechanically collected mounted authorization registry before isolated router requests.
require('../src/server');

const NOW = new Date('2026-08-16T12:00:00.000Z');
const PDF = Buffer.from('%PDF-1.7\nsafe');
const SHA = crypto.createHash('sha256').update(PDF).digest('hex');

function createStorage() {
  const objects = new Map();
  return {
    objects,
    async putWithCleanupIntent({ object, persist }) {
      objects.set(object.key, Buffer.from(object.body));
      return persist({ transaction: undefined, cleanupIntentId: 'intent' });
    },
    async headPrivateObject(key) {
      const body = objects.get(key);
      return {
        ContentLength: body.length,
        ContentType: 'application/pdf',
        Metadata: { sha256: crypto.createHash('sha256').update(body).digest('hex') },
      };
    },
    async readPrivateObjectBuffer(key) {
      return Buffer.from(objects.get(key));
    },
    async withPrivateObjectStream(key, consume) {
      return consume(Readable.from([objects.get(key)]), {
        contentType: 'application/pdf',
        contentLength: objects.get(key).length,
        metadata: { sha256: SHA },
      });
    },
  };
}

function createHarness({ parsedData, clock = () => new Date(NOW), routerOptions = {} } = {}) {
  const storage = createStorage();
  const reservations = new WeakMap();
  const quota = {
    consume: async () => 1,
    async reserve(kind, ownerId) {
      const token = Object.freeze({});
      reservations.set(token, { kind, ownerId: String(ownerId), used: false });
      return token;
    },
    consumeReservation(token, kind, ownerId) {
      const reservation = reservations.get(token);
      if (!reservation || reservation.used || reservation.kind !== kind
        || reservation.ownerId !== String(ownerId)) throw new Error('invalid reservation');
      reservation.used = true;
    },
  };
  const parser = {
    isAvailable: () => true,
    parse: async () => ({
      data: parsedData || {
        headline: 'Imported headline',
        summary: 'Imported summary',
        positions: [{
          title: 'Counsel', company: 'Firm', location: 'Tashkent',
          startDate: '2020', endDate: 'Present', description: 'Civil cases',
        }],
        education: [{ institution: 'TSUL', degree: 'LLB', endDate: '2019' }],
        skills: ['Negotiation'],
        languages: ['Russian'],
        certificates: [{ name: 'Certificate', issuer: 'Bar', issuedAt: '2021' }],
      },
      warnings: [],
      parserVersion: 'linkedin-pdf-v1',
    }),
  };
  const service = require('../src/services/profileImportService').createProfileImportService({
    storage, parser, models, clock, quota,
  });
  const routerModule = require('../src/routes/lawyer-imports');
  const app = express();
  app.use(express.json());
  app.use('/api/lawyer/imports', routerModule.createLawyerImportsRouter({
    service,
    uploadQuota: async (req, _res, next) => {
      req.profileImportQuotaReservation = await quota.reserve('upload', req.userId);
      next();
    },
    uploadGate: (_req, _res, next) => next(),
    ...routerOptions,
  }));
  app.use(errorHandler);
  return { app, service, storage };
}

async function upload(app, user, key = 'route-upload-1') {
  return request(app)
    .post('/api/lawyer/imports')
    .set('Authorization', `Bearer ${tokenFor(user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .set('Idempotency-Key', key)
    .attach('file', PDF, { filename: 'linkedin.pdf', contentType: 'application/pdf' });
}

async function uploadAndParse(harness, applicant, key = 'route-upload-1') {
  const uploaded = await upload(harness.app, applicant.user, key);
  expect(uploaded.status).toBe(202);
  await harness.service.processImportJobs({ limit: 100 });
  return models.LawyerProfileImport.findByPk(uploaded.body.import.id);
}

beforeAll(resetDb, 60000);

test('upload quota rejects before PDF buffering middleware runs', async () => {
  let pdfMiddlewareCalls = 0;
  const harness = createHarness({
    routerOptions: {
      uploadQuota: (_req, res) => res.status(429).json({ code: 'PROFILE_IMPORT_RATE_LIMITED' }),
      pdfUpload: (_req, _res, next) => { pdfMiddlewareCalls += 1; next(); },
      uploadGate: (_req, _res, next) => next(),
    },
  });
  const applicant = await makeApplicant('imports-prebody-quota@test.uz');

  const response = await upload(harness.app, applicant.user, 'prebody-quota');

  expect(response.status).toBe(429);
  expect(response.body.code).toBe('PROFILE_IMPORT_RATE_LIMITED');
  expect(pdfMiddlewareCalls).toBe(0);
  expect(harness.storage.objects.size).toBe(0);
});

test('upload returns 202 without storage metadata and GET current recovers the same idempotent import', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-upload@test.uz');

  const first = await upload(harness.app, applicant.user);
  const recovered = await upload(harness.app, applicant.user);
  const current = await request(harness.app)
    .get('/api/lawyer/imports/current')
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer');

  expect(first.status).toBe(202);
  expect(recovered.status).toBe(202);
  expect(recovered.body.import.id).toBe(first.body.import.id);
  expect(current.status).toBe(200);
  expect(current.body.import.id).toBe(first.body.import.id);
  expect(first.body.import).toMatchObject({ status: 'uploaded', version: 1 });
  expect(first.body.import).not.toHaveProperty('storageKey');
  expect(first.body.import).not.toHaveProperty('sha256');
  expect(first.body.import).not.toHaveProperty('size');
  expect(harness.storage.objects.size).toBe(1);
});

test('GET current filters by the owner-bound exact Idempotency-Key while an unkeyed request keeps latest recovery', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-current-keyed@test.uz');
  const outsider = await makeApplicant('imports-current-keyed-outsider@test.uz');
  const older = await upload(harness.app, applicant.user, 'attempt-old');
  const newer = await upload(harness.app, applicant.user, 'attempt-new');
  await models.LawyerProfileImport.update({
    status: 'confirmed',
    confirmedFromVersion: 1,
    createdAt: new Date('2026-08-16T10:00:00.000Z'),
  }, { where: { id: older.body.import.id }, silent: true });
  await models.LawyerProfileImport.update({
    createdAt: new Date('2026-08-16T11:00:00.000Z'),
  }, { where: { id: newer.body.import.id }, silent: true });
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };

  const keyedOld = await request(harness.app).get('/api/lawyer/imports/current')
    .set(auth).set('Idempotency-Key', 'attempt-old');
  const keyedNew = await request(harness.app).get('/api/lawyer/imports/current')
    .set(auth).set('Idempotency-Key', 'attempt-new');
  const keyedMissing = await request(harness.app).get('/api/lawyer/imports/current')
    .set(auth).set('Idempotency-Key', 'attempt-missing');
  const latest = await request(harness.app).get('/api/lawyer/imports/current').set(auth);
  const missingForOutsider = await request(harness.app).get('/api/lawyer/imports/current')
    .set('Authorization', `Bearer ${tokenFor(outsider.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .set('Idempotency-Key', 'attempt-new');
  const invalid = await request(harness.app).get('/api/lawyer/imports/current')
    .set(auth).set('Idempotency-Key', 'invalid/key');

  expect(keyedOld.status).toBe(200);
  expect(keyedOld.body.import.id).toBe(older.body.import.id);
  expect(keyedNew.body.import.id).toBe(newer.body.import.id);
  expect(keyedMissing.body.import).toBeNull();
  expect(latest.body.import.id).toBe(newer.body.import.id);
  expect(missingForOutsider.body.import).toBeNull();
  expect(invalid.status).toBe(400);
  expect(invalid.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
});

test('owner reads a draft, outsider gets uniform 404, and admin read is audited before disclosure', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-owner@test.uz');
  const outsider = await makeClient('imports-outsider@test.uz');
  const admin = await makeAdmin('imports-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);

  const owner = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer');
  const denied = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`)
    .set('X-Maslaxat-Mode', 'client');
  const adminRead = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin');

  expect(owner.status).toBe(200);
  expect(owner.body.import.parsedData.headline).toBe('Imported headline');
  expect(denied.status).toBe(404);
  expect(adminRead.status).toBe(200);
  await expect(models.ProfileImportAudit.findOne({
    where: { importId: imported.id, actorUserId: admin.id, event: 'admin_view' },
  })).resolves.toBeTruthy();
});

test('all same-owner import operations require lawyer mode', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-owner-mode@test.uz');
  const imported = await uploadAndParse(harness, applicant, 'owner-mode');
  const clientMode = {
    Authorization: `Bearer ${tokenFor(applicant.user)}`,
    'X-Maslaxat-Mode': 'client',
  };

  const responses = await Promise.all([
    request(harness.app).get('/api/lawyer/imports/current').set(clientMode),
    request(harness.app).get(`/api/lawyer/imports/${imported.id}`).set(clientMode),
    request(harness.app).get(`/api/lawyer/imports/${imported.id}/download`).set(clientMode),
    request(harness.app).patch(`/api/lawyer/imports/${imported.id}/draft`).set(clientMode)
      .send({ version: imported.version, draft: imported.parsedData }),
    request(harness.app).post(`/api/lawyer/imports/${imported.id}/confirm`).set(clientMode)
      .send({ version: imported.version, acceptedPaths: ['headline'] }),
    request(harness.app).delete(`/api/lawyer/imports/${imported.id}`).set(clientMode),
  ]);

  expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
  expect(responses.every((response) => response.body.code === 'LAWYER_IMPORT_FORBIDDEN')).toBe(true);
  expect(await models.LawyerProfileImport.findByPk(imported.id)).not.toBeNull();
});

test('outsider receives uniform 404 before malformed draft or confirm payload validation', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-idor-owner@test.uz');
  const outsider = await makeClient('imports-idor-outsider@test.uz');
  const imported = await uploadAndParse(harness, applicant);
  const auth = { Authorization: `Bearer ${tokenFor(outsider)}`, 'X-Maslaxat-Mode': 'client' };

  const patch = await request(harness.app)
    .patch(`/api/lawyer/imports/${imported.id}/draft`)
    .set(auth)
    .send({ version: imported.version, draft: { role: 'admin' } });
  const confirm = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth)
    .send({ version: imported.version, acceptedPaths: ['positions.0.title'] });

  expect(patch.status).toBe(404);
  expect(confirm.status).toBe(404);
  expect(patch.body.code).toBe('IMPORT_NOT_FOUND');
  expect(confirm.body.code).toBe('IMPORT_NOT_FOUND');
});

test('malformed import identifiers use the same 404 contract across owner endpoints', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-bad-id@test.uz');
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };

  const responses = await Promise.all([
    request(harness.app).get('/api/lawyer/imports/not-a-uuid').set(auth),
    request(harness.app).get('/api/lawyer/imports/not-a-uuid/download').set(auth),
    request(harness.app).patch('/api/lawyer/imports/not-a-uuid/draft').set(auth).send({}),
    request(harness.app).post('/api/lawyer/imports/not-a-uuid/confirm').set(auth).send({}),
    request(harness.app).delete('/api/lawyer/imports/not-a-uuid').set(auth),
  ]);

  expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  expect(responses.every((response) => response.body.code === 'IMPORT_NOT_FOUND')).toBe(true);
});

test('admin read fails closed when its content-free audit cannot be persisted', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-audit-owner@test.uz');
  const admin = await makeAdmin('imports-audit-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);
  const failure = jest.spyOn(models.ProfileImportAudit, 'create').mockRejectedValueOnce(new Error('audit down'));

  const response = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin');

  expect(response.status).toBe(500);
  expect(response.body).not.toHaveProperty('import');
  failure.mockRestore();
});

test('admin GET audit/snapshot linearizes before owner delete', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-read-race@test.uz');
  const admin = await makeAdmin('imports-read-race-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);
  let releaseAudit;
  const auditGate = new Promise((resolve) => { releaseAudit = resolve; });
  let auditEntered;
  const entered = new Promise((resolve) => { auditEntered = resolve; });
  const originalCreate = models.ProfileImportAudit.create.bind(models.ProfileImportAudit);
  const auditSpy = jest.spyOn(models.ProfileImportAudit, 'create').mockImplementationOnce(async (...args) => {
    auditEntered();
    await auditGate;
    return originalCreate(...args);
  });

  const adminRead = request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin')
    .then((response) => response);
  await entered;
  let deleteSettled = false;
  const ownerDelete = request(harness.app)
    .delete(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .then((response) => { deleteSettled = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeAudit = deleteSettled;
  releaseAudit();
  expect((await adminRead).status).toBe(200);
  expect((await ownerDelete).status).toBe(204);
  expect(settledBeforeAudit).toBe(false);
  auditSpy.mockRestore();
}, 60000);

test('draft PATCH strictly sanitizes content, increments version, and rejects stale or unknown data', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-patch@test.uz');
  const imported = await uploadAndParse(harness, applicant);
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };

  const patched = await request(harness.app)
    .patch(`/api/lawyer/imports/${imported.id}/draft`)
    .set(auth)
    .send({
      version: imported.version,
      draft: {
        headline: '<script>alert(1)</script><b>Senior</b> +998 90 123 45 67',
        summary: 'Safe summary',
        positions: [], education: [], skills: [], languages: [], certificates: [],
        specializations: [],
      },
    });
  const stale = await request(harness.app)
    .patch(`/api/lawyer/imports/${imported.id}/draft`)
    .set(auth)
    .send({ version: imported.version, draft: patched.body.import.parsedData });
  const unknown = await request(harness.app)
    .patch(`/api/lawyer/imports/${imported.id}/draft`)
    .set(auth)
    .send({ version: patched.body.import.version, draft: { ...patched.body.import.parsedData, role: 'admin' } });

  expect(patched.status).toBe(200);
  expect(patched.body.import.version).toBe(imported.version + 1);
  expect(patched.body.import.parsedData.headline).toBe('Senior');
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'IMPORT_VERSION_CONFLICT', details: { currentVersion: imported.version + 1 } });
  expect(unknown.status).toBe(400);
  expect(unknown.body.code).toBe('INVALID_IMPORT_DRAFT');
});

test('confirm applies only accepted top paths with exact mapping and is idempotent from the same version', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-confirm@test.uz', {
    headline: 'Old headline',
    description: 'Old description',
    verificationStatus: 'approved',
    operatingStatus: 'enabled',
    isAvailable: true,
  });
  const imported = await uploadAndParse(harness, applicant);
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };

  const first = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth)
    .send({ version: imported.version, acceptedPaths: ['headline', 'positions'] });
  const repeated = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth)
    .send({ version: imported.version, acceptedPaths: ['headline'] });
  const profile = await models.LawyerProfile.findOne({ where: { userId: applicant.user.id } });

  expect(first.status).toBe(200);
  expect(first.body.import.confirmedFromVersion).toBe(imported.version);
  expect(repeated.status).toBe(200);
  expect(repeated.body.profile).toEqual(first.body.profile);
  expect(profile.headline).toBe('Imported headline');
  expect(profile.description).toBe('Old description');
  expect(profile.workExperience).toHaveLength(1);
  expect(profile.profileSources).toMatchObject({
    headline: { source: 'linkedin_pdf', verificationLevel: 'self_reported', importId: imported.id },
    workExperience: { source: 'linkedin_pdf', verificationLevel: 'self_reported', importId: imported.id },
  });
  expect(profile.verificationStatus).toBe('pending');
  expect(profile.operatingStatus).toBe('suspended');
  expect(profile.isAvailable).toBe(false);
});

test('confirm rejects nested paths, noncanonical specialization values, expiry, profile revision drift, and another confirmed version', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-conflicts@test.uz');
  await models.Specialization.create({ name: 'Гражданское право', nameEn: 'Civil law', isActive: true });
  const imported = await uploadAndParse(harness, applicant);
  await imported.update({
    parsedData: { ...imported.parsedData, specializations: ['Civil law'] },
  });
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };

  const nested = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth).send({ version: imported.version, acceptedPaths: ['positions.0.title'] });
  const alias = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth).send({ version: imported.version, acceptedPaths: ['specializations'] });
  expect(nested.status).toBe(400);
  expect(alias.status).toBe(400);
  expect(alias.body.code).toBe('INVALID_SPECIALIZATION');

  await imported.update({ parsedData: { ...imported.parsedData, specializations: ['Гражданское право'] } });
  const confirmed = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth).send({ version: imported.version, acceptedPaths: ['specializations'] });
  expect(confirmed.status).toBe(200);
  const otherVersion = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set(auth).send({ version: imported.version + 1, acceptedPaths: ['specializations'] });
  expect(otherVersion.status).toBe(409);

  const expired = await uploadAndParse(harness, applicant, 'route-upload-expired');
  await expired.update({ expiresAt: new Date('2026-08-16T11:59:59.000Z') });
  const expiredResponse = await request(harness.app)
    .post(`/api/lawyer/imports/${expired.id}/confirm`)
    .set(auth).send({ version: expired.version, acceptedPaths: ['headline'] });
  expect(expiredResponse.status).toBe(410);

  const drifted = await uploadAndParse(harness, applicant, 'route-upload-drifted');
  await applicant.lp.increment('revision');
  const driftResponse = await request(harness.app)
    .post(`/api/lawyer/imports/${drifted.id}/confirm`)
    .set(auth).send({ version: drifted.version, acceptedPaths: ['headline'] });
  expect(driftResponse.status).toBe(409);
  expect(driftResponse.body.code).toBe('PROFILE_REVISION_CONFLICT');
  await applicant.lp.reload();
  const reconfirmed = await request(harness.app)
    .post(`/api/lawyer/imports/${drifted.id}/confirm`)
    .set(auth).send({
      version: drifted.version,
      acceptedPaths: ['headline'],
      profileRevision: applicant.lp.revision,
    });
  expect(reconfirmed.status).toBe(200);
});

test('download streams an attachment with hardened headers and audits admin access before bytes', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-download@test.uz');
  const outsider = await makeClient('imports-download-out@test.uz');
  const admin = await makeAdmin('imports-download-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);

  const owner = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}/download`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .buffer(true);
  const denied = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}/download`)
    .set('Authorization', `Bearer ${tokenFor(outsider)}`)
    .set('X-Maslaxat-Mode', 'client');
  const adminDownload = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}/download`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin')
    .buffer(true);

  expect(owner.status).toBe(200);
  expect(owner.headers['content-disposition']).toBe('attachment; filename="profile-import.pdf"');
  expect(owner.headers['x-content-type-options']).toBe('nosniff');
  expect(owner.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
  expect(owner.headers['cache-control']).toBe('no-store, private');
  expect(owner.body).toEqual(PDF);
  expect(denied.status).toBe(404);
  expect(adminDownload.status).toBe(200);
  await expect(models.ProfileImportAudit.findOne({
    where: { importId: imported.id, actorUserId: admin.id, event: 'admin_download' },
  })).resolves.toBeTruthy();
});

test('admin download returns no bytes when audit persistence fails', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-download-fail@test.uz');
  const admin = await makeAdmin('imports-download-fail-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);
  const failure = jest.spyOn(models.ProfileImportAudit, 'create').mockRejectedValueOnce(new Error('audit down'));

  const response = await request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}/download`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin');

  expect(response.status).toBe(500);
  expect(response.headers['content-disposition']).toBeUndefined();
  failure.mockRestore();
});

test('authorized download stream lease blocks owner delete and cleanup until stream release', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-stream-race@test.uz');
  const admin = await makeAdmin('imports-stream-race-admin@test.uz');
  await admin.update({ twoFactorEnabled: true });
  const imported = await uploadAndParse(harness, applicant);
  const originalStream = harness.storage.withPrivateObjectStream.bind(harness.storage);
  let releaseStream;
  const streamGate = new Promise((resolve) => { releaseStream = resolve; });
  let streamEntered;
  const entered = new Promise((resolve) => { streamEntered = resolve; });
  harness.storage.withPrivateObjectStream = async (...args) => {
    streamEntered();
    await streamGate;
    return originalStream(...args);
  };

  const download = request(harness.app)
    .get(`/api/lawyer/imports/${imported.id}/download`)
    .set('Authorization', `Bearer ${tokenFor(admin, 'mfa')}`)
    .set('X-Maslaxat-Mode', 'admin')
    .buffer(true)
    .then((response) => response);
  await entered;
  let deleteSettled = false;
  const ownerDelete = request(harness.app)
    .delete(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .then((response) => { deleteSettled = true; return response; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const settledBeforeStream = deleteSettled;
  const cleanupBeforeStream = await models.ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } });
  releaseStream();
  expect((await download).status).toBe(200);
  expect((await ownerDelete).status).toBe(204);
  expect(settledBeforeStream).toBe(false);
  expect(cleanupBeforeStream).toBe(0);
  expect(await models.ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } })).toBe(1);
}, 60000);

test('DELETE atomically removes import content, writes audit and durable cleanup intent, and is idempotent', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-delete@test.uz');
  const imported = await uploadAndParse(harness, applicant);
  const auth = { Authorization: `Bearer ${tokenFor(applicant.user)}`, 'X-Maslaxat-Mode': 'lawyer' };
  const uploadIntentId = '93333333-3333-4333-8333-333333333333';
  await models.ObjectCleanupTask.create({
    id: uploadIntentId,
    storageKey: imported.storageKey,
    provider: 'r2',
    status: 'completed',
    nextAttemptAt: null,
    requiresOwnershipProof: true,
    ownershipToken: uploadIntentId,
  });

  await request(harness.app).delete(`/api/lawyer/imports/${imported.id}`).set(auth).expect(204);
  await request(harness.app).delete(`/api/lawyer/imports/${imported.id}`).set(auth).expect(204);

  await expect(models.LawyerProfileImport.findByPk(imported.id)).resolves.toBeNull();
  expect(await models.ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } })).toBe(1);
  await expect(models.ObjectCleanupTask.findByPk(uploadIntentId)).resolves.toMatchObject({
    status: 'pending', preventsKeyReuse: true,
    requiresOwnershipProof: true, ownershipToken: uploadIntentId,
  });
  expect(await models.ProfileImportAudit.count({
    where: { importId: imported.id, event: 'owner_delete' },
  })).toBe(1);
});

test('DELETE rolls back import and cleanup task when audit persistence fails', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-delete-rollback@test.uz');
  const imported = await uploadAndParse(harness, applicant);
  const failure = jest.spyOn(models.ProfileImportAudit, 'create').mockRejectedValueOnce(new Error('audit down'));

  const response = await request(harness.app)
    .delete(`/api/lawyer/imports/${imported.id}`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer');

  expect(response.status).toBe(500);
  await expect(models.LawyerProfileImport.findByPk(imported.id)).resolves.toMatchObject({ status: 'draft' });
  expect(await models.ObjectCleanupTask.count({ where: { storageKey: imported.storageKey } })).toBe(0);
  failure.mockRestore();
});

test('confirm replacing the last checked provenance clears verifiedAt and its snapshot', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-clear-verified-at@test.uz', {
    education: [{ institution: 'Old school' }],
    profileSources: {
      education: { source: 'supporting_document', verificationLevel: 'document_checked', documentId: 'doc-1' },
    },
    verifiedSnapshot: { education: [{ institution: 'Old school' }] },
    verifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  const imported = await uploadAndParse(harness, applicant);

  const response = await request(harness.app)
    .post(`/api/lawyer/imports/${imported.id}/confirm`)
    .set('Authorization', `Bearer ${tokenFor(applicant.user)}`)
    .set('X-Maslaxat-Mode', 'lawyer')
    .send({ version: imported.version, acceptedPaths: ['education'] });

  expect(response.status).toBe(200);
  await applicant.lp.reload();
  expect(applicant.lp.profileSources.education.verificationLevel).toBe('self_reported');
  expect(applicant.lp.verifiedSnapshot.education).toBeUndefined();
  expect(applicant.lp.verifiedAt).toBeNull();
});

test('confirm locks profile before import under the global profile/document order', async () => {
  const harness = createHarness();
  const applicant = await makeApplicant('imports-confirm-lock-order@test.uz');
  const imported = await uploadAndParse(harness, applicant);
  const order = [];
  const originalProfileFind = models.LawyerProfile.findOne.bind(models.LawyerProfile);
  const originalImportFind = models.LawyerProfileImport.findOne.bind(models.LawyerProfileImport);
  const profileSpy = jest.spyOn(models.LawyerProfile, 'findOne').mockImplementation(async (...args) => {
    if (args[0]?.lock) order.push('profile');
    return originalProfileFind(...args);
  });
  const importSpy = jest.spyOn(models.LawyerProfileImport, 'findOne').mockImplementation(async (...args) => {
    if (args[0]?.lock) order.push('import');
    return originalImportFind(...args);
  });

  await harness.service.confirmImport({
    importId: imported.id,
    userId: applicant.user.id,
    version: imported.version,
    acceptedPaths: ['headline'],
  });

  expect(order.slice(0, 2)).toEqual(['profile', 'import']);
  profileSpy.mockRestore();
  importSpy.mockRestore();
});
