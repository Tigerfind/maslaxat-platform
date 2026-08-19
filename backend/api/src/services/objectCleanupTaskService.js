const { Op } = require('sequelize');
const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { sequelize, ObjectCleanupTask } = require('../models');

const INTENT_GRACE_MS = 15 * 60 * 1000;
const MAX_CLEANUP_ATTEMPTS = 5;
const BASE_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const CLEANUP_LEASE_MS = 30 * 1000;
const DELETE_CONCURRENCY = 4;
const RESERVED_RECLAIM_MS = 15 * 60 * 1000;
const localPathLocks = new Map();

async function withLocalPathLock(filePath, operation) {
  if (typeof operation !== 'function') throw new TypeError('Local path operation is required');
  const previous = localPathLocks.get(filePath) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  localPathLocks.set(filePath, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localPathLocks.get(filePath) === tail) localPathLocks.delete(filePath);
  }
}

function sanitizeTaskError(error, prefix = 'OBJECT_DELETE_FAILED') {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
    ? `:${error.code}`
    : '';
  return `${prefix}${code}`;
}

function validStorageKey(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey || storageKey.length > 1024) {
    throw new TypeError('Valid storageKey is required');
  }
}

function validProvider(provider) {
  if (!['r2', 'local'].includes(provider)) throw new TypeError('Unsupported object storage provider');
}

async function assertStorageKeyWritable({
  storageKey,
  provider = 'r2',
  model = ObjectCleanupTask,
}) {
  validStorageKey(storageKey);
  validProvider(provider);
  const tombstone = await model.findOne({
    where: { storageKey, provider, preventsKeyReuse: true },
    attributes: ['id'],
  });
  if (tombstone) {
    throw Object.assign(new Error('Storage key deletion has started and the key cannot be reused'), {
      code: 'STORAGE_KEY_TOMBSTONED',
    });
  }
}

async function createObjectCleanupIntent({
  storageKey,
  provider = 'r2',
  reserveCleanup = false,
  reclaimReserved = true,
  ownershipMetadata = null,
  now = new Date(),
  model = ObjectCleanupTask,
}) {
  validStorageKey(storageKey);
  validProvider(provider);
  const createdAt = new Date(now);
  const id = crypto.randomUUID();
  return model.create({
    id,
    storageKey,
    provider,
    status: reserveCleanup ? 'reserved' : 'pending',
    attempts: 0,
    lastError: null,
    nextAttemptAt: reserveCleanup
      ? (reclaimReserved ? new Date(createdAt.getTime() + RESERVED_RECLAIM_MS) : null)
      : new Date(createdAt.getTime() + INTENT_GRACE_MS),
    requiresOwnershipProof: reserveCleanup,
    ownershipToken: reserveCleanup ? id : null,
    ownershipMetadata,
  });
}

async function recordObjectCleanupOwnership({
  intentId,
  ownershipMetadata,
  model = ObjectCleanupTask,
}) {
  if (!ownershipMetadata || typeof ownershipMetadata !== 'object' || Array.isArray(ownershipMetadata)) {
    throw new TypeError('Ownership metadata is required');
  }
  const intent = await model.findByPk(intentId);
  if (!intent || intent.status !== 'reserved' || !intent.requiresOwnershipProof) {
    throw new Error('Cleanup intent cannot record ownership');
  }
  return intent.update({ ownershipMetadata });
}

async function armObjectCleanupIntent({
  intentId,
  now = new Date(),
  model = ObjectCleanupTask,
}) {
  const intent = await model.findByPk(intentId);
  if (!intent || intent.status !== 'reserved') throw new Error('Cleanup intent is not reserved');
  return intent.update({
    status: 'pending',
    nextAttemptAt: new Date(new Date(now).getTime() + INTENT_GRACE_MS),
    lastError: null,
  });
}

async function persistAndResolveObjectCleanupIntent({
  intentId,
  persist,
  model = ObjectCleanupTask,
  database = sequelize,
}) {
  return persistAndResolveObjectCleanupIntents({
    intentIds: [intentId], persist, model, database,
  });
}

