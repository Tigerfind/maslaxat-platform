'use strict';

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Op } = require('sequelize');

const CHECKPOINT_SCHEMA_VERSION = 1;
const DEFAULT_CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function checkpointError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createCheckpointEnvelope(payload, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new TypeError('Checkpoint HMAC secret must be at least 32 characters');
  return {
    payload,
    signature: crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex'),
  };
}

function validCheckpointPayload(payload) {
  return payload?.schemaVersion === CHECKPOINT_SCHEMA_VERSION
    && typeof payload.environment === 'string' && payload.environment.length > 0
    && typeof payload.databaseFingerprint === 'string' && payload.databaseFingerprint.length > 0
    && typeof payload.uploadRoot === 'string' && path.isAbsolute(payload.uploadRoot)
    && Array.isArray(payload.domainOrder) && payload.domainOrder.length > 0
    && payload.domainOrder.every((name) => typeof name === 'string' && name.length > 0)
    && new Set(payload.domainOrder).size === payload.domainOrder.length
    && ['apply', 'dry-run'].includes(payload.mode)
    && !Number.isNaN(new Date(payload.snapshotAt).getTime())
    && Number.isInteger(payload.domainIndex) && payload.domainIndex >= 0
    && payload.domainIndex <= payload.domainOrder.length
    && (payload.cursor === null || (typeof payload.cursor?.id === 'string'
      && !Number.isNaN(new Date(payload.cursor.createdAt).getTime())))
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.runId || '');
}

