'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^(avatars|documents|case-documents|lawyer-documents|profile-imports|legacy|ai-temp)\/[A-Za-z0-9._/-]{1,1000}$/;

function sample(limit) {
  return {
    count: 0,
    items: [],
    add(item) {
      this.count += 1;
      if (this.items.length < limit) this.items.push(item);
    },
  };
}

function validateObjectEntry(object) {
  const lastModified = object?.lastModified;
  const validLastModifiedType = lastModified instanceof Date
    || (typeof lastModified === 'string' && lastModified.length > 0)
    || (typeof lastModified === 'number' && Number.isFinite(lastModified));
  return Boolean(object && typeof object === 'object'
    && typeof object.key === 'string'
    && KEY_PATTERN.test(object.key)
    && !object.key.split('/').some((part) => !part || part === '.' || part === '..')
    && Number.isInteger(object.size)
    && object.size >= 0
    && validLastModifiedType
    && Number.isFinite(new Date(lastModified).getTime()));
}

function createPostgresReferenceIndex(database) {
  let connection;
  const table = `storage_reconcile_${crypto.randomBytes(8).toString('hex')}`;
  const candidates = `${table}_candidates`;
  async function query(sql, values = []) {
    return connection.query(sql, values);
  }
  return {
    async initialize() {
      connection = await database.connectionManager.getConnection({ type: 'WRITE' });
      await query(`CREATE TEMP TABLE ${table} (
        storage_key TEXT PRIMARY KEY,
        domain TEXT,
        record_id TEXT,
        expected_size BIGINT,
        expected_sha CHAR(64),
        expected_mime TEXT,
        protected BOOLEAN NOT NULL DEFAULT FALSE,
        seen BOOLEAN NOT NULL DEFAULT FALSE
      ) ON COMMIT PRESERVE ROWS`);
      await query(`CREATE TEMP TABLE ${candidates} (
        storage_key TEXT PRIMARY KEY,
        object_size BIGINT NOT NULL
      ) ON COMMIT PRESERVE ROWS`);
    },
    async upsertBatch(rows) {
      if (!rows.length) return [];
      const values = [];
      const tuples = rows.map((row, index) => {
        const offset = index * 7;
        values.push(row.key, row.domain || null, row.id ? String(row.id) : null,
          Number.isInteger(row.size) ? row.size : null, row.sha256 || null, row.mimeType || null,
          Boolean(row.protected));
        return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`;
      });
      await query(`INSERT INTO ${table}
        (storage_key, domain, record_id, expected_size, expected_sha, expected_mime, protected)
        VALUES ${tuples.join(',')}
        ON CONFLICT (storage_key) DO NOTHING`, values);
      const keys = [...new Set(rows.map((row) => row.key))];
      const result = await query(`SELECT storage_key AS key, domain, record_id AS id,
        expected_size AS size, expected_sha AS sha256, expected_mime AS "mimeType"
        FROM ${table} WHERE storage_key = ANY($1::text[])`, [keys]);
      const existingByKey = new Map(result.rows.map((row) => [row.key, {
        ...row, size: row.size === null ? null : Number(row.size),
      }]));
      const conflicts = [];
      const exactProtectedKeys = [];
      for (const row of rows) {
        const existing = existingByKey.get(row.key);
        const exact = ['domain', 'id', 'size', 'sha256', 'mimeType'].every((field) => (
          (existing?.[field] ?? null) === (row[field] ?? null)
        ));
        if (!exact) conflicts.push({ key: row.key, domain: row.domain, id: row.id });
        else if (row.protected) exactProtectedKeys.push(row.key);
      }
      if (exactProtectedKeys.length) {
        await query(`UPDATE ${table} SET protected=TRUE WHERE storage_key = ANY($1::text[])`,
          [[...new Set(exactProtectedKeys)]]);
      }
      return conflicts;
    },
    async find(key) {
      const result = await query(`SELECT storage_key AS key, domain, record_id AS id,
        expected_size AS size, expected_sha AS sha256, expected_mime AS "mimeType", protected
        FROM ${table} WHERE storage_key=$1`, [key]);
      const row = result.rows[0];
      if (row?.size !== null && row?.size !== undefined) row.size = Number(row.size);
      return row || null;
    },
    async markSeen(key) { await query(`UPDATE ${table} SET seen=TRUE WHERE storage_key=$1`, [key]); },
    async missingBatch({ afterKey, limit }) {
      const result = await query(`SELECT storage_key AS key, domain, record_id AS id
        FROM ${table} WHERE seen=FALSE AND protected=FALSE AND storage_key > $1
        ORDER BY storage_key ASC LIMIT $2`, [afterKey || '', limit]);
      return result.rows;
    },
    async addCandidateBatch(rows) {
      if (!rows.length) return;
      const values = [];
      const tuples = rows.map((row, index) => {
        values.push(row.key, row.size);
        return `($${index * 2 + 1},$${index * 2 + 2})`;
      });
      await query(`INSERT INTO ${candidates} (storage_key, object_size) VALUES ${tuples.join(',')}
        ON CONFLICT (storage_key) DO NOTHING`, values);
    },
    async candidateBatch({ afterKey, limit }) {
      const result = await query(`SELECT storage_key AS key, object_size AS size FROM ${candidates}
        WHERE storage_key > $1 ORDER BY storage_key ASC LIMIT $2`, [afterKey || '', limit]);
      return result.rows.map((row) => ({ ...row, size: Number(row.size) }));
    },
    async close() {
      if (!connection) return;
      try {
        await query(`DROP TABLE IF EXISTS ${candidates}`);
        await query(`DROP TABLE IF EXISTS ${table}`);
      } finally {
        await database.connectionManager.releaseConnection(connection);
        connection = null;
      }
    },
  };
}

async function reconcileObjectStorage({
  domains = [], cleanupDomain, referenceIndex, objectStorage, scheduleCleanup,
  scheduleDeletion = false, now = new Date(), safetyMs = DAY_MS, pageSize = 500,
  dbBatchSize = 500, maxPages = 10000, maxDbRows = 1000000, reportLimit = 100, signal,
} = {}) {
  if (!objectStorage || typeof objectStorage.listPrivateObjects !== 'function') {
    throw new TypeError('Object storage list boundary is required');
  }
  if (!referenceIndex) throw new TypeError('Bounded reference index is required');
  for (const [value, min, max, name] of [
    [pageSize, 1, 1000, 'pageSize'], [dbBatchSize, 1, 500, 'dbBatchSize'],
    [maxPages, 1, 100000, 'maxPages'], [maxDbRows, 1, 10000000, 'maxDbRows'],
    [reportLimit, 1, 1000, 'reportLimit'],
  ]) if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} is invalid`);

  const currentTime = new Date(now);
  const report = {
    ready: true, scannedReferences: 0, scannedObjects: 0, pages: 0,
    missing: sample(reportLimit), sizeMismatch: sample(reportLimit), shaMismatch: sample(reportLimit),
    referenceConflict: sample(reportLimit),
    retained: sample(reportLimit), legacyOnly: sample(reportLimit), manualReview: sample(reportLimit),
    failed: sample(reportLimit), orphans: sample(reportLimit), expiredTemp: sample(reportLimit),
    invalidProvider: sample(reportLimit), tempExcluded: 0, youngExcluded: 0, scheduled: 0,
    paginationBlocked: false,
  };
  const snapshotAt = currentTime;

  async function loadDomain(domain, cleanup = false) {
    if (!domain) return;
    let cursor = null;
    while (true) {
      if (signal?.aborted) throw Object.assign(new Error('Reconciliation aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
      const rows = await domain.listReferenceBatch({ cursor, limit: dbBatchSize, snapshotAt });
      if (!Array.isArray(rows)) throw new TypeError('Reference batch must be an array');
      if (!rows.length) break;
      report.scannedReferences += rows.length;
      if (report.scannedReferences > maxDbRows) {
        throw Object.assign(new Error('Reconciliation row limit exceeded'), { code: 'RECONCILIATION_ROW_LIMIT' });
      }
      const keyed = [];
      for (const row of rows) {
        if (cleanup) {
          if (row.status === 'manual_review') report.manualReview.add({ id: row.id });
          if (row.status === 'failed') report.failed.add({ id: row.id });
        } else {
          if (!row.key && row.legacyOnlyPath) report.legacyOnly.add({ domain: domain.name, id: row.id });
          if (row.key && row.retainedPath) report.retained.add({ domain: domain.name, id: row.id });
        }
        if (row.key) keyed.push({ domain: domain.name, ...row });
      }
      const conflicts = await referenceIndex.upsertBatch(keyed);
      for (const conflict of conflicts || []) report.referenceConflict.add(conflict);
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
      if (rows.length < dbBatchSize) break;
    }
  }

  try {
    await referenceIndex.initialize();
    for (const domain of domains) await loadDomain(domain);
    await loadDomain(cleanupDomain, true);

    const seenTokens = new Set();
    let continuationToken;
    while (true) {
      if (signal?.aborted) throw Object.assign(new Error('Reconciliation aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
      if (report.pages >= maxPages) {
        report.paginationBlocked = true;
        break;
      }
      const page = await objectStorage.listPrivateObjects({ continuationToken, maxKeys: pageSize, signal });
      report.pages += 1;
      if (!page || !Array.isArray(page.objects) || page.objects.length > pageSize) {
        report.invalidProvider.add({ reason: 'INVALID_PAGE' });
        break;
      }
      const candidates = [];
      for (const object of page.objects) {
        report.scannedObjects += 1;
        if (!validateObjectEntry(object)) {
          report.invalidProvider.add({ reason: 'INVALID_OBJECT_ENTRY' });
          continue;
        }
        const reference = await referenceIndex.find(object.key);
        if (reference) {
          await referenceIndex.markSeen(object.key);
          if (Number.isInteger(reference.size) && object.size !== reference.size) {
            report.sizeMismatch.add({ domain: reference.domain, id: reference.id });
          }
          if (reference.sha256) {
            const head = await objectStorage.headPrivateObject(object.key, { signal });
            if (head.Metadata?.sha256 !== reference.sha256) {
              report.shaMismatch.add({ domain: reference.domain, id: reference.id });
            }
          }
          continue;
        }
        const age = currentTime.getTime() - new Date(object.lastModified).getTime();
        if (object.key.startsWith('ai-temp/')) {
          if (age >= DAY_MS) {
            report.expiredTemp.add({ key: object.key });
            candidates.push({ key: object.key, size: object.size });
          }
          else report.tempExcluded += 1;
        } else if (age < safetyMs) report.youngExcluded += 1;
        else {
          report.orphans.add({ key: object.key, size: object.size });
          candidates.push({ key: object.key, size: object.size });
        }
      }
      await referenceIndex.addCandidateBatch(candidates);
      const next = page.nextContinuationToken;
      if (page.isTruncated === true && !next) {
        report.paginationBlocked = true;
        break;
      }
      if (!next) break;
      if (typeof next !== 'string' || next.length > 2048 || seenTokens.has(next)) {
        report.paginationBlocked = true;
        break;
      }
      seenTokens.add(next);
      continuationToken = next;
    }

    let afterKey = '';
    while (true) {
      if (signal?.aborted) throw Object.assign(new Error('Reconciliation aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
      const rows = await referenceIndex.missingBatch({ afterKey, limit: dbBatchSize });
      for (const row of rows) report.missing.add({ domain: row.domain, id: row.id });
      if (rows.length < dbBatchSize) break;
      afterKey = rows[rows.length - 1].key;
    }

    if (scheduleDeletion) {
      if (typeof scheduleCleanup !== 'function') throw new TypeError('Cleanup scheduler is required');
      if (!report.paginationBlocked && report.invalidProvider.count === 0
        && report.referenceConflict.count === 0) {
        let afterKey = '';
        while (true) {
          if (signal?.aborted) throw Object.assign(new Error('Reconciliation aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
          const candidates = await referenceIndex.candidateBatch({ afterKey, limit: dbBatchSize });
          for (const candidate of candidates) {
            const head = await objectStorage.headPrivateObject(candidate.key, { signal });
            await scheduleCleanup({
              storageKey: candidate.key, provider: 'r2',
              ownershipToken: head.Metadata?.cleanupIntentId || head.Metadata?.cleanupintentid || null,
            });
            report.scheduled += 1;
          }
          if (candidates.length < dbBatchSize) break;
          afterKey = candidates[candidates.length - 1].key;
        }
      }
    }
  } finally {
    await referenceIndex.close();
  }
  report.ready = !report.paginationBlocked && [
    report.missing, report.sizeMismatch, report.shaMismatch, report.legacyOnly,
    report.referenceConflict, report.manualReview, report.failed, report.orphans,
    report.expiredTemp, report.invalidProvider,
  ].every((entry) => entry.count === 0);
  return report;
}

function createModelDomain(name, model, fields = {}) {
  const key = fields.key || 'storageKey';
  const size = fields.size || 'size';
  const sha = fields.sha || 'sha256';
  const mime = fields.mime || 'mimeType';
  const path = fields.path || 'path';
  return {
    name,
    async listReferenceBatch({ cursor, limit, snapshotAt }) {
      const rows = await model.findAll({
        where: {
          createdAt: { [Op.lte]: snapshotAt },
          ...(cursor ? { [Op.or]: [
            { createdAt: { [Op.gt]: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
          ] } : {}),
        },
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit, raw: true,
      });
      return rows.map((row) => ({
        id: row.id, createdAt: row.createdAt, key: row[key], size: row[size], sha256: row[sha],
        mimeType: row[mime],
        legacyOnlyPath: !row[key] ? row[path] || null : null,
        retainedPath: row[key] ? row[path] || null : null,
      }));
    },
  };
}

function createDefaultInventory(models = require('../models')) {
  const users = {
    name: 'users',
    async listReferenceBatch({ cursor, limit, snapshotAt }) {
      const rows = await models.User.findAll({
        where: {
          createdAt: { [Op.lte]: snapshotAt },
          ...(cursor ? { [Op.or]: [
            { createdAt: { [Op.gt]: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
          ] } : {}),
        },
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit, raw: true,
      });
      return rows.map((row) => {
        const localPath = row.avatarLocalPath
          || (/^\/uploads\//.test(row.avatar || '') ? row.avatar : null);
        return {
          id: row.id, createdAt: row.createdAt, key: row.avatarStorageKey,
          size: row.avatarSize, sha256: row.avatarSha256, mimeType: row.avatarMimeType,
          legacyOnlyPath: !row.avatarStorageKey ? localPath : null,
          retainedPath: row.avatarStorageKey ? localPath : null,
        };
      });
    },
  };
  const cleanupDomain = {
    name: 'cleanup',
    async listReferenceBatch({ cursor, limit, snapshotAt }) {
      const rows = await models.ObjectCleanupTask.findAll({
        where: {
          createdAt: { [Op.lte]: snapshotAt },
          [Op.and]: [
            { [Op.or]: [
              { status: { [Op.in]: ['reserved', 'pending', 'processing', 'failed', 'manual_review'] } },
              { preventsKeyReuse: true },
            ] },
            ...(cursor ? [{ [Op.or]: [
              { createdAt: { [Op.gt]: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
            ] }] : []),
          ],
        },
        attributes: ['id', 'createdAt', 'storageKey', 'status', 'preventsKeyReuse'],
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit, raw: true,
      });
      return rows.map((row) => ({
        id: row.id, createdAt: row.createdAt, key: row.storageKey,
        status: row.status, protected: true,
      }));
    },
  };
  return {
    domains: [
      users,
      createModelDomain('documents', models.Document),
      createModelDomain('case', models.CaseDocument),
      createModelDomain('lawyer', models.LawyerDocument),
      createModelDomain('imports', models.LawyerProfileImport, { path: '__noLegacyPath' }),
    ],
    cleanupDomain,
    referenceIndex: createPostgresReferenceIndex(models.sequelize),
  };
}

async function main(argv = process.argv.slice(2)) {
  const scheduleDeletion = argv.includes('--schedule-deletion');
  const inventory = createDefaultInventory();
  const cleanupService = require('../services/objectCleanupTaskService');
  const report = await reconcileObjectStorage({
    ...inventory, objectStorage: require('../services/objectStorage'),
    scheduleCleanup: cleanupService.scheduleObjectCleanup, scheduleDeletion,
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ready) process.exitCode = 1;
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Object storage reconciliation failed: ${error.code || error.name || 'ERROR'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  reconcileObjectStorage, createPostgresReferenceIndex, createModelDomain, createDefaultInventory,
  validateObjectEntry, main,
};
