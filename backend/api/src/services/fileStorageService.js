'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const objectCleanupTaskService = require('./objectCleanupTaskService');
const { FILE_LIMITS } = require('../config/fileLimits');

const KEY_PREFIXES = Object.freeze({
  avatar: 'avatars',
  document: 'documents',
  case: 'case-documents',
  lawyer: 'lawyer-documents',
});
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIGRATION_FILE_SEGMENT = /^migration-[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function storageError(code, message) {
  return Object.assign(new Error(message), {
    code,
    ...(['UNSAFE_LOCAL_STORAGE_PATH'].includes(code) ? { status: 400 } : {}),
  });
}

function buildStorageKey({ kind, scopeId, fileId }) {
  const prefix = KEY_PREFIXES[kind];
  if (!prefix) throw new TypeError('Unsupported file storage kind');
  if (!SAFE_SEGMENT.test(scopeId || '') || !SAFE_SEGMENT.test(fileId || '')) {
    throw new TypeError('Storage key segments must be opaque safe identifiers');
  }
  if (!UUID_SEGMENT.test(scopeId) || (!UUID_SEGMENT.test(fileId) && !MIGRATION_FILE_SEGMENT.test(fileId))) {
    throw new TypeError('Storage key segments require UUID or deterministic migration identifier');
  }
  return `${prefix}/${scopeId}/${fileId}`;
}

function checksum(body) {
  return crypto.createHash('sha256').update(body).digest('hex');
}

function verifyChecksum(body, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected || '') || checksum(body) !== expected) {
    throw storageError('STORAGE_CHECKSUM_MISMATCH', 'Stored file checksum mismatch');
  }
}

function classifyRecord(record, localFallback) {
  if (!record || typeof record !== 'object') {
    throw storageError('INVALID_STORAGE_METADATA', 'Authorized storage record is required');
  }
  const hasProvider = record.storageProvider !== undefined && record.storageProvider !== null;
  const hasKey = record.storageKey !== undefined && record.storageKey !== null;
  if (!hasProvider && !hasKey) {
    if (!record.path) throw storageError('INVALID_STORAGE_METADATA', 'Storage metadata or legacy path is required');
    if (!localFallback) {
      throw storageError('LEGACY_LOCAL_FALLBACK_DISABLED', 'Legacy local fallback is disabled');
    }
    return 'legacy-local';
  }
  if (!['r2', 'local'].includes(record.storageProvider)
    || typeof record.storageKey !== 'string' || !record.storageKey
    || typeof record.mimeType !== 'string' || !record.mimeType.trim()
    || !Number.isInteger(record.size) || record.size < 0
    || !/^[0-9a-f]{64}$/.test(record.sha256 || '')
    || (record.storageProvider === 'local' && !record.path)) {
    throw storageError('INVALID_STORAGE_METADATA', 'Complete valid persisted storage metadata is required');
  }
  return record.storageProvider;
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function realRoot(localRoot) {
  await fs.mkdir(localRoot, { recursive: true, mode: 0o700 });
  return fs.realpath(localRoot);
}

async function safeWritePath(localRoot, key) {
  const root = await realRoot(localRoot);
  const target = path.resolve(root, ...key.split('/'));
  if (!isInside(root, target)) throw storageError('UNSAFE_LOCAL_STORAGE_PATH', 'Unsafe local storage path');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const parent = await fs.realpath(path.dirname(target));
  if (!isInside(root, parent)) throw storageError('UNSAFE_LOCAL_STORAGE_PATH', 'Unsafe local storage path');
  return target;
}

async function safeExistingPath(localRoot, candidate) {
  if (!candidate) throw storageError('LOCAL_STORAGE_FILE_MISSING', 'Local storage file is unavailable');
  const root = await realRoot(localRoot);
  const requested = path.resolve(candidate);
  let actual;
  try {
    actual = await fs.realpath(requested);
  } catch (error) {
    if (error.code === 'ENOENT') throw storageError('LOCAL_STORAGE_FILE_MISSING', 'Local storage file is unavailable');
    throw error;
  }
  if (!isInside(root, actual)) throw storageError('UNSAFE_LOCAL_STORAGE_PATH', 'Unsafe local storage path');
  const stat = await fs.stat(actual);
  if (!stat.isFile()) throw storageError('UNSAFE_LOCAL_STORAGE_PATH', 'Local storage path is not a file');
  return { path: actual, stat };
}

function checkedStream({ expectedSha256, expectedSize, maxBytes }) {
  let size = 0;
  const hash = crypto.createHash('sha256');
  return new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        callback(storageError('STORAGE_SIZE_LIMIT', `Stored file exceeds ${maxBytes} byte limit`));
        return;
      }
      hash.update(buffer);
      callback(null, buffer);
    },
    flush(callback) {
      if (expectedSize !== undefined && size !== expectedSize) {
        callback(storageError('STORAGE_METADATA_MISMATCH', 'Stored file size does not match metadata'));
        return;
      }
      if (expectedSha256 && hash.digest('hex') !== expectedSha256) {
        callback(storageError('STORAGE_CHECKSUM_MISMATCH', 'Stored file checksum mismatch'));
        return;
      }
      callback();
    },
  });
}