async function readCheckpoint(checkpointPath, {
  secret, expected = {}, now = new Date(), maxAgeMs = DEFAULT_CHECKPOINT_MAX_AGE_MS,
} = {}) {
  let envelope;
  try {
    envelope = JSON.parse(await fsPromises.readFile(checkpointPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw checkpointError('INVALID_MIGRATION_CHECKPOINT', 'Migration checkpoint is unreadable');
  }
  if (!envelope || typeof envelope !== 'object' || !envelope.payload || typeof envelope.signature !== 'string') {
    throw checkpointError('INVALID_MIGRATION_CHECKPOINT', 'Migration checkpoint envelope is invalid');
  }
  const actual = crypto.createHmac('sha256', secret).update(JSON.stringify(envelope.payload)).digest('hex');
  const supplied = Buffer.from(envelope.signature, 'hex');
  const calculated = Buffer.from(actual, 'hex');
  if (supplied.length !== calculated.length || !crypto.timingSafeEqual(supplied, calculated)
    || !validCheckpointPayload(envelope.payload)) {
    throw checkpointError('INVALID_MIGRATION_CHECKPOINT', 'Migration checkpoint signature is invalid');
  }
  const payload = envelope.payload;
  const bindingFields = ['environment', 'databaseFingerprint', 'uploadRoot', 'mode'];
  const mismatch = bindingFields.some((field) => expected[field] !== undefined && payload[field] !== expected[field])
    || (expected.domainOrder && JSON.stringify(payload.domainOrder) !== JSON.stringify(expected.domainOrder));
  if (mismatch) throw checkpointError('MIGRATION_CHECKPOINT_MISMATCH', 'Migration checkpoint binding mismatch');
  const snapshotAt = new Date(payload.snapshotAt);
  if (Number.isNaN(snapshotAt.getTime())
    || snapshotAt.getTime() - new Date(now).getTime() > 5 * 60 * 1000
    || new Date(now).getTime() - snapshotAt.getTime() > maxAgeMs) {
    throw checkpointError('STALE_MIGRATION_CHECKPOINT', 'Migration checkpoint snapshot is stale');
  }
  return payload;
}

async function writeCheckpoint(checkpointPath, payload, secret) {
  await fsPromises.mkdir(path.dirname(checkpointPath), { recursive: true });
  const tempPath = `${checkpointPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fsPromises.writeFile(tempPath, JSON.stringify(createCheckpointEnvelope(payload, secret)), { mode: 0o600 });
    await fsPromises.rename(tempPath, checkpointPath);
  } finally {
    await fsPromises.rm(tempPath, { force: true });
  }
}

async function hashHandle(handle) {
  const sha = crypto.createHash('sha256');
  const md5 = crypto.createHash('md5');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);
    sha.update(chunk);
    md5.update(chunk);
    position += bytesRead;
  }
  return { size: position, sha256: sha.digest('hex'), contentMD5: md5.digest('base64') };
}

function contentTypeFor(row) {
  if (/^[\w.+-]+\/[\w.+-]+$/.test(row.mimeType || '')) return row.mimeType;
  return ({
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
  })[path.extname(row.path || '').toLowerCase()] || 'application/octet-stream';
}

async function openSource(uploadRoot, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath) throw checkpointError('INVALID_SOURCE_PATH', 'Legacy source path is invalid');
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) throw checkpointError('LOCAL_NOFOLLOW_UNAVAILABLE', 'O_NOFOLLOW is unavailable');
  const mapped = sourcePath.startsWith('/uploads/')
    ? path.join(uploadRoot, sourcePath.slice('/uploads/'.length))
    : (path.isAbsolute(sourcePath) ? sourcePath : path.join(uploadRoot, sourcePath));
  const parent = await fsPromises.realpath(path.dirname(mapped));
  if (parent !== uploadRoot && !parent.startsWith(`${uploadRoot}${path.sep}`)) {
    throw checkpointError('UNSAFE_LEGACY_PATH', 'Legacy path escapes the upload root');
  }
  const target = path.join(parent, path.basename(mapped));
  const handle = await fsPromises.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let stat;
  try {
    stat = await handle.stat();
    const resolvedTarget = await fsPromises.realpath(target);
    if ((!resolvedTarget.startsWith(`${uploadRoot}${path.sep}`) && resolvedTarget !== uploadRoot)
      || !stat.isFile()) throw checkpointError('INVALID_SOURCE_FILE', 'Legacy source is not a regular file');
  } catch (error) {
    await handle.close();
    throw error;
  }
  return { handle, target, stat };
}

function sameIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino)
    && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function assertSourceIdentity(source) {
  const post = await source.handle.stat();
  let current;
  try { current = await fsPromises.lstat(source.target); } catch (error) {
    throw checkpointError('MIGRATION_SOURCE_CHANGED', 'Legacy source path changed during migration');
  }
  if (!current.isFile() || !sameIdentity(source.stat, post) || !sameIdentity(source.stat, current)) {
    throw checkpointError('MIGRATION_SOURCE_CHANGED', 'Legacy source changed during migration');
  }
}

async function runUploadMigration({
  apply = false, batchSize = 100, checkpointPath, checkpointSecret,
  environment, databaseFingerprint, localRoot, domains, objectStorage,
  now = new Date(), checkpointMaxAgeMs = DEFAULT_CHECKPOINT_MAX_AGE_MS,
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new RangeError('batchSize must be between 1 and 500');
  if (!checkpointPath || !localRoot || !Array.isArray(domains) || !objectStorage
    || !environment || !databaseFingerprint) throw new TypeError('Complete migration configuration is required');
  if (typeof checkpointSecret !== 'string' || checkpointSecret.length < 32) {
    throw new TypeError('Checkpoint HMAC secret must be at least 32 characters');
  }
  const uploadRoot = await fsPromises.realpath(localRoot);
  const domainOrder = domains.map((domain) => domain.name);
  const mode = apply ? 'apply' : 'dry-run';
  const expected = { environment, databaseFingerprint, uploadRoot, domainOrder, mode };
  let state = await readCheckpoint(checkpointPath, {
    secret: checkpointSecret, expected, now, maxAgeMs: checkpointMaxAgeMs,
  });
  if (!state) state = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION, ...expected,
    snapshotAt: new Date(now).toISOString(), domainIndex: 0, cursor: null, runId: crypto.randomUUID(),
  };
  const report = {
    dryRun: !apply, runId: state.runId, snapshotAt: state.snapshotAt,
    scanned: 0, wouldCopy: 0, copied: 0, skipped: 0, externalSkipped: 0,
    unsafeSkipped: 0, raced: 0, mismatched: 0, failed: 0, exitCode: 0,
  };

  for (let domainIndex = state.domainIndex; domainIndex < domains.length; domainIndex += 1) {
    const domain = domains[domainIndex];
    let cursor = domainIndex === state.domainIndex ? state.cursor : null;
    while (true) {
      const rows = await domain.fetchBatch({ cursor, limit: batchSize, snapshotAt: state.snapshotAt });
      if (!rows.length) break;
      for (const row of rows) {
        report.scanned += 1;
        const nextCursor = { createdAt: new Date(row.createdAt).toISOString(), id: row.id };
        if (row.storageKey) report.skipped += 1;
        else if (row.external || /^https?:\/\//i.test(row.path || '')) report.externalSkipped += 1;
        else {
          let source;
          try {
            source = await openSource(uploadRoot, row.path);
            const digest = await hashHandle(source.handle);
            const key = `legacy/${domain.name}/${row.id}/${digest.sha256}`;
            const contentType = contentTypeFor(row);
            report.wouldCopy += 1;
            if (apply) {
              await objectStorage.putWithCleanupIntent({
                object: {
                  key, body: source.handle.createReadStream({ start: 0, autoClose: false }),
                  contentType, checksum: digest.sha256, contentMD5: digest.contentMD5,
                  contentLength: digest.size, requireCreated: true,
                },
                persist: async ({ transaction }) => {
                  await assertSourceIdentity(source);
                  const updated = await domain.updateIfUnchanged({
                    id: row.id, expectedPath: row.path, expectedStorageKey: null,
                    sourcePathField: row.sourcePathField, transaction,
                    metadata: { storageProvider: 'r2', storageKey: key, mimeType: contentType,
                      size: digest.size, sha256: digest.sha256 },
                  });
                  if (!updated) throw checkpointError('MIGRATION_ROW_RACE', 'Legacy row changed during migration');
                  return true;
                },
              });
              report.copied += 1;
            }
          } catch (error) {
            if (error.code === 'UNSAFE_LEGACY_PATH') report.unsafeSkipped += 1;
            else if (['MIGRATION_ROW_RACE', 'MIGRATION_SOURCE_CHANGED'].includes(error.code)) report.raced += 1;
            else {
              report.failed += 1;
              if (['OBJECT_KEY_CONFLICT', 'OBJECT_KEY_OWNERSHIP_CONFLICT', 'STORAGE_KEY_TOMBSTONED'].includes(error.code)) report.mismatched += 1;
            }
            if (['MIGRATION_ROW_RACE', 'MIGRATION_SOURCE_CHANGED'].includes(error.code)) {
              report.exitCode = 1;
              return report;
            }
            if (apply && error.code !== 'UNSAFE_LEGACY_PATH') {
              report.exitCode = 1;
              return report;
            }
          } finally {
            if (source) await source.handle.close();
          }
        }
        cursor = nextCursor;
        if (apply) await writeCheckpoint(checkpointPath, { ...state, domainIndex, cursor }, checkpointSecret);
      }
      if (rows.length < batchSize) break;
    }
    state = { ...state, domainIndex: domainIndex + 1, cursor: null };
    if (apply) await writeCheckpoint(checkpointPath, state, checkpointSecret);
  }
  if (apply) await fsPromises.rm(checkpointPath, { force: true });
  return report;
}

function createModelDomain({ name, model, pathField = 'path', metadataPrefix = '' }) {
  const keyField = `${metadataPrefix}StorageKey`;
  const providerField = `${metadataPrefix}StorageProvider`;
  const mimeField = metadataPrefix ? `${metadataPrefix}MimeType` : 'mimeType';
  const sizeField = metadataPrefix ? `${metadataPrefix}Size` : 'size';
  const shaField = metadataPrefix ? `${metadataPrefix}Sha256` : 'sha256';
  return {
    name,
    async fetchBatch({ cursor, limit, snapshotAt }) {
      const rows = await model.findAll({
        where: {
          [keyField]: null, [pathField]: { [Op.ne]: null }, createdAt: { [Op.lte]: snapshotAt },
          ...(cursor ? { [Op.or]: [
            { createdAt: { [Op.gt]: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
          ] } : {}),
        },
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit,
      });
      return rows.map((row) => ({
        id: row.id, createdAt: row.createdAt, path: row[pathField],
        mimeType: row[mimeField] || row.type, storageKey: row[keyField],
      }));
    },
    async updateIfUnchanged({ id, expectedPath, expectedStorageKey, metadata, transaction }) {
      const [count] = await model.update({
        [providerField]: metadata.storageProvider, [keyField]: metadata.storageKey,
        [mimeField]: metadata.mimeType, [sizeField]: metadata.size, [shaField]: metadata.sha256,
      }, { where: { id, [pathField]: expectedPath, [keyField]: expectedStorageKey }, transaction });
      return count === 1;
    },
  };
}

function createDefaultDomains(models = require('../models')) {
  const avatar = {
    name: 'avatar',
    async fetchBatch({ cursor, limit, snapshotAt }) {
      const rows = await models.User.findAll({
        where: {
          avatarStorageKey: null, createdAt: { [Op.lte]: snapshotAt },
          [Op.and]: [
            { [Op.or]: [{ avatarLocalPath: { [Op.ne]: null } }, { avatar: { [Op.ne]: null } }] },
            ...(cursor ? [{ [Op.or]: [
              { createdAt: { [Op.gt]: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { [Op.gt]: cursor.id } },
            ] }] : []),
          ],
        },
        order: [['createdAt', 'ASC'], ['id', 'ASC']], limit,
      });
      return rows.map((row) => {
        const sourcePathField = row.avatarLocalPath ? 'avatarLocalPath' : 'avatar';
        const sourcePath = row[sourcePathField];
        return {
          id: row.id, createdAt: row.createdAt, path: sourcePath, sourcePathField,
          mimeType: row.avatarMimeType, storageKey: row.avatarStorageKey,
          external: /^https?:\/\//i.test(sourcePath || ''),
        };
      });
    },
    async updateIfUnchanged({
      id, expectedPath, expectedStorageKey, sourcePathField, metadata, transaction,
    }) {
      const [count] = await models.User.update({
        avatarStorageProvider: metadata.storageProvider, avatarStorageKey: metadata.storageKey,
        avatarMimeType: metadata.mimeType, avatarSize: metadata.size, avatarSha256: metadata.sha256,
      }, {
        where: { id, [sourcePathField]: expectedPath, avatarStorageKey: expectedStorageKey }, transaction,
      });
      return count === 1;
    },
  };
  return [
    avatar,
    createModelDomain({ name: 'doc', model: models.Document }),
    createModelDomain({ name: 'case', model: models.CaseDocument }),
    createModelDomain({ name: 'lawyer', model: models.LawyerDocument }),
  ];
}

function databaseFingerprintFromEnv(env = process.env) {
  let identity;
  if (env.DATABASE_URL) {
    const parsed = new URL(env.DATABASE_URL);
    identity = `${parsed.protocol}//${parsed.username}@${parsed.hostname}:${parsed.port}${parsed.pathname}`;
  } else {
    identity = [
      env.DB_HOST || 'localhost', env.DB_PORT || '5432',
      env.DB_NAME || 'emaslaxat', env.DB_USER || 'emaslaxat_user',
    ].join('|');
  }
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const batchArg = argv.find((arg) => arg.startsWith('--batch='));
  const checkpointArg = argv.find((arg) => arg.startsWith('--checkpoint='));
  return {
    apply, failOnRace: !argv.includes('--allow-race'),
    batchSize: batchArg ? Number.parseInt(batchArg.split('=')[1], 10) : 100,
    checkpointPath: checkpointArg ? path.resolve(checkpointArg.slice('--checkpoint='.length))
      : path.resolve('.storage-migration-checkpoint.json'),
  };
}

function migrationExitCode(report, args = {}) {
  return report.failed > 0 || (args.apply && args.failOnRace !== false && report.raced > 0) ? 1 : 0;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = await runUploadMigration({
    ...args, checkpointSecret: process.env.STORAGE_MIGRATION_CHECKPOINT_KEY,
    environment: process.env.NODE_ENV || 'development', databaseFingerprint: databaseFingerprintFromEnv(),
    localRoot: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    domains: createDefaultDomains(), objectStorage: require('../services/objectStorage'),
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = migrationExitCode(report, args);
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Storage migration failed: ${error.code || error.name || 'ERROR'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runUploadMigration, createCheckpointEnvelope, readCheckpoint, writeCheckpoint, hashHandle,
  openSource, createModelDomain, createDefaultDomains, databaseFingerprintFromEnv, parseArgs, main,
  migrationExitCode,
};
