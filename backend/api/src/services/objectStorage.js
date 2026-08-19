const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const objectCleanupTaskService = require('./objectCleanupTaskService');

const MAX_SIGNED_URL_SECONDS = 604800;
const MAX_PRIVATE_READ_BYTES = 10 * 1024 * 1024;

function requireConfig(value, name) {
  if (!value || value.startsWith('CHANGE_ME')) {
    throw new Error(`${name} is required for private object storage`);
  }
  return value;
}

function buildR2ClientConfig(env = process.env, requestHandler = new NodeHttpHandler({
  connectionTimeout: 3000,
  requestTimeout: 10000,
  socketTimeout: 10000,
})) {
  const accountId = env.R2_ACCOUNT_ID;
  if (typeof accountId !== 'string' || !/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new Error('R2_ACCOUNT_ID must be exactly 32 hexadecimal characters');
  }

  return {
    region: 'auto',
    endpoint: `https://${accountId.toLowerCase()}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireConfig(env.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID'),
      secretAccessKey: requireConfig(env.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: true,
    requestHandler,
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

function validateSha256(checksum) {
  if (!/^[0-9a-f]{64}$/i.test(checksum || '')) {
    throw new TypeError('checksum must be a SHA-256 hex digest');
  }
  return checksum.toLowerCase();
}

function isPreconditionFailed(error) {
  return error?.name === 'PreconditionFailed'
    || error?.$metadata?.httpStatusCode === 412
    || error?.statusCode === 412;
}

function createObjectStorage({
  client,
  bucket,
  signer = getSignedUrl,
  cleanupService = objectCleanupTaskService,
}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('S3-compatible client is required');
  if (!bucket) throw new TypeError('Private bucket is required');

  async function putPrivateObject({ key, body, contentType, checksum, ownershipToken, signal }) {
    if (!key || body === undefined || !contentType) throw new TypeError('key, body, and contentType are required');
    const sha256 = validateSha256(checksum);
    const actualSha256 = crypto.createHash('sha256').update(body).digest('hex');
    if (actualSha256 !== sha256) throw new Error('checksum does not match body');

    const contentLength = Buffer.byteLength(body);
    try {
      const response = await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
        ContentMD5: crypto.createHash('md5').update(body).digest('base64'),
        Metadata: {
          sha256,
          ...(ownershipToken ? { cleanupIntentId: ownershipToken } : {}),
        },
        IfNoneMatch: '*',
      }), signal ? { abortSignal: signal } : undefined);
      return { ...response, created: true };
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      let existing;
      try {
        existing = await headPrivateObject(key);
      } catch (headError) {
        headError.preExistingObject = true;
        throw headError;
      }
      const exact = existing.ContentLength === contentLength
        && existing.ContentType === contentType
        && existing.Metadata?.sha256 === sha256;
      if (!exact) {
        throw Object.assign(new Error('Object key already exists with different content metadata'), {
          code: 'OBJECT_KEY_CONFLICT',
          preExistingObject: true,
        });
      }
      return { created: false };
    }
  }

  async function putMigratedObject({
    key, body, contentType, checksum, contentMD5, contentLength, ownershipToken, signal,
  }) {
    if (!key || !body || !contentType) throw new TypeError('key, body, and contentType are required');
    const sha256 = validateSha256(checksum);
    if (!Number.isInteger(contentLength) || contentLength < 0) throw new TypeError('Valid contentLength is required');
    if (typeof contentMD5 !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(contentMD5)) {
      throw new TypeError('Valid base64 Content-MD5 is required');
    }
    try {
      const response = await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: contentLength,
        ContentMD5: contentMD5,
        Metadata: { sha256, ...(ownershipToken ? { cleanupIntentId: ownershipToken } : {}) },
        IfNoneMatch: '*',
      }), signal ? { abortSignal: signal } : undefined);
      return { ...response, created: true };
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      const existing = await headPrivateObject(key, { signal });
      if (existing.ContentLength !== contentLength
        || existing.ContentType !== contentType
        || existing.Metadata?.sha256 !== sha256) {
        throw Object.assign(new Error('Object key already exists with different content metadata'), {
          code: 'OBJECT_KEY_CONFLICT', preExistingObject: true,
        });
      }
      return { created: false };
    }
  }

  async function listPrivateObjects({ continuationToken, maxKeys = 500, signal } = {}) {
    if (!Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000) {
      throw new RangeError('maxKeys must be between 1 and 1000');
    }
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: maxKeys,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }), signal ? { abortSignal: signal } : undefined);
    return {
      objects: (response.Contents || []).map((object) => ({
        key: object.Key, size: object.Size, lastModified: object.LastModified,
      })),
      isTruncated: Boolean(response.IsTruncated),
      nextContinuationToken: response.IsTruncated ? response.NextContinuationToken : undefined,
    };
  }

  async function disposeBody(body) {
    if (typeof body.destroy === 'function') {
      body.destroy();
      return;
    }
    if (typeof body.cancel === 'function') {
      await body.cancel();
      return;
    }
    if (typeof body.return === 'function') {
      await body.return();
      return;
    }
    throw new TypeError('Private object body cannot be safely disposed');
  }

  async function withPrivateObjectStream(key, fn, { signal } = {}) {
    if (typeof fn !== 'function') throw new TypeError('Private object consumer is required');
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      signal ? { abortSignal: signal } : undefined
    );
    const body = response.Body;
    if (!body) throw new Error('Private object response has no body');

    let consumerError;
    try {
      return await fn(body, {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        metadata: response.Metadata?.sha256
          ? { sha256: response.Metadata.sha256 }
          : undefined,
      });
    } catch (error) {
      consumerError = error;
      throw error;
    } finally {
      try {
        await disposeBody(body);
      } catch (disposeError) {
        if (!consumerError) throw disposeError;
      }
    }
  }

  async function readPrivateObjectBuffer(key, maxBytes = MAX_PRIVATE_READ_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PRIVATE_READ_BYTES) {
      throw new RangeError(`maxBytes must be between 1 and ${MAX_PRIVATE_READ_BYTES}`);
    }
    return withPrivateObjectStream(key, async (body, metadata) => {
      if (Number.isFinite(metadata.contentLength) && metadata.contentLength > maxBytes) {
        throw new Error(`Private object exceeds ${maxBytes} byte read limit`);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) throw new Error(`Private object exceeds ${maxBytes} byte read limit`);
        chunks.push(buffer);
      }
      return Buffer.concat(chunks, size);
    });
  }

  async function headPrivateObject(key, { signal } = {}) {
    return client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
      signal ? { abortSignal: signal } : undefined
    );
  }

  async function checkReady({ signal } = {}) {
    await client.send(
      new HeadBucketCommand({ Bucket: bucket }),
      signal ? { abortSignal: signal } : undefined
    );
    return true;
  }

  async function deletePrivateObject(key) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      if (!['NoSuchKey', 'NotFound'].includes(error.name) && error.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }
  }

  async function deletePrivateObjectIfOwned(key, ownershipToken) {
    if (!ownershipToken) throw new TypeError('Object ownership token is required');
    let existing;
    try {
      existing = await headPrivateObject(key);
    } catch (error) {
      if (['NoSuchKey', 'NotFound'].includes(error.name) || error.$metadata?.httpStatusCode === 404) {
        return { deleted: false, missing: true };
      }
      throw error;
    }
    const storedToken = existing.Metadata?.cleanupIntentId || existing.Metadata?.cleanupintentid;
    if (storedToken !== ownershipToken) return { deleted: false, ownershipMismatch: true };
    await deletePrivateObject(key);
    return { deleted: true };
  }

  async function createSignedDownload(key, expiresSeconds) {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > MAX_SIGNED_URL_SECONDS) {
      throw new RangeError(`expiresSeconds must be between 1 and ${MAX_SIGNED_URL_SECONDS}`);
    }

    return signer(client, new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'attachment; filename="profile-import.pdf"',
      ResponseContentType: 'application/pdf',
    }), { expiresIn: expiresSeconds });
  }

  async function putWithCleanupIntent({ object, persist, additionalIntentIds = [] }) {
    if (typeof persist !== 'function') throw new TypeError('Business persistence callback is required');
    if (!Array.isArray(additionalIntentIds)) throw new TypeError('additionalIntentIds must be an array');
    if (typeof cleanupService.assertStorageKeyWritable === 'function') {
      await cleanupService.assertStorageKeyWritable({ provider: 'r2', storageKey: object.key });
    }
    const intent = await cleanupService.createObjectCleanupIntent({
      storageKey: object.key,
      provider: 'r2',
      reserveCleanup: true,
      reclaimReserved: true,
    });

    let uploadResult;
    try {
      const streamedMigration = Number.isInteger(object.contentLength) && object.contentMD5;
      uploadResult = streamedMigration
        ? await putMigratedObject({ ...object, ownershipToken: intent.id })
        : await putPrivateObject({ ...object, ownershipToken: intent.id });
    } catch (uploadError) {
      let intentResolved = false;
      if (uploadError.preExistingObject) {
        try {
          await cleanupService.resolveObjectCleanupIntent({
            intentId: intent.id,
            error: uploadError,
            reason: 'OBJECT_UPLOAD_FAILED',
          });
          intentResolved = true;
        } catch (_resolveError) {
          // The conflict is terminal; operators can resolve the content-free intent.
        }
      } else {
        // The reserved intent remains ineligible until its fixed reclaim time.
      }
      uploadError.cleanup = { intentId: intent.id, intentResolved, deleteSucceeded: false };
      throw uploadError;
    }

    if (object.requireCreated && !uploadResult.created) {
      await cleanupService.resolveObjectCleanupIntent({ intentId: intent.id });
      throw Object.assign(new Error('Deterministic migration key already exists'), {
        code: 'OBJECT_KEY_OWNERSHIP_CONFLICT', preExistingObject: true,
      });
    }

    try {
      if (typeof cleanupService.assertStorageKeyWritable === 'function') {
        await cleanupService.assertStorageKeyWritable({ provider: 'r2', storageKey: object.key });
      }
    } catch (tombstoneError) {
      if (uploadResult.created) await deletePrivateObjectIfOwned(object.key, intent.id);
      await cleanupService.resolveObjectCleanupIntent({
        intentId: intent.id,
        error: tombstoneError,
        reason: 'STORAGE_KEY_TOMBSTONED',
      });
      throw tombstoneError;
    }

    if (!uploadResult.created) {
      await cleanupService.resolveObjectCleanupIntent({ intentId: intent.id });
    } else {
      try {
        await cleanupService.armObjectCleanupIntent({ intentId: intent.id });
      } catch (armError) {
        let deleteSucceeded = false;
        try {
          const deleteResult = await deletePrivateObjectIfOwned(object.key, intent.id);
          deleteSucceeded = Boolean(deleteResult.deleted || deleteResult.missing);
          await cleanupService.resolveObjectCleanupIntent({ intentId: intent.id });
        } catch (deleteError) {
          armError.cleanup = {
            intentId: intent.id,
            deleteSucceeded,
            reclaimableAfterSafetyDelay: true,
            deleteErrorCode: deleteError.code,
          };
        }
        throw armError;
      }
    }

    try {
      if (!additionalIntentIds.length) {
        return await cleanupService.persistAndResolveObjectCleanupIntent({
          intentId: intent.id,
          persist,
        });
      }
      return await cleanupService.persistAndResolveObjectCleanupIntents({
        intentIds: [intent.id, ...additionalIntentIds], persist,
      });
    } catch (businessError) {
      if (businessError.transactionOutcome === 'unknown') {
        businessError.cleanup = {
          intentId: intent.id,
          deleteSucceeded: false,
          intentResolved: false,
        };
        throw businessError;
      }
      let deleteSucceeded = false;
      let intentResolved = false;
      if (!uploadResult.created) {
        businessError.cleanup = { intentId: intent.id, deleteSucceeded, intentResolved: true };
        throw businessError;
      }
      try {
        const deleteResult = await deletePrivateObjectIfOwned(object.key, intent.id);
        deleteSucceeded = Boolean(deleteResult.deleted || deleteResult.missing);
        try {
          await cleanupService.resolveObjectCleanupIntent({ intentId: intent.id });
          intentResolved = true;
        } catch (_resolveError) {
          // The original pending intent remains durable for idempotent retry.
        }
      } catch (deleteError) {
        try {
          await cleanupService.markObjectCleanupIntentDue({
            intentId: intent.id,
            error: deleteError,
          });
        } catch (_markError) {
          // The pre-upload intent is already durable even if this update fails.
        }
      }
      businessError.cleanup = { intentId: intent.id, deleteSucceeded, intentResolved };
      throw businessError;
    }
  }

  return {
    putPrivateObject,
    putMigratedObject,
    listPrivateObjects,
    withPrivateObjectStream,
    readPrivateObjectBuffer,
    headPrivateObject,
    checkReady,
    deletePrivateObject,
    deletePrivateObjectIfOwned,
    createSignedDownload,
    putWithCleanupIntent,
  };
}

let defaultStorage;

function getDefaultStorage() {
  if (!defaultStorage) {
    const client = new S3Client(buildR2ClientConfig());
    const bucket = requireConfig(process.env.R2_PRIVATE_BUCKET, 'R2_PRIVATE_BUCKET');
    defaultStorage = createObjectStorage({ client, bucket });
  }
  return defaultStorage;
}

module.exports = {
  buildR2ClientConfig,
  createObjectStorage,
  putPrivateObject: (...args) => getDefaultStorage().putPrivateObject(...args),
  putMigratedObject: (...args) => getDefaultStorage().putMigratedObject(...args),
  listPrivateObjects: (...args) => getDefaultStorage().listPrivateObjects(...args),
  withPrivateObjectStream: (...args) => getDefaultStorage().withPrivateObjectStream(...args),
  readPrivateObjectBuffer: (...args) => getDefaultStorage().readPrivateObjectBuffer(...args),
  headPrivateObject: (...args) => getDefaultStorage().headPrivateObject(...args),
  checkReady: (...args) => getDefaultStorage().checkReady(...args),
  deletePrivateObject: (...args) => getDefaultStorage().deletePrivateObject(...args),
  deletePrivateObjectIfOwned: (...args) => getDefaultStorage().deletePrivateObjectIfOwned(...args),
  createSignedDownload: (...args) => getDefaultStorage().createSignedDownload(...args),
  putWithCleanupIntent: (...args) => getDefaultStorage().putWithCleanupIntent(...args),
};
