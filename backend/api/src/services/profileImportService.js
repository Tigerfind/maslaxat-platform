const crypto = require('crypto');
const { Op } = require('sequelize');
const defaultModels = require('../models');
const defaultStorage = require('./objectStorage');
const linkedinParser = require('./linkedinPdfParser');
const { profileImportQuota } = require('../middleware/profileImportRateLimit');
const { reportCaughtException } = require('../instrument');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_MS = 15 * 60 * 1000;
const CONFIRMED_RETENTION_MS = 30 * DAY_MS;
const AUDIT_RETENTION_MS = 90 * DAY_MS;
const ACCEPTED_PATHS = new Set([
  'headline', 'summary', 'positions', 'education', 'languages', 'certificates', 'specializations',
]);
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d[\d ()-]{7,}\d)/g;

function serviceError(status, code, message = code, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function validIdempotencyKey(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function requireImportId(value) {
  if (typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
  }
}

function createDefaultParser() {
  return {
    isAvailable: linkedinParser.productionSandboxReady,
    parse: linkedinParser.parseLinkedinPdf,
  };
}

function sanitizePlain(value, maxLength) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function sanitizeObjectList(value, fields, maxItems = 50) {
  if (!Array.isArray(value) || value.length > maxItems) throw serviceError(400, 'INVALID_IMPORT_DRAFT');
  return value.map((item) => {
    if (!exactKeys(item, fields)) throw serviceError(400, 'INVALID_IMPORT_DRAFT');
    return Object.fromEntries(fields.map((field) => [field, sanitizePlain(item[field], 500)]));
  });
}

function sanitizeStringList(value, maxItems = 100, maxLength = 200) {
  if (!Array.isArray(value) || value.length > maxItems) throw serviceError(400, 'INVALID_IMPORT_DRAFT');
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') throw serviceError(400, 'INVALID_IMPORT_DRAFT');
    const clean = sanitizePlain(item, maxLength);
    const key = clean.toLocaleLowerCase('en');
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

function sanitizeDraft(value) {
  const keys = [
    'headline', 'summary', 'positions', 'education', 'skills', 'languages',
    'certificates', 'specializations',
  ];
  if (!exactKeys(value, keys)) throw serviceError(400, 'INVALID_IMPORT_DRAFT');
  return {
    headline: sanitizePlain(value.headline, 300),
    summary: sanitizePlain(value.summary, 2000),
    positions: sanitizeObjectList(
      value.positions || [],
      ['title', 'company', 'location', 'startDate', 'endDate', 'description']
    ),
    education: sanitizeObjectList(value.education || [], ['institution', 'degree', 'endDate']),
    skills: sanitizeStringList(value.skills || []),
    languages: sanitizeStringList(value.languages || []),
    certificates: sanitizeObjectList(value.certificates || [], ['name', 'issuer', 'issuedAt']),
    specializations: sanitizeStringList(value.specializations || [], 12, 120),
  };
}

function serializeImport(row, { includeDraft = true } = {}) {
  if (!row) return null;
  const value = row.toJSON ? row.toJSON() : row;
  return {
    id: value.id,
    source: value.source,
    status: value.status,
    originalName: value.originalName,
    ...(includeDraft ? {
      parsedData: value.parsedData,
      acceptedData: value.acceptedData,
      warnings: value.warnings,
      parserVersion: value.parserVersion,
    } : {}),
    version: value.version,
    confirmedFromVersion: value.confirmedFromVersion,
    expiresAt: value.expiresAt,
    confirmedAt: value.confirmedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value ?? null;
}

function jsonEqual(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

const PROFILE_TRACKED_FIELDS = [
  'headline', 'description', 'workExperience', 'experience', 'education',
  'certificates', 'languages', 'specializations', 'specialization', 'linkedinUrl',
];
const PROFILE_PROTECTED_FIELDS = new Set([
  'workExperience', 'experience', 'education', 'certificates',
  'specializations', 'specialization',
]);

function profileFieldSnapshot(profile) {
  return Object.fromEntries(PROFILE_TRACKED_FIELDS.map((field) => [field, profile[field]]));
}

function applyManualProfileChangePolicy(profile, before) {
  const changedFields = PROFILE_TRACKED_FIELDS.filter((field) => !jsonEqual(before[field], profile[field]));
  if (!changedFields.length) return [];
  const protectedChanged = changedFields.filter((field) => PROFILE_PROTECTED_FIELDS.has(field));
  profile.revision += 1;
  if (protectedChanged.length) {
    const sources = { ...(profile.profileSources || {}) };
    const snapshot = { ...(profile.verifiedSnapshot || {}) };
    for (const field of protectedChanged) {
      delete sources[field];
      delete snapshot[field];
    }
    profile.profileSources = sources;
    profile.verifiedSnapshot = snapshot;
    profile.verifiedAt = Object.values(sources)
      .some((source) => source?.verificationLevel === 'document_checked')
      ? profile.verifiedAt
      : null;
    profile.verificationStatus = 'pending';
    profile.operatingStatus = 'suspended';
    profile.isAvailable = false;
  }
  return changedFields;
}

function createProfileImportService({
  storage = defaultStorage,
  parser = createDefaultParser(),
  models = defaultModels,
  clock = () => new Date(),
  quota = profileImportQuota,
  reportException = reportCaughtException,
} = {}) {
  const {
    sequelize,
    LawyerProfile,
    LawyerProfileImport,
    ProfileImportAudit,
    Specialization,
    ObjectCleanupTask,
  } = models;

  function now() {
    const value = new Date(clock());
    if (Number.isNaN(value.getTime())) throw new TypeError('Invalid service clock');
    return value;
  }

  async function withImportAdvisoryLock(importId, operation) {
    const connection = await sequelize.connectionManager.getConnection({ type: 'WRITE' });
    let locked = false;
    try {
      await connection.query(
        'SELECT pg_advisory_lock(hashtextextended($1, 72107))',
        [importId]
      );
      locked = true;
      return await operation();
    } finally {
      if (locked) {
        await connection.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 72107))',
          [importId]
        );
      }
      await sequelize.connectionManager.releaseConnection(connection);
    }
  }

  async function acquireImportTransactionLocks(importIds, transaction) {
    for (const importId of [...importIds].sort()) {
      await sequelize.query(
        'SELECT pg_advisory_xact_lock(hashtextextended(:importId, 72107))',
        { replacements: { importId }, transaction }
      );
    }
  }

  async function uploadImport({ userId, idempotencyKey, file, quotaReservation }) {
    if (!validIdempotencyKey(idempotencyKey)) {
      throw serviceError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key is required');
    }
    if (!quota || typeof quota.consumeReservation !== 'function') {
      throw serviceError(503, 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE');
    }
    quota.consumeReservation(quotaReservation, 'upload', userId);

    const existing = await LawyerProfileImport.findOne({
      where: { userId, uploadIdempotencyKey: idempotencyKey },
    });
    if (existing) return existing;

    if (!await parser.isAvailable()) {
      throw serviceError(503, 'PDF_IMPORT_UNAVAILABLE', 'PDF import unavailable');
    }
    if (!file || !Buffer.isBuffer(file.buffer) || file.size !== file.buffer.length
      || file.mimetype !== 'application/pdf' || file.checksum !== crypto.createHash('sha256').update(file.buffer).digest('hex')) {
      throw serviceError(400, 'INVALID_PDF_UPLOAD', 'Invalid PDF upload');
    }

    const profile = await LawyerProfile.findOne({ where: { userId } });
    if (!profile) throw serviceError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    const createdAt = now();

    try {
      return await storage.putWithCleanupIntent({
        object: {
          key: file.objectKey,
          body: file.buffer,
          contentType: 'application/pdf',
          checksum: file.checksum,
        },
        persist: ({ transaction }) => LawyerProfileImport.create({
          userId,
          source: 'linkedin_pdf',
          status: 'uploaded',
          storageKey: file.objectKey,
          uploadIdempotencyKey: idempotencyKey,
          originalName: String(file.originalname || 'profile.pdf').slice(0, 255),
          mimeType: 'application/pdf',
          size: file.size,
          sha256: file.checksum,
          profileRevision: profile.revision,
          expiresAt: new Date(createdAt.getTime() + DAY_MS),
        }, { transaction }),
      });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const recovered = await LawyerProfileImport.findOne({
          where: { userId, uploadIdempotencyKey: idempotencyKey },
        });
        if (recovered) return recovered;
      }
      throw error;
    }
  }

  async function claimJob(staleAfterMs, currentTime) {
    return sequelize.transaction(async (transaction) => {
      const staleBefore = new Date(currentTime.getTime() - staleAfterMs);
      const row = await LawyerProfileImport.findOne({
        where: {
          [Op.or]: [
            { status: 'uploaded' },
            { status: 'parsing', updatedAt: { [Op.lte]: staleBefore } },
          ],
          expiresAt: { [Op.gt]: currentTime },
        },
        order: [['createdAt', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
        transaction,
      });
      if (!row) return null;
      const claimVersion = row.version + 1;
      await row.update({
        status: 'parsing',
        version: claimVersion,
        updatedAt: currentTime,
      }, { transaction, silent: true });
      return {
        id: row.id,
        userId: row.userId,
        storageKey: row.storageKey,
        size: row.size,
        sha256: row.sha256,
        claimVersion,
      };
    });
  }

  function startClaimHeartbeat(claim, staleAfterMs, controller) {
    const intervalMs = Math.max(250, Math.floor(staleAfterMs / 3));
    let pending = Promise.resolve();
    let stopped = false;
    let failure = null;
    const timer = setInterval(() => {
      if (stopped) return;
      pending = pending.then(() => sequelize.query(`
        UPDATE lawyer_profile_imports
        SET updated_at = :heartbeatAt
        WHERE id = :id AND status = 'parsing' AND version = :version
      `, {
        replacements: {
          heartbeatAt: now(),
          id: claim.id,
          version: claim.claimVersion,
        },
      })).catch((error) => {
        failure = failure || error;
        controller.abort(error);
      });
    }, intervalMs);
    timer.unref();
    return async () => {
      stopped = true;
      clearInterval(timer);
      await pending;
      return failure;
    };
  }

  async function fencedUpdate(claim, values) {
    const [count] = await LawyerProfileImport.update({
      ...values,
      version: claim.claimVersion + 1,
      updatedAt: now(),
    }, {
      where: {
        id: claim.id,
        status: 'parsing',
        version: claim.claimVersion,
      },
      silent: true,
    });
    return count === 1;
  }

  async function verifyStoredObject(claim) {
    const head = await storage.headPrivateObject(claim.storageKey);
    if (Number(head.ContentLength) !== claim.size
      || head.ContentType !== 'application/pdf'
      || String(head.Metadata?.sha256 || '').toLowerCase() !== claim.sha256) {
      throw serviceError(422, 'PROFILE_IMPORT_OBJECT_MISMATCH');
    }
    const body = await storage.readPrivateObjectBuffer(claim.storageKey, claim.size);
    const actualSha = crypto.createHash('sha256').update(body).digest('hex');
    if (body.length !== claim.size || actualSha !== claim.sha256) {
      throw serviceError(422, 'PROFILE_IMPORT_OBJECT_MISMATCH');
    }
    return body;
  }

  async function processImportJobs({
    limit = 10,
    concurrency = Math.min(4, limit),
    staleAfterMs = DEFAULT_STALE_MS,
    signal,
  } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be between 1 and 100');
    }
    if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1000) {
      throw new RangeError('staleAfterMs must be at least 1000');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
      throw new RangeError('concurrency must be between 1 and 4');
    }
    const summary = { claimed: 0, completed: 0, failed: 0, deferred: 0, lost: 0 };
    let claimSlots = 0;

    async function processClaim(claim) {
      const controller = new AbortController();
      const abortFromLease = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abortFromLease, { once: true });
      const stopHeartbeat = startClaimHeartbeat(claim, staleAfterMs, controller);
      let heartbeatStopped = false;
      async function stopAndReadHeartbeat() {
        if (heartbeatStopped) return null;
        heartbeatStopped = true;
        return stopHeartbeat();
      }
      async function requeueAfterHeartbeatFailure() {
        const restored = await fencedUpdate(claim, { status: 'uploaded' });
        summary[restored ? 'deferred' : 'lost'] += 1;
      }
      try {
        if (!await parser.isAvailable()) {
          const restored = await fencedUpdate(claim, { status: 'uploaded' });
          summary[restored ? 'deferred' : 'lost'] += 1;
          return;
        }
        const body = await verifyStoredObject(claim);
        if (controller.signal.aborted) {
          await stopAndReadHeartbeat();
          await requeueAfterHeartbeatFailure();
          return;
        }
        try {
          await quota.consume('parse', claim.userId);
        } catch (error) {
          if ([429, 503].includes(error.status)) {
            const restored = await fencedUpdate(claim, { status: 'uploaded' });
            summary[restored ? 'deferred' : 'lost'] += 1;
            return;
          }
          throw error;
        }
        if (controller.signal.aborted) {
          await stopAndReadHeartbeat();
          await requeueAfterHeartbeatFailure();
          return;
        }
        let result;
        try {
          result = await parser.parse(body, { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted || error.name === 'AbortError' || error.code === 'ABORT_ERR') {
            await stopAndReadHeartbeat();
            await requeueAfterHeartbeatFailure();
            return;
          }
          if (error.status === 503 || error.code === 'PDF_IMPORT_UNAVAILABLE') {
            const restored = await fencedUpdate(claim, { status: 'uploaded' });
            summary[restored ? 'deferred' : 'lost'] += 1;
            return;
          }
          throw error;
        }
        const heartbeatFailure = await stopAndReadHeartbeat();
        if (heartbeatFailure || controller.signal.aborted) {
          await requeueAfterHeartbeatFailure();
          return;
        }
        const cleanData = sanitizeDraft({
          ...result.data,
          specializations: result.data?.specializations || [],
        });
        const completed = await fencedUpdate(claim, {
          status: 'draft',
          parsedData: cleanData,
          acceptedData: null,
          warnings: linkedinParser.sanitizeParserWarnings(result.warnings),
          parserVersion: result.parserVersion,
        });
        summary[completed ? 'completed' : 'lost'] += 1;
      } catch (error) {
        reportException(error, {
          operation: 'profile_import_job',
          importId: claim.id,
          userId: claim.userId,
        });
        if (controller.signal.aborted) {
          await stopAndReadHeartbeat();
          await requeueAfterHeartbeatFailure();
          return;
        }
        const failed = await fencedUpdate(claim, {
          status: 'failed',
          parsedData: null,
          acceptedData: null,
          warnings: [],
        });
        summary[failed ? 'failed' : 'lost'] += 1;
      } finally {
        signal?.removeEventListener('abort', abortFromLease);
        await stopAndReadHeartbeat();
      }
    }

    async function worker() {
      while (claimSlots < limit) {
        if (signal?.aborted) throw Object.assign(new Error('Import parser aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
        claimSlots += 1;
        const claim = await claimJob(staleAfterMs, now());
        if (!claim) return;
        summary.claimed += 1;
        await processClaim(claim);
      }
    }

    await Promise.all(Array.from(
      { length: Math.min(concurrency, limit) },
      () => worker()
    ));
    return summary;
  }

  async function createAudit({ importRow, actorUserId, event, transaction }) {
    const createdAt = now();
    return ProfileImportAudit.create({
      importId: importRow.id,
      ownerUserId: importRow.userId,
      actorUserId,
      event,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + AUDIT_RETENTION_MS),
    }, { transaction });
  }

  async function createFieldAudit({ ownerUserId, actorUserId, importId = null, transaction }) {
    const createdAt = now();
    return ProfileImportAudit.create({
      importId,
      ownerUserId,
      actorUserId,
      event: 'field_verified',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + AUDIT_RETENTION_MS),
    }, { transaction });
  }

  async function getCurrentImport({ userId, idempotencyKey }) {
    if (idempotencyKey !== undefined && !validIdempotencyKey(idempotencyKey)) {
      throw serviceError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key is required');
    }
    const where = { userId, status: { [Op.ne]: 'discarded' } };
    if (idempotencyKey !== undefined) where.uploadIdempotencyKey = idempotencyKey;
    return LawyerProfileImport.findOne({
      where,
      order: [['createdAt', 'DESC']],
    });
  }

  async function getImport({ importId, userId, isAdmin = false, actorUserId }) {
    requireImportId(importId);
    if (isAdmin) {
      return withImportAdvisoryLock(importId, () => sequelize.transaction(async (transaction) => {
        const row = await LawyerProfileImport.findByPk(importId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!row) throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
        await createAudit({ importRow: row, actorUserId, event: 'admin_view', transaction });
        return row.toJSON();
      }));
    }
    const row = await LawyerProfileImport.findByPk(importId);
    if (!row || row.userId !== userId) {
      throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
    }
    return row;
  }

  async function updateDraft({ importId, userId, version, draft }) {
    requireImportId(importId);
    return sequelize.transaction(async (transaction) => {
      const row = await LawyerProfileImport.findOne({
        where: { id: importId, userId },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!row) throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
      const cleanDraft = sanitizeDraft(draft);
      if (row.status !== 'draft') throw serviceError(409, 'IMPORT_STATE_CONFLICT');
      if (row.expiresAt <= now()) throw serviceError(410, 'IMPORT_EXPIRED');
      if (!Number.isInteger(version) || row.version !== version) {
        throw serviceError(409, 'IMPORT_VERSION_CONFLICT', 'Import version conflict', {
          currentVersion: row.version,
        });
      }
      await row.update({ parsedData: cleanDraft, version: row.version + 1 }, { transaction });
      return row;
    });
  }

  async function canonicalSpecializations(values, transaction) {
    const names = sanitizeStringList(values, 12, 120);
    if (!names.length) return [];
    const rows = await Specialization.findAll({
      where: { name: { [Op.in]: names }, isActive: true },
      attributes: ['name'],
      transaction,
    });
    const found = new Set(rows.map((row) => row.name));
    if (names.some((name) => !found.has(name))) {
      throw serviceError(400, 'INVALID_SPECIALIZATION');
    }
    return names;
  }

  async function confirmImport({ importId, userId, version, acceptedPaths, profileRevision }) {
    requireImportId(importId);
    const owned = await LawyerProfileImport.findByPk(importId, { attributes: ['id', 'userId'] });
    if (!owned || owned.userId !== userId) {
      throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
    }
    if (!Array.isArray(acceptedPaths) || acceptedPaths.length > ACCEPTED_PATHS.size
      || new Set(acceptedPaths).size !== acceptedPaths.length
      || acceptedPaths.some((path) => typeof path !== 'string' || !ACCEPTED_PATHS.has(path))) {
      throw serviceError(400, 'INVALID_ACCEPTED_PATHS');
    }
    return sequelize.transaction(async (transaction) => {
      const profile = await LawyerProfile.findOne({
        where: { userId },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!profile) throw serviceError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      const row = await LawyerProfileImport.findOne({
        where: { id: importId, userId },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!row) throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');

      if (row.status === 'confirmed') {
        if (row.confirmedFromVersion === version) {
          return { importRow: row, profile };
        }
        throw serviceError(409, 'IMPORT_ALREADY_CONFIRMED');
      }
      if (row.status !== 'draft') throw serviceError(409, 'IMPORT_STATE_CONFLICT');
      const currentTime = now();
      if (row.expiresAt <= currentTime) throw serviceError(410, 'IMPORT_EXPIRED');
      if (!Number.isInteger(version) || row.version !== version) {
        throw serviceError(409, 'IMPORT_VERSION_CONFLICT', 'Import version conflict', {
          currentVersion: row.version,
        });
      }
      const reviewedProfileRevision = profileRevision === undefined
        ? row.profileRevision
        : Number(profileRevision);
      if (!Number.isInteger(reviewedProfileRevision) || reviewedProfileRevision < 1) {
        throw serviceError(400, 'PROFILE_REVISION_REQUIRED');
      }
      if (profile.revision !== reviewedProfileRevision) {
        throw serviceError(409, 'PROFILE_REVISION_CONFLICT', 'Profile changed after upload', {
          currentProfileRevision: profile.revision,
        });
      }

      const draft = sanitizeDraft(row.parsedData || {});
      const acceptedData = {};
      const mapping = {
        headline: 'headline',
        summary: 'description',
        positions: 'workExperience',
        education: 'education',
        languages: 'languages',
        certificates: 'certificates',
        specializations: 'specializations',
      };
      const protectedFields = new Set(['workExperience', 'education', 'certificates', 'specializations']);
      const sources = { ...(profile.profileSources || {}) };
      const snapshot = { ...(profile.verifiedSnapshot || {}) };
      let changed = false;
      let protectedChanged = false;

      for (const path of acceptedPaths) {
        let value = draft[path];
        if (path === 'specializations') value = await canonicalSpecializations(value, transaction);
        acceptedData[path] = value;
        const field = mapping[path];
        if (jsonEqual(profile[field], value)) continue;
        profile[field] = value;
        if (field === 'specializations') profile.specialization = value[0] || null;
        sources[field] = {
          source: 'linkedin_pdf',
          verificationLevel: 'self_reported',
          importId: row.id,
          importedAt: currentTime.toISOString(),
        };
        delete snapshot[field];
        changed = true;
        if (protectedFields.has(field)) protectedChanged = true;
      }

      if (changed) {
        profile.profileSources = sources;
        profile.verifiedSnapshot = snapshot;
        profile.verifiedAt = Object.values(sources)
          .some((source) => source?.verificationLevel === 'document_checked')
          ? profile.verifiedAt
          : null;
        profile.revision += 1;
        if (protectedChanged) {
          profile.verificationStatus = 'pending';
          profile.operatingStatus = 'suspended';
          profile.isAvailable = false;
        }
        await profile.save({ transaction });
      }
      await row.update({
        status: 'confirmed',
        acceptedData,
        confirmedFromVersion: version,
        confirmedAt: currentTime,
        expiresAt: new Date(currentTime.getTime() + CONFIRMED_RETENTION_MS),
        version: row.version + 1,
      }, { transaction });
      return { importRow: row, profile };
    });
  }

  async function createCleanupTask(importRow, transaction) {
    const existing = await ObjectCleanupTask.findOne({
      where: {
        storageKey: importRow.storageKey,
        provider: 'r2',
      },
      order: [['createdAt', 'DESC']],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (existing) {
      const protectedTask = existing.requiresOwnershipProof && existing.ownershipToken;
      return existing.update({
        status: protectedTask ? 'pending' : 'manual_review',
        attempts: 0,
        lastError: protectedTask ? null : 'OWNERSHIP_PROOF_MISSING',
        nextAttemptAt: protectedTask ? now() : null,
        leaseToken: null,
        leaseExpiresAt: null,
        preventsKeyReuse: true,
      }, { transaction });
    }
    return ObjectCleanupTask.create({
      storageKey: importRow.storageKey,
      provider: 'r2',
      status: 'manual_review',
      attempts: 0,
      lastError: 'OWNERSHIP_PROOF_MISSING',
      nextAttemptAt: null,
      preventsKeyReuse: true,
    }, { transaction });
  }

  async function discardImportRow(importRow, { event, actorUserId, transaction }) {
    await createCleanupTask(importRow, transaction);
    await createAudit({ importRow, actorUserId, event, transaction });
    await importRow.destroy({ transaction });
    return true;
  }

  async function deleteImport({ importId, userId }) {
    requireImportId(importId);
    return withImportAdvisoryLock(importId, () => sequelize.transaction(async (transaction) => {
      const row = await LawyerProfileImport.findOne({
        where: { id: importId, userId },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });
      if (!row) {
        const priorDelete = await ProfileImportAudit.findOne({
          where: { importId, ownerUserId: userId, event: 'owner_delete' },
          transaction,
        });
        if (priorDelete) return null;
        throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
      }
      await discardImportRow(row, {
        event: 'owner_delete',
        actorUserId: userId,
        transaction,
      });
      return row;
    }));
  }

  async function downloadImport({ importId, userId, isAdmin = false, actorUserId, consume }) {
    requireImportId(importId);
    if (typeof consume !== 'function') throw new TypeError('Download consumer is required');
    return withImportAdvisoryLock(importId, async () => {
      const snapshot = await sequelize.transaction(async (transaction) => {
        const row = await LawyerProfileImport.findByPk(importId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!row || row.status === 'discarded' || (!isAdmin && row.userId !== userId)) {
          throw serviceError(404, 'IMPORT_NOT_FOUND', 'Import not found');
        }
        if (isAdmin) {
          await createAudit({ importRow: row, actorUserId, event: 'admin_download', transaction });
        }
        return { storageKey: row.storageKey };
      });
      return storage.withPrivateObjectStream(snapshot.storageKey, consume);
    });
  }

  async function processRetentionJobs({ limit = 25, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError('limit must be between 1 and 100');
    }
    if (signal?.aborted) throw Object.assign(new Error('Import retention aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
    const currentTime = now();
    return sequelize.transaction(async (transaction) => {
      const retentionWhere = {
          [Op.or]: [
            {
              status: { [Op.in]: ['uploaded', 'parsing', 'draft', 'failed'] },
              expiresAt: { [Op.lte]: currentTime },
            },
            {
              status: 'confirmed',
              confirmedAt: { [Op.lte]: new Date(currentTime.getTime() - CONFIRMED_RETENTION_MS) },
            },
          ],
        };
      const candidates = await LawyerProfileImport.findAll({
        where: retentionWhere,
        attributes: ['id'],
        order: [['createdAt', 'ASC']],
        limit,
        transaction,
      });
      const ids = candidates.map((row) => row.id);
      await acquireImportTransactionLocks(ids, transaction);
      const rows = ids.length ? await LawyerProfileImport.findAll({
        where: { id: { [Op.in]: ids }, ...retentionWhere },
        order: [['id', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction,
      }) : [];
      let discarded = 0;
      for (const row of rows) {
        if (signal?.aborted) throw Object.assign(new Error('Import retention aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
        if (await discardImportRow(row, {
          event: 'retention_cleanup',
          actorUserId: null,
          transaction,
        })) discarded += 1;
      }
      return { claimed: rows.length, discarded };
    });
  }

  async function redactReviewedImports({ userId, transaction }) {
      const candidates = await LawyerProfileImport.findAll({
        where: { userId, status: 'confirmed' },
        attributes: ['id'],
        order: [['id', 'ASC']],
        transaction,
      });
      const ids = candidates.map((row) => row.id);
      await acquireImportTransactionLocks(ids, transaction);
      const rows = ids.length ? await LawyerProfileImport.findAll({
        where: { id: { [Op.in]: ids }, userId, status: 'confirmed' },
        order: [['id', 'ASC']],
        lock: transaction.LOCK.UPDATE,
        transaction,
      }) : [];
      let discarded = 0;
      for (const row of rows) {
        if (await discardImportRow(row, {
          event: 'profile_review_cleanup',
          actorUserId: null,
          transaction,
        })) discarded += 1;
      }
      return discarded;
  }

  async function scheduleReviewedImportCleanup({ userId, transaction }) {
    if (transaction) {
      return redactReviewedImports({ userId, transaction });
    }
    return sequelize.transaction((recoveryTransaction) => redactReviewedImports({
      userId,
      transaction: recoveryTransaction,
    }));
  }

  async function processAuditRetentionJobs({ limit = 100, signal } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('limit must be between 1 and 1000');
    }
    if (signal?.aborted) throw Object.assign(new Error('Import audit retention aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
    return sequelize.transaction(async (transaction) => {
      const rows = await ProfileImportAudit.findAll({
        where: { expiresAt: { [Op.lte]: now() } },
        attributes: ['id'],
        order: [['expiresAt', 'ASC']],
        limit,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
        transaction,
      });
      if (!rows.length) return 0;
      return ProfileImportAudit.destroy({
        where: { id: { [Op.in]: rows.map((row) => row.id) } },
        transaction,
      });
    });
  }

  async function verifyProfileField({ userId, field, documentId, reviewerUserId }) {
    const compatibleTypes = {
      experience: ['license'],
      workExperience: ['license'],
      education: ['diploma'],
      certificates: ['diploma', 'license', 'other'],
    };
    if (!Object.hasOwn(compatibleTypes, field)) {
      throw serviceError(400, 'INVALID_VERIFICATION_FIELD');
    }
    return sequelize.transaction(async (transaction) => {
      const profile = await LawyerProfile.findOne({
        where: { userId }, lock: transaction.LOCK.UPDATE, transaction,
      });
      if (!profile) throw serviceError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
      const document = await models.LawyerDocument.findOne({
        where: { id: documentId, userId }, lock: transaction.LOCK.UPDATE, transaction,
      });
      if (!document
        || document.verificationStatus !== 'approved'
        || !document.approvedByUserId
        || !document.approvedAt
        || !compatibleTypes[field].includes(document.type)) {
        throw serviceError(400, 'INCOMPATIBLE_VERIFICATION_DOCUMENT');
      }
      const verifiedAt = now();
      const previousSource = profile.profileSources?.[field] || {};
      const sources = {
        ...(profile.profileSources || {}),
        [field]: {
          source: 'supporting_document',
          verificationLevel: 'document_checked',
          documentId: document.id,
          reviewedByUserId: reviewerUserId,
          verifiedAt: verifiedAt.toISOString(),
          ...(previousSource.importId ? { importId: previousSource.importId } : {}),
        },
      };
      profile.profileSources = sources;
      profile.verifiedSnapshot = {
        ...(profile.verifiedSnapshot || {}),
        [field]: profile[field],
      };
      profile.verifiedAt = verifiedAt;
      await profile.save({ transaction });
      await createFieldAudit({
        ownerUserId: userId,
        actorUserId: reviewerUserId,
        importId: previousSource.importId || null,
        transaction,
      });
      return profile;
    });
  }

  async function invalidateDocumentProvenance({ userId, documentId, transaction, lockedProfile }) {
    const profile = lockedProfile || await LawyerProfile.findOne({
      where: { userId }, lock: transaction.LOCK.UPDATE, transaction,
    });
    if (!profile) return [];
    const sources = { ...(profile.profileSources || {}) };
    const snapshot = { ...(profile.verifiedSnapshot || {}) };
    const invalidated = Object.entries(sources)
      .filter(([, source]) => source?.verificationLevel === 'document_checked'
        && source.documentId === documentId)
      .map(([field]) => field);
    if (!invalidated.length) return [];
    for (const field of invalidated) {
      delete sources[field];
      delete snapshot[field];
    }
    profile.profileSources = sources;
    profile.verifiedSnapshot = snapshot;
    profile.verifiedAt = Object.values(sources)
      .some((source) => source?.verificationLevel === 'document_checked')
      ? profile.verifiedAt
      : null;
    profile.revision += 1;
    profile.verificationStatus = 'pending';
    profile.operatingStatus = 'suspended';
    profile.isAvailable = false;
    await profile.save({ transaction });
    return invalidated;
  }

  return {
    uploadImport,
    processImportJobs,
    getCurrentImport,
    getImport,
    updateDraft,
    confirmImport,
    createAudit,
    deleteImport,
    downloadImport,
    processRetentionJobs,
    scheduleReviewedImportCleanup,
    processAuditRetentionJobs,
    verifyProfileField,
    invalidateDocumentProvenance,
  };
}

function abortIfRequested(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Import job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
}

async function runImportParserOnce(_now = new Date(), {
  signal, limit = 10, concurrency = 4, service = getDefaultService(),
} = {}) {
  abortIfRequested(signal);
  return service.processImportJobs({ limit, concurrency, signal });
}

async function runImportRetentionOnce(_now = new Date(), {
  signal, limit = 25, service = getDefaultService(),
} = {}) {
  abortIfRequested(signal);
  return service.processRetentionJobs({ limit, signal });
}

async function runImportAuditRetentionOnce(_now = new Date(), {
  signal, limit = 100, service = getDefaultService(),
} = {}) {
  abortIfRequested(signal);
  return service.processAuditRetentionJobs({ limit, signal });
}

let defaultService;

function getDefaultService() {
  if (!defaultService) defaultService = createProfileImportService();
  return defaultService;
}

module.exports = {
  createProfileImportService,
  uploadImport: (...args) => getDefaultService().uploadImport(...args),
  processImportJobs: (...args) => getDefaultService().processImportJobs(...args),
  getCurrentImport: (...args) => getDefaultService().getCurrentImport(...args),
  getImport: (...args) => getDefaultService().getImport(...args),
  updateDraft: (...args) => getDefaultService().updateDraft(...args),
  confirmImport: (...args) => getDefaultService().confirmImport(...args),
  deleteImport: (...args) => getDefaultService().deleteImport(...args),
  downloadImport: (...args) => getDefaultService().downloadImport(...args),
  processRetentionJobs: (...args) => getDefaultService().processRetentionJobs(...args),
  scheduleReviewedImportCleanup: (...args) => getDefaultService().scheduleReviewedImportCleanup(...args),
  processAuditRetentionJobs: (...args) => getDefaultService().processAuditRetentionJobs(...args),
  runImportParserOnce,
  runImportRetentionOnce,
  runImportAuditRetentionOnce,
  verifyProfileField: (...args) => getDefaultService().verifyProfileField(...args),
  invalidateDocumentProvenance: (...args) => getDefaultService().invalidateDocumentProvenance(...args),
  serviceError,
  sanitizeDraft,
  serializeImport,
  profileFieldSnapshot,
  applyManualProfileChangePolicy,
  DAY_MS,
  DEFAULT_STALE_MS,
};