function validateMaxBytes(maxBytes = MAX_FILE_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) {
    throw new RangeError(`maxBytes must be between 1 and ${MAX_FILE_BYTES}`);
  }
  return maxBytes;
}

function limitForRecord(record, maxBytes) {
  const requested = validateMaxBytes(maxBytes);
  const domainLimit = typeof record?.storageKey === 'string' && record.storageKey.startsWith('avatars/')
    ? FILE_LIMITS.avatar
    : MAX_FILE_BYTES;
  return Math.min(requested, domainLimit);
}

function validateProviderMetadata(metadata, record, maxBytes) {
  const sha256 = metadata.Metadata?.sha256 || metadata.metadata?.sha256;
  const contentLength = metadata.ContentLength ?? metadata.contentLength;
  const contentType = metadata.ContentType ?? metadata.contentType;
  if (contentLength !== record.size || contentType !== record.mimeType || sha256 !== record.sha256) {
    throw storageError('STORAGE_METADATA_MISMATCH', 'Stored object metadata does not match database record');
  }
  if (contentLength > maxBytes) {
    throw storageError('STORAGE_SIZE_LIMIT', `Stored file exceeds ${maxBytes} byte limit`);
  }
}

async function localFileMatches(localPath, body) {
  const stat = await fs.stat(localPath);
  if (!stat.isFile() || stat.size !== body.length) return false;
  try {
    await pipeline(
      createReadStream(localPath),
      checkedStream({
        expectedSha256: checksum(body), expectedSize: body.length, maxBytes: body.length,
      }),
      new Transform({ transform(_chunk, _encoding, callback) { callback(); } })
    );
    return true;
  } catch (error) {
    if (['STORAGE_CHECKSUM_MISMATCH', 'STORAGE_METADATA_MISMATCH'].includes(error.code)) return false;
    throw error;
  }
}

async function localFileIdentity(localPath, body) {
  const stat = await fs.stat(localPath);
  if (!stat.isFile() || stat.size !== body.length) {
    throw storageError('LOCAL_FILE_IDENTITY_MISMATCH', 'Created local file identity is invalid');
  }
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: stat.birthtimeMs,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    sha256: checksum(body),
  };
}

function abortError() {
  const error = new Error('The storage stream was aborted');
  error.name = 'AbortError';
  return error;
}

function cleanFilename(filename) {
  const leaf = String(filename || 'download').replace(/\\/g, '/').split('/').pop();
  return Array.from(leaf.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 180).join('') || 'download';
}