async function persistAndResolveObjectCleanupIntents({
  intentIds,
  persist,
  model = ObjectCleanupTask,
  database = sequelize,
}) {
  if (typeof persist !== 'function') throw new TypeError('Business persistence callback is required');
  if (!Array.isArray(intentIds) || !intentIds.length || new Set(intentIds).size !== intentIds.length) {
    throw new TypeError('Unique cleanup intent IDs are required');
  }
  const transaction = await database.transaction();
  let readyToCommit = false;
  try {
    const sortedIds = [...intentIds].sort();
    const intents = await model.findAll({
      where: { id: sortedIds },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (intents.length !== sortedIds.length
      || intents.some((intent) => !['pending', 'completed'].includes(intent.status))) {
      throw new Error('Cleanup intents are not persistable');
    }
    if (intents.some((intent) => intent.preventsKeyReuse)) {
      throw Object.assign(new Error('Storage key deletion has started and the key cannot be persisted'), {
        code: 'STORAGE_KEY_TOMBSTONED',
      });
    }
    if (intents.some((intent) => !intent.requiresOwnershipProof || intent.ownershipToken !== intent.id)) {
      throw Object.assign(new Error('Cleanup intent does not prove object ownership'), {
        code: 'STORAGE_OWNERSHIP_UNPROVEN',
      });
    }

    const result = await persist({
      transaction,
      cleanupIntentId: intentIds[0],
      cleanupIntentIds: [...intentIds],
    });
    for (const intent of intents) {
      if (intent.status === 'pending') {
        await intent.update({
          status: 'completed',
          nextAttemptAt: null,
          lastError: null,
        }, { transaction });
      }
    }
    readyToCommit = true;
    try {
      await transaction.commit();
    } catch (commitError) {
      commitError.transactionOutcome = 'unknown';
      throw commitError;
    }
    return result;
  } catch (error) {
    if (readyToCommit) throw error;
    try {
      await transaction.rollback();
      error.transactionOutcome = 'rolled_back';
    } catch (_rollbackError) {
      error.transactionOutcome = 'unknown';
    }
    throw error;
  }
}

async function deleteBusinessRowWithCleanupTask({
  storageKey,
  provider = 'r2',
  destroy,
  now = new Date(),
  model = ObjectCleanupTask,
  database = sequelize,
}) {
  const tasks = await deleteBusinessRowWithCleanupTasks({
    objects: [{ storageKey, provider }], destroy, now, model, database,
  });
  return tasks[0];
}

async function deleteBusinessRowWithCleanupTasks({
  objects,
  destroy,
  now = new Date(),
  model = ObjectCleanupTask,
  database = sequelize,
}) {
  if (!Array.isArray(objects) || !objects.length) throw new TypeError('Cleanup objects are required');
  objects.forEach(({ storageKey, provider }) => {
    validStorageKey(storageKey);
    validProvider(provider);
  });
  if (typeof destroy !== 'function') throw new TypeError('Business deletion callback is required');
  const dueAt = new Date(now);
  if (Number.isNaN(dueAt.getTime())) throw new TypeError('Valid now timestamp is required');

  return database.transaction(async (transaction) => {
    const tasks = [];
    for (const object of objects) {
      const existing = await model.findOne({
        where: {
          storageKey: object.storageKey,
          provider: object.provider,
          requiresOwnershipProof: true,
          ownershipToken: { [Op.ne]: null },
        },
        order: [['createdAt', 'DESC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) {
        tasks.push(await existing.update({
          status: 'pending',
          attempts: 0,
          lastError: null,
          nextAttemptAt: dueAt,
          leaseToken: null,
          leaseExpiresAt: null,
          preventsKeyReuse: true,
          ...(object.ownershipMetadata ? { ownershipMetadata: object.ownershipMetadata } : {}),
        }, { transaction }));
      } else {
        const id = crypto.randomUUID();
        const protectedLocal = object.provider === 'local' && Boolean(object.ownershipMetadata);
        const requiresOwnershipProof = object.requiresOwnershipProof ?? protectedLocal;
        tasks.push(await model.create({
          ...object,
          id,
          status: requiresOwnershipProof ? 'pending' : 'manual_review',
          attempts: 0,
          lastError: requiresOwnershipProof ? null : 'OWNERSHIP_PROOF_MISSING',
          nextAttemptAt: requiresOwnershipProof ? dueAt : null,
          requiresOwnershipProof,
          ownershipToken: requiresOwnershipProof ? (object.ownershipToken || id) : null,
          preventsKeyReuse: true,
        }, { transaction }));
      }
    }
    await destroy({
      transaction,
      cleanupIntentId: tasks[0].id,
      cleanupIntentIds: tasks.map((task) => task.id),
    });
    return tasks;
  });
}

async function resolveObjectCleanupIntent({
  intentId,
  error,
  reason = 'OBJECT_CLEANUP_RESOLVED',
  model = ObjectCleanupTask,
}) {
  const intent = await model.findByPk(intentId);
  if (!intent) throw new Error('Cleanup intent not found');
  if (intent.status === 'completed') return intent;
  if (!['reserved', 'pending'].includes(intent.status)) throw new Error('Cleanup intent is not resolvable');
  return intent.update({
    status: 'completed',
    nextAttemptAt: null,
    lastError: error ? sanitizeTaskError(error, reason) : null,
  });
}

async function markObjectCleanupIntentDue({
  intentId,
  error,
  now = new Date(),
  model = ObjectCleanupTask,
}) {
  const intent = await model.findByPk(intentId);
  if (!intent || !['reserved', 'pending'].includes(intent.status)) return intent;
  return intent.update({
    status: 'pending',
    nextAttemptAt: new Date(now),
    lastError: sanitizeTaskError(error),
  });
}

function isDeleteNotFound(error) {
  return ['NoSuchKey', 'NotFound'].includes(error?.name)
    || error?.code === 'ENOENT'
    || error?.$metadata?.httpStatusCode === 404
    || error?.statusCode === 404;
}

function hasCleanupOwnershipProof(task) {
  if (!task.requiresOwnershipProof || !task.ownershipToken) return false;
  if (task.provider !== 'local') return true;
  const metadata = task.ownershipMetadata;
  return Boolean(metadata
    && metadata.expectedPath === task.storageKey
    && Number.isInteger(metadata.size)
    && metadata.size >= 0
    && /^[0-9a-f]{64}$/.test(metadata.sha256 || ''));
}

async function processObjectCleanupTasks({
  limit = 25,
  now = new Date(),
  deleteObject,
  deleteByProvider,
  model = ObjectCleanupTask,
  database = sequelize,
  signal,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be between 1 and 100');
  }
  const currentTime = new Date(now);
  if (Number.isNaN(currentTime.getTime())) throw new TypeError('Valid now timestamp is required');
  let providerDeleters = deleteByProvider;
  if (!providerDeleters) {
    if (deleteObject) providerDeleters = { r2: deleteObject };
    else {
      const storage = require('./objectStorage');
      providerDeleters = {
        r2: (key, claim) => storage.deletePrivateObjectIfOwned(key, claim.ownershipToken),
        local: deleteLocalObjectIfOwned,
      };
    }
  }
  const summary = {
    claimed: 0, completed: 0, retried: 0, deadLettered: 0, manualReview: 0,
  };

  async function claimBatch(batchLimit) {
    return database.transaction(async (transaction) => {
      const tasks = await model.findAll({
        where: {
          [Op.or]: [
            { status: 'pending', nextAttemptAt: { [Op.lte]: currentTime } },
            { status: 'reserved', nextAttemptAt: { [Op.lte]: currentTime } },
            { status: 'processing', leaseExpiresAt: { [Op.lte]: currentTime } },
          ],
        },
        order: [['createdAt', 'ASC']],
        limit: batchLimit,
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      const claimed = [];
      for (const task of tasks) {
        if (!hasCleanupOwnershipProof(task)) {
          await task.update({
            status: 'manual_review',
            nextAttemptAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: 'OWNERSHIP_PROOF_MISSING',
            preventsKeyReuse: true,
          }, { transaction });
          claimed.push({ id: task.id, manualReview: true });
          continue;
        }
        const reserved = task.status === 'reserved';
        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(currentTime.getTime() + CLEANUP_LEASE_MS);
        await task.update({ status: 'processing', leaseToken, leaseExpiresAt }, { transaction });
        claimed.push({
          id: task.id,
          storageKey: task.storageKey,
          provider: task.provider,
          reserved,
          requiresOwnershipProof: task.requiresOwnershipProof,
          ownershipToken: task.ownershipToken,
          ownershipMetadata: task.ownershipMetadata,
          leaseToken,
        });
      }
      return claimed;
    });
  }

  async function finalize(claim, failure) {
    return database.transaction(async (transaction) => {
      const task = await model.findOne({
        where: {
          id: claim.id,
          status: 'processing',
          leaseToken: claim.leaseToken,
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!task) return 'lost';

      if (!failure) {
        await task.update({
          status: 'completed',
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        }, { transaction });
        return 'completed';
      }

      const attempts = task.attempts + 1;
      if (attempts >= MAX_CLEANUP_ATTEMPTS) {
        await task.update({
          status: 'failed',
          attempts,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: sanitizeTaskError(failure),
        }, { transaction });
        return 'deadLettered';
      }

      const delay = Math.min(BASE_RETRY_MS * (2 ** (attempts - 1)), MAX_RETRY_MS);
      await task.update({
        status: 'pending',
        attempts,
        nextAttemptAt: new Date(currentTime.getTime() + delay),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: sanitizeTaskError(failure),
      }, { transaction });
      return 'retried';
    });
  }

  async function processClaims(claims) {
    async function worker(claim) {
      if (signal?.aborted) throw Object.assign(new Error('Object cleanup aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
      if (claim.manualReview) {
        summary.manualReview += 1;
        return;
      }
      let failure;
      try {
        const deleter = providerDeleters[claim.provider];
        if (typeof deleter !== 'function') {
          throw Object.assign(new Error('Cleanup provider unavailable'), {
            code: 'DELETE_PROVIDER_UNAVAILABLE',
          });
        }
        await deleter(claim.storageKey, claim);
      } catch (error) {
        if (!isDeleteNotFound(error)) failure = error;
      }
      const outcome = await finalize(claim, failure);
      if (outcome !== 'lost') summary[outcome] += 1;
    }
    await Promise.all(claims.map((claim) => worker(claim)));
  }

  let remaining = limit;
  while (remaining > 0) {
    if (signal?.aborted) throw Object.assign(new Error('Object cleanup aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
    const claims = await claimBatch(Math.min(DELETE_CONCURRENCY, remaining));
    if (!claims.length) break;
    summary.claimed += claims.length;
    await processClaims(claims);
    remaining -= claims.length;
  }
  return summary;
}

async function runObjectCleanupOnce(now = new Date(), {
  signal, limit = 25, processCleanup = processObjectCleanupTasks,
} = {}) {
  if (signal?.aborted) throw Object.assign(new Error('Object cleanup aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
  return processCleanup({ now, signal, limit });
}

async function getObjectCleanupReconciliationReport({
  blockerLimit = 25,
  model = ObjectCleanupTask,
} = {}) {
  if (!Number.isInteger(blockerLimit) || blockerLimit < 1 || blockerLimit > 100) {
    throw new RangeError('blockerLimit must be between 1 and 100');
  }
  const database = model.sequelize || sequelize;
  const counts = await model.findAll({
    attributes: ['status', [database.fn('COUNT', database.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });
  const statusCounts = Object.fromEntries(
    counts.map((row) => [row.status, Number(row.count)])
  );
  const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const manualReviewCount = statusCounts.manual_review || 0;
  const failedCount = statusCounts.failed || 0;
  const blockerCount = manualReviewCount + failedCount;
  const rows = blockerCount > 0
    ? await model.findAll({
      where: { status: { [Op.in]: ['failed', 'manual_review'] } },
      attributes: ['id', 'provider', 'lastError'],
      order: [['createdAt', 'ASC']],
      limit: blockerLimit,
    })
    : [];
  return {
    ready: blockerCount === 0,
    total,
    statusCounts,
    manualReviewCount,
    failedCount,
    blockers: rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      reason: row.lastError || 'MANUAL_REVIEW_REQUIRED',
    })),
    blockersTruncated: blockerCount > rows.length,
  };
}

async function scheduleObjectCleanup({
  storageKey,
  provider = 'r2',
  ownershipToken = null,
  model = ObjectCleanupTask,
  database = sequelize,
  now = new Date(),
}) {
  validStorageKey(storageKey);
  validProvider(provider);
  const existing = await model.findOne({
    where: { storageKey, provider, preventsKeyReuse: true },
    order: [['createdAt', 'DESC']],
  });
  if (existing) return { task: existing, created: false };
  try {
    const [task] = await deleteBusinessRowWithCleanupTasks({
      objects: [{
        storageKey,
        provider,
        requiresOwnershipProof: Boolean(ownershipToken),
        ownershipToken,
      }],
      destroy: async () => {},
      now,
      model,
      database,
    });
    return { task, created: true };
  } catch (error) {
    if (error.name !== 'SequelizeUniqueConstraintError') throw error;
    const raced = await model.findOne({
      where: { storageKey, provider, preventsKeyReuse: true },
      order: [['createdAt', 'DESC']],
    });
    if (!raced) throw error;
    return { task: raced, created: false };
  }
}

async function hashLocalHandle(handle) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}

async function captureLocalObjectOwnership(filePath) {
  if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
    throw Object.assign(new Error('O_NOFOLLOW is unavailable on this operating system'), {
      code: 'LOCAL_NOFOLLOW_UNAVAILABLE',
    });
  }
  const handle = await fsPromises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw Object.assign(new Error('Local cleanup path is not a regular file'), {
        code: 'LOCAL_OWNERSHIP_INVALID',
      });
    }
    return {
      expectedPath: filePath,
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha256: await hashLocalHandle(handle),
    };
  } finally {
    await handle.close();
  }
}

function sameLocalIdentity(stat, metadata) {
  return stat.size === metadata.size
    && (metadata.dev === undefined || String(stat.dev) === metadata.dev)
    && (metadata.ino === undefined || String(stat.ino) === metadata.ino)
    && (metadata.mtimeMs === undefined || stat.mtimeMs === metadata.mtimeMs)
    && (metadata.birthtimeMs === undefined || stat.birthtimeMs === metadata.birthtimeMs);
}

async function deleteLocalObjectIfOwned(filePath, claim, { beforeFinalCheck } = {}) {
  if (!claim.requiresOwnershipProof || claim.ownershipToken !== claim.id) {
    throw Object.assign(new Error('Local cleanup ownership proof is required'), {
      code: 'OWNERSHIP_PROOF_MISSING',
    });
  }
  const metadata = claim.ownershipMetadata;
  if (!metadata || metadata.expectedPath !== filePath
    || !Number.isInteger(metadata.size) || metadata.size < 0
    || !/^[0-9a-f]{64}$/.test(metadata.sha256 || '')) {
    return { deleted: false, ownershipMismatch: true };
  }
  return withLocalPathLock(filePath, async () => {
    let handle;
    try {
      if (!Number.isInteger(fs.constants.O_NOFOLLOW)) {
        throw Object.assign(new Error('O_NOFOLLOW is unavailable on this operating system'), {
          code: 'LOCAL_NOFOLLOW_UNAVAILABLE',
        });
      }
      handle = await fsPromises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (error) {
      if (error.code === 'ENOENT') return { deleted: false, missing: true };
      if (error.code === 'ELOOP') return { deleted: false, ownershipMismatch: true };
      throw error;
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameLocalIdentity(opened, metadata)) {
        return { deleted: false, ownershipMismatch: true };
      }
      if (await hashLocalHandle(handle) !== metadata.sha256) {
        return { deleted: false, ownershipMismatch: true };
      }
      if (beforeFinalCheck) await beforeFinalCheck();
      const current = await fsPromises.lstat(filePath);
      if (!current.isFile()
        || String(current.dev) !== String(opened.dev)
        || String(current.ino) !== String(opened.ino)
        || !sameLocalIdentity(current, metadata)) {
        return { deleted: false, ownershipMismatch: true };
      }
      // POSIX has no pathname unlink-if-inode primitive; this lock closes app races,
      // while an external process can still mutate the path after this final check.
      await fsPromises.rm(filePath);
      return { deleted: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { deleted: false, ownershipMismatch: true };
      throw error;
    } finally {
      await handle.close();
    }
  });
}

module.exports = {
  createObjectCleanupIntent,
  assertStorageKeyWritable,
  recordObjectCleanupOwnership,
  armObjectCleanupIntent,
  persistAndResolveObjectCleanupIntent,
  persistAndResolveObjectCleanupIntents,
  deleteBusinessRowWithCleanupTask,
  deleteBusinessRowWithCleanupTasks,
  resolveObjectCleanupIntent,
  markObjectCleanupIntentDue,
  processObjectCleanupTasks,
  runObjectCleanupOnce,
  getObjectCleanupReconciliationReport,
  scheduleObjectCleanup,
  sanitizeTaskError,
  INTENT_GRACE_MS,
  MAX_CLEANUP_ATTEMPTS,
  CLEANUP_LEASE_MS,
  RESERVED_RECLAIM_MS,
  deleteLocalObjectIfOwned,
  captureLocalObjectOwnership,
  withLocalPathLock,
};