function asciiFilename(filename) {
  return cleanFilename(filename).replace(/[^\x20-\x7e]|["\\/:*?<>|]/g, '_').slice(0, 180) || 'download';
}

function encodeRfc5987(filename) {
  let value = '';
  for (const character of Array.from(cleanFilename(filename))) {
    const encoded = encodeURIComponent(character).replace(/[!'()*]/g, (match) => (
      `%${match.charCodeAt(0).toString(16).toUpperCase()}`
    ));
    if ((value.length + encoded.length) > 400) break;
    value += encoded;
  }
  return value || 'download';
}

function attachmentDisposition(filename) {
  return `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function createFileStorageService({
  objectStorage,
  cleanupService = objectCleanupTaskService,
  writeMode = 'r2',
  localFallback = false,
  localRoot,
  fileSystem = fs,
}) {
  if (!objectStorage
    || typeof objectStorage.putWithCleanupIntent !== 'function'
    || typeof objectStorage.readPrivateObjectBuffer !== 'function'
    || typeof objectStorage.deletePrivateObject !== 'function'
    || typeof objectStorage.deletePrivateObjectIfOwned !== 'function') {
    throw new TypeError('Injected private object storage is required');
  }
  if (!cleanupService || typeof cleanupService.deleteBusinessRowWithCleanupTask !== 'function') {
    throw new TypeError('Injected cleanup service is required');
  }
  if (!['dual', 'r2'].includes(writeMode)) throw new TypeError('writeMode must be dual or r2');
  if (!localRoot) throw new TypeError('localRoot is required');
  const normalizedRoot = path.resolve(localRoot);
  if (normalizedRoot === path.parse(normalizedRoot).root) {
    throw new TypeError('localRoot must not be the filesystem root');
  }

  async function store({ kind, scopeId, fileId, body, mimeType, persist }) {
    if (!Buffer.isBuffer(body) || !body.length) throw new TypeError('Non-empty file buffer is required');
    const domainLimit = FILE_LIMITS[kind];
    if (!domainLimit) throw new TypeError('Unsupported file storage kind');
    if (body.length > domainLimit) {
      throw storageError('STORAGE_SIZE_LIMIT', `File exceeds ${domainLimit} byte limit`);
    }
    if (typeof mimeType !== 'string' || !mimeType) throw new TypeError('File MIME type is required');
    if (typeof persist !== 'function') throw new TypeError('Business persistence callback is required');
    const key = buildStorageKey({ kind, scopeId, fileId });
    const sha256 = checksum(body);
    let localPath = null;
    let localIntent = null;
    let localCreated = false;
    if (writeMode === 'dual') {
      localPath = await safeWritePath(normalizedRoot, key);
      let reusedLocal = false;
      const expectedIdentity = { expectedPath: localPath, size: body.length, sha256 };
      await objectCleanupTaskService.withLocalPathLock(localPath, async () => {
        localIntent = await cleanupService.createObjectCleanupIntent({
          storageKey: localPath,
          provider: 'local',
          reserveCleanup: true,
          reclaimReserved: true,
          ownershipMetadata: expectedIdentity,
        });
        try {
          await fileSystem.writeFile(localPath, body, { flag: 'wx', mode: 0o600 });
          localCreated = true;
        } catch (writeError) {
          if (writeError.code === 'EEXIST') {
            const exact = await localFileMatches(localPath, body);
            await cleanupService.resolveObjectCleanupIntent({
              intentId: localIntent.id,
              error: exact ? undefined : writeError,
              reason: exact ? 'LOCAL_FILE_REUSED' : 'LOCAL_WRITE_CONFLICT',
            });
            if (!exact) {
              throw storageError('LOCAL_FILE_CONFLICT', 'Local storage key exists with different content');
            }
            reusedLocal = true;
          } else {
            try {
              await fileSystem.rm(localPath, { force: true });
              await cleanupService.resolveObjectCleanupIntent({
                intentId: localIntent.id,
                error: writeError,
                reason: 'LOCAL_WRITE_FAILED',
              });
            } catch (deleteError) {
              await cleanupService.markObjectCleanupIntentDue({
                intentId: localIntent.id,
                error: deleteError,
              });
            }
          }
          if (!reusedLocal) throw writeError;
        }
        if (!reusedLocal) {
          try {
            await cleanupService.recordObjectCleanupOwnership({
              intentId: localIntent.id,
              ownershipMetadata: { ...expectedIdentity, ...await localFileIdentity(localPath, body) },
            });
            await cleanupService.armObjectCleanupIntent({ intentId: localIntent.id });
          } catch (armError) {
            try {
              await fileSystem.rm(localPath, { force: true });
              await cleanupService.resolveObjectCleanupIntent({ intentId: localIntent.id });
            } catch (_cleanupError) {
              // The pre-write identity keeps the reservation safely reclaimable.
            }
            throw armError;
          }
        }
      });
    }
    const metadata = {
      storageProvider: 'r2', storageKey: key, mimeType, size: body.length, sha256, path: localPath,
    };

    try {
      return await objectStorage.putWithCleanupIntent({
        object: { key, body, contentType: mimeType, checksum: sha256 },
        additionalIntentIds: localIntent ? [localIntent.id] : [],
        persist: ({ transaction, cleanupIntentId, cleanupIntentIds }) => persist({
          transaction, cleanupIntentId, cleanupIntentIds, metadata,
        }),
      });
    } catch (error) {
      if (localPath && localCreated && error.transactionOutcome !== 'unknown') {
        try {
          await objectCleanupTaskService.withLocalPathLock(
            localPath,
            () => fileSystem.rm(localPath, { force: true })
          );
          await cleanupService.resolveObjectCleanupIntent({ intentId: localIntent.id });
        } catch (cleanupError) {
          try {
            await cleanupService.markObjectCleanupIntentDue({
              intentId: localIntent.id,
              error: cleanupError,
            });
          } catch (_markError) {
            // The pre-write local intent remains durable.
          }
        }
      }
      throw error;
    }
  }

  async function readLocal(record, maxBytes = MAX_FILE_BYTES, legacy = false) {
    const limit = validateMaxBytes(maxBytes);
    const local = await safeExistingPath(normalizedRoot, record.path);
    if (local.stat.size > limit) {
      throw storageError('STORAGE_SIZE_LIMIT', `Stored file exceeds ${limit} byte limit`);
    }
    const chunks = [];
    await pipeline(
      createReadStream(local.path),
      checkedStream({
        expectedSha256: legacy ? undefined : record.sha256,
        expectedSize: legacy ? local.stat.size : record.size,
        maxBytes: limit,
      }),
      new Transform({
        transform(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      })
    );
    return Buffer.concat(chunks, local.stat.size);
  }

  async function read({ record, maxBytes }) {
    const source = classifyRecord(record, localFallback);
    const limit = limitForRecord(record, maxBytes);
    if (source === 'local' || source === 'legacy-local') {
      return readLocal(record, limit, source === 'legacy-local');
    }
    let body;
    try {
      const head = await objectStorage.headPrivateObject(record.storageKey);
      validateProviderMetadata(head, record, limit);
      body = await objectStorage.readPrivateObjectBuffer(record.storageKey, limit);
    } catch (error) {
      if (['STORAGE_METADATA_MISMATCH', 'STORAGE_SIZE_LIMIT'].includes(error.code)
        || !localFallback || !record.path) throw error;
      return readLocal(record, limit);
    }
    verifyChecksum(body, record.sha256);
    return body;
  }

  async function deleteFile({ record, destroy }) {
    if (!record?.storageKey || record.storageProvider !== 'r2') {
      throw new TypeError('R2-backed authorized storage record is required');
    }
    if (typeof destroy !== 'function') throw new TypeError('Business deletion callback is required');
    let localPath = null;
    if (record.path) {
      try {
        localPath = (await safeExistingPath(normalizedRoot, record.path)).path;
      } catch (error) {
        if (error.code !== 'LOCAL_STORAGE_FILE_MISSING') throw error;
        // A physically missing local fallback has already reached the desired delete state.
      }
    }
    let objects;
    let createdTasks;
    const persistDeletion = async (localOwnershipMetadata) => {
      objects = [
        { provider: 'r2', storageKey: record.storageKey },
        ...(localPath ? [{
          provider: 'local', storageKey: localPath,
          requiresOwnershipProof: true,
          ownershipMetadata: localOwnershipMetadata,
        }] : []),
      ];
      createdTasks = objects.length === 1
        ? [await cleanupService.deleteBusinessRowWithCleanupTask({ ...objects[0], destroy })]
        : await cleanupService.deleteBusinessRowWithCleanupTasks({ objects, destroy });
    };
    if (localPath) {
      await objectCleanupTaskService.withLocalPathLock(localPath, async () => {
        const identity = await objectCleanupTaskService.captureLocalObjectOwnership(localPath);
        await persistDeletion(identity);
      });
    } else {
      await persistDeletion(undefined);
    }
    const tasks = createdTasks;
    let cleanupPending = false;
    for (const task of tasks) {
      if (task.status === 'manual_review') {
        cleanupPending = true;
        continue;
      }
      try {
        let deleteResult;
        if (task.provider === 'r2') {
          deleteResult = await objectStorage.deletePrivateObjectIfOwned(task.storageKey, task.ownershipToken);
        } else deleteResult = await cleanupService.deleteLocalObjectIfOwned(task.storageKey, task);
        if (deleteResult?.ownershipMismatch) {
          throw storageError('STORAGE_OWNERSHIP_MISMATCH', 'Stored object ownership no longer matches cleanup proof');
        }
        await cleanupService.resolveObjectCleanupIntent({ intentId: task.id });
      } catch (error) {
        cleanupPending = true;
        try {
          await cleanupService.markObjectCleanupIntentDue({ intentId: task.id, error });
        } catch (_markError) {
          // Every task was committed with the business-row deletion.
        }
      }
    }
    return { cleanupPending };
  }

  async function stream({
    record, response, filename, signal, maxBytes,
    disposition = 'attachment', cacheControl = 'private, no-store', etag,
  }) {
    if (signal?.aborted) throw abortError();
    if (!response || typeof response.setHeader !== 'function') {
      throw new TypeError('HTTP response is required');
    }
    const limit = limitForRecord(record, maxBytes);
    let source = classifyRecord(record, localFallback);
    let head;
    if (source === 'r2') {
      try {
        head = await objectStorage.headPrivateObject(record.storageKey, { signal });
        validateProviderMetadata(head, record, limit);
      } catch (error) {
        if (['STORAGE_METADATA_MISMATCH', 'STORAGE_SIZE_LIMIT'].includes(error.code)
          || !localFallback || !record.path) throw error;
        source = 'local';
      }
    }
    let local;
    if (source === 'local' || source === 'legacy-local') {
      local = await safeExistingPath(normalizedRoot, record.path);
      if (local.stat.size > limit) {
        throw storageError('STORAGE_SIZE_LIMIT', `Stored file exceeds ${limit} byte limit`);
      }
      if (source !== 'legacy-local' && local.stat.size !== record.size) {
        throw storageError('STORAGE_METADATA_MISMATCH', 'Local file size does not match database record');
      }
    }
    if (signal?.aborted) throw abortError();
    const contentLength = source === 'r2' ? head.ContentLength : local.stat.size;
    response.setHeader('Cache-Control', cacheControl);
    response.setHeader('Content-Disposition', disposition === 'inline'
      ? 'inline'
      : attachmentDisposition(filename));
    response.setHeader('Content-Length', String(contentLength));
    response.setHeader('Content-Type', record.mimeType || 'application/octet-stream');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (etag) response.setHeader('ETag', etag);
    const consume = async (body, metadata) => {
      if (source === 'r2') validateProviderMetadata(metadata, record, limit);
      const streams = [
        body,
        checkedStream({
          expectedSha256: source === 'legacy-local' ? undefined : record.sha256,
          expectedSize: contentLength,
          maxBytes: limit,
        }),
        response,
      ];
      if (signal) await pipeline(...streams, { signal });
      else await pipeline(...streams);
    };
    if (source === 'r2') {
      await objectStorage.withPrivateObjectStream(record.storageKey, consume, { signal });
    } else {
      await consume(createReadStream(local.path), {
        contentLength: local.stat.size,
        contentType: record.mimeType || 'application/octet-stream',
        metadata: record.sha256 ? { sha256: record.sha256 } : undefined,
      });
    }
  }

  return { store, read, delete: deleteFile, stream };
}

module.exports = { buildStorageKey, createFileStorageService, attachmentDisposition };
