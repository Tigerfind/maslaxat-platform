const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable } = require('stream');

const {
  buildR2ClientConfig,
  createObjectStorage,
} = require('../src/services/objectStorage');
const {
  acceptPdfUpload,
  createUploadConcurrencyGate,
  pdfUploadErrorHandler,
  MAX_PDF_BYTES,
} = require('../src/middleware/pdfUpload');
const { createProfileImportRateLimit } = require('../src/middleware/profileImportRateLimit');

class MemoryS3 {
  constructor() {
    this.objects = new Map();
  }

  async send(command) {
    const { Bucket, Key, Body, ...metadata } = command.input;

    switch (command.constructor.name) {
      case 'PutObjectCommand':
        if (metadata.IfNoneMatch === '*' && this.objects.has(`${Bucket}/${Key}`)) {
          throw Object.assign(new Error('already exists'), {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 },
          });
        }
        this.objects.set(`${Bucket}/${Key}`, { body: Body, metadata });
        return { ETag: 'memory-etag' };
      case 'GetObjectCommand': {
        const object = this.objects.get(`${Bucket}/${Key}`);
        if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return {
          Body: Readable.from([object.body]),
          ContentType: object.metadata.ContentType,
          ContentLength: object.body.length,
          Metadata: object.metadata.Metadata,
          $metadata: { requestId: 'must-not-leak' },
        };
      }
      case 'HeadObjectCommand': {
        const object = this.objects.get(`${Bucket}/${Key}`);
        if (!object) throw Object.assign(new Error('missing'), { name: 'NotFound' });
        return {
          ContentLength: object.body.length,
          ContentType: object.metadata.ContentType,
          Metadata: object.metadata.Metadata,
        };
      }
      case 'DeleteObjectCommand':
        this.objects.delete(`${Bucket}/${Key}`);
        return {};
      default:
        throw new Error(`Unsupported command: ${command.constructor.name}`);
    }
  }
}

class MemoryRedis {
  constructor() {
    this.values = new Map();
  }

  async eval(_script, options) {
    const key = options.keys[0];
    const next = (this.values.get(key) || 0) + 1;
    this.values.set(key, next);
    return next;
  }
}

function uploadApp() {
  const app = express();
  app.post('/upload', (req, _res, next) => {
    req.userId = 42;
    next();
  }, acceptPdfUpload, (req, res) => {
    res.json({
      checksum: req.file.checksum,
      key: req.file.objectKey,
      size: req.file.size,
    });
  });
  app.use(pdfUploadErrorHandler);
  app.use((_error, _req, res, _next) => res.status(500).json({ code: 'UNHANDLED_ERROR' }));
  return app;
}

function rateLimitApp(middleware) {
  const app = express();
  app.get('/limited', (req, _res, next) => {
    req.userId = 7;
    next();
  }, middleware, (_req, res) => res.json({ ok: true }));
  return app;
}

function anonymousRateLimitApp(middleware) {
  const app = express();
  app.get('/limited', middleware, (_req, res) => res.json({ ok: true }));
  return app;
}

describe('private profile import object storage', () => {
  test('conditionally uploads a checksum-verified migration stream and accepts only an exact existing object', async () => {
    const sent = [];
    let conflict = false;
    const client = {
      async send(command) {
        sent.push(command);
        if (command.constructor.name === 'PutObjectCommand' && conflict) {
          throw Object.assign(new Error('exists'), { name: 'PreconditionFailed', statusCode: 412 });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return {
            ContentLength: 6,
            ContentType: 'text/plain',
            Metadata: { sha256: crypto.createHash('sha256').update('stream').digest('hex') },
          };
        }
        return {};
      },
    };
    const storage = createObjectStorage({ client, bucket: 'private' });
    const checksum = crypto.createHash('sha256').update('stream').digest('hex');
    await expect(storage.putMigratedObject({
      key: `legacy/documents/id/${checksum}`,
      body: Readable.from(['stream']),
      contentType: 'text/plain',
      checksum,
      contentMD5: crypto.createHash('md5').update('stream').digest('base64'),
      contentLength: 6,
    })).resolves.toMatchObject({ created: true });
    expect(sent[0].input).toMatchObject({ IfNoneMatch: '*', ContentLength: 6, Metadata: { sha256: checksum } });

    conflict = true;
    await expect(storage.putMigratedObject({
      key: `legacy/documents/id/${checksum}`,
      body: Readable.from(['stream']),
      contentType: 'text/plain', checksum,
      contentMD5: crypto.createHash('md5').update('stream').digest('base64'), contentLength: 6,
    })).resolves.toEqual({ created: false });
  });

  test('normalizes paginated private object listings without exposing provider response fields', async () => {
    const client = { send: jest.fn(async () => ({
      Contents: [{ Key: 'documents/u/d', Size: 12, LastModified: new Date('2026-08-18T00:00:00Z') }],
      NextContinuationToken: 'next-secret',
      IsTruncated: true,
      RequestCharged: 'must-not-leak',
    })) };
    const storage = createObjectStorage({ client, bucket: 'private' });
    await expect(storage.listPrivateObjects({ continuationToken: 'prior', maxKeys: 100 })).resolves.toEqual({
      objects: [{ key: 'documents/u/d', size: 12, lastModified: new Date('2026-08-18T00:00:00Z') }],
      isTruncated: true,
      nextContinuationToken: 'next-secret',
    });
    expect(client.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'private', ContinuationToken: 'prior', MaxKeys: 100,
    });
  });

  test('builds the private R2 SDK configuration without a public URL', async () => {
    const requestHandler = { handle: jest.fn() };
    const config = buildR2ClientConfig({
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_ACCESS_KEY_ID: 'scoped-access-key',
      R2_SECRET_ACCESS_KEY: 'scoped-secret',
    }, requestHandler);

    expect(config).toEqual({
      region: 'auto',
      endpoint: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: 'scoped-access-key',
        secretAccessKey: 'scoped-secret',
      },
      forcePathStyle: true,
      requestHandler,
      maxAttempts: 2,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    expect(JSON.stringify(config)).not.toContain('PUBLIC');

    const timedConfig = buildR2ClientConfig({
      R2_ACCOUNT_ID: 'a'.repeat(32),
      R2_ACCESS_KEY_ID: 'scoped-access-key',
      R2_SECRET_ACCESS_KEY: 'scoped-secret',
    });
    await expect(timedConfig.requestHandler.configProvider).resolves.toMatchObject({
      connectionTimeout: 3000,
      requestTimeout: 10000,
      socketTimeout: 10000,
    });
  });

  test.each([
    '',
    'account-id',
    'a'.repeat(31),
    'g'.repeat(32),
    `${'a'.repeat(32)}.evil.example`,
    `${'a'.repeat(32)}@evil.example`,
  ])('rejects an invalid R2 account ID before reading credentials: %s', (accountId) => {
    const env = { R2_ACCOUNT_ID: accountId };
    Object.defineProperties(env, {
      R2_ACCESS_KEY_ID: { get: () => { throw new Error('credential exposed'); } },
      R2_SECRET_ACCESS_KEY: { get: () => { throw new Error('credential exposed'); } },
    });

    expect(() => buildR2ClientConfig(env, { handle: jest.fn() }))
      .toThrow('R2_ACCOUNT_ID must be exactly 32 hexadecimal characters');
  });

  test('puts, heads, gets, and idempotently deletes a checksummed private object', async () => {
    const client = new MemoryS3();
    const storage = createObjectStorage({ client, bucket: 'private-imports' });
    const body = Buffer.from('%PDF-1.7\nsafe');

    await expect(storage.putPrivateObject({
      key: 'profile-imports/42/object-id',
      body,
      contentType: 'application/pdf',
      checksum: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
    })).resolves.toEqual(expect.objectContaining({ created: true }));

    const stored = client.objects.get('private-imports/profile-imports/42/object-id');
    expect(stored.metadata).toEqual({
      ContentType: 'application/pdf',
      ContentLength: 13,
      ContentMD5: 'FBPBBtoOLOr9MsjeeW0VuA==',
      Metadata: {
        sha256: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
      },
      IfNoneMatch: '*',
    });
    await expect(storage.headPrivateObject('profile-imports/42/object-id')).resolves.toMatchObject({
      ContentLength: 13,
      ContentType: 'application/pdf',
    });
    await expect(storage.withPrivateObjectStream(
      'profile-imports/42/object-id',
      async (stream, metadata) => ({
        content: Buffer.concat(await stream.toArray()).toString('utf8'),
        metadata,
      })
    )).resolves.toEqual({
      content: '%PDF-1.7\nsafe',
      metadata: {
        contentType: 'application/pdf',
        contentLength: 13,
        metadata: {
          sha256: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
        },
      },
    });

    await storage.deletePrivateObject('profile-imports/42/object-id');
    await expect(storage.deletePrivateObject('profile-imports/42/object-id')).resolves.toBeUndefined();
  });

  test('reuses an exact existing object without overwriting it', async () => {
    const client = new MemoryS3();
    const storage = createObjectStorage({ client, bucket: 'private-imports' });
    const object = {
      key: 'profile-imports/42/retry-object',
      body: Buffer.from('%PDF-1.7\nsafe'),
      contentType: 'application/pdf',
      checksum: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
    };

    await expect(storage.putPrivateObject(object)).resolves.toMatchObject({ created: true });
    await expect(storage.putPrivateObject(object)).resolves.toMatchObject({ created: false });
    expect(client.objects.get('private-imports/profile-imports/42/retry-object').body).toEqual(object.body);
  });

  test.each([
    ['size', { body: Buffer.from('%PDF-1.7\nunsafe') }, null],
    ['MIME', { contentType: 'text/plain' }, null],
    ['SHA metadata', {}, 'f'.repeat(64)],
  ])('rejects an existing key with mismatched %s without overwriting it', async (_label, retry, storedSha) => {
    const client = new MemoryS3();
    const storage = createObjectStorage({ client, bucket: 'private-imports' });
    const original = {
      key: 'profile-imports/42/conflict',
      body: Buffer.from('%PDF-1.7\nsafe'),
      contentType: 'application/pdf',
      checksum: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
    };
    await storage.putPrivateObject(original);
    if (storedSha) {
      client.objects.get('private-imports/profile-imports/42/conflict').metadata.Metadata.sha256 = storedSha;
    }

    const candidate = { ...original, ...retry };
    if (retry.body && !retry.checksum) {
      candidate.checksum = crypto.createHash('sha256').update(retry.body).digest('hex');
    }
    await expect(storage.putPrivateObject(candidate)).rejects.toMatchObject({
      code: 'OBJECT_KEY_CONFLICT',
    });
    expect(client.objects.get('private-imports/profile-imports/42/conflict').body).toEqual(original.body);
  });

  test('rejects a SHA-256 that does not match the uploaded body', async () => {
    const client = new MemoryS3();
    const storage = createObjectStorage({ client, bucket: 'private-imports' });

    await expect(storage.putPrivateObject({
      key: 'profile-imports/42/mismatch',
      body: Buffer.from('%PDF-1.7'),
      contentType: 'application/pdf',
      checksum: '0000000000000000000000000000000000000000000000000000000000000000',
    })).rejects.toThrow('checksum does not match body');
    expect(client.objects.size).toBe(0);
  });

  test('creates a short-lived signed GET that forces PDF attachment download', async () => {
    const signer = jest.fn(async (_client, command, options) => ({ command, options }));
    const storage = createObjectStorage({
      client: new MemoryS3(),
      bucket: 'private-imports',
      signer,
    });

    const signed = await storage.createSignedDownload('profile-imports/42/object-id', 300);

    expect(signed.command.constructor.name).toBe('GetObjectCommand');
    expect(signed.command.input).toEqual({
      Bucket: 'private-imports',
      Key: 'profile-imports/42/object-id',
      ResponseContentDisposition: 'attachment; filename="profile-import.pdf"',
      ResponseContentType: 'application/pdf',
    });
    expect(signed.options).toEqual({ expiresIn: 300 });
  });

  test('destroys the private body when a parser callback throws and never exposes the raw response', async () => {
    const body = Readable.from([Buffer.from('%PDF-1.7')]);
    const destroy = jest.spyOn(body, 'destroy');
    const client = {
      send: async () => ({
        Body: body,
        ContentType: 'application/pdf',
        ContentLength: 8,
        Metadata: { sha256: 'safe', privateProviderValue: 'must-not-leak' },
        SecretProviderField: 'must-not-leak',
      }),
    };
    const storage = createObjectStorage({ client, bucket: 'private-imports' });
    const parserError = new Error('parser failed');

    await expect(storage.withPrivateObjectStream('profile-imports/42/object-id', async (_stream, metadata) => {
      expect(metadata).toEqual({
        contentType: 'application/pdf',
        contentLength: 8,
        metadata: { sha256: 'safe' },
      });
      throw parserError;
    })).rejects.toBe(parserError);

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test('passes AbortSignal to the real S3 GetObject request', async () => {
    const controller = new AbortController();
    const calls = [];
    const content = Buffer.from('%PDF-1.7');
    const body = Readable.from([content]);
    const storage = createObjectStorage({
      client: {
        send: async (command, options) => {
          calls.push([command.constructor.name, options]);
          return { Body: body, ContentLength: content.length };
        },
      },
      bucket: 'private-imports',
    });

    await storage.withPrivateObjectStream(
      'profile-imports/42/object-id',
      async (stream) => stream.toArray(),
      { signal: controller.signal }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('GetObjectCommand');
    expect(calls[0][1]?.abortSignal).toBe(controller.signal);
  });

  test('bounded private reads abort when content exceeds the configured limit', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    const destroy = jest.spyOn(body, 'destroy');
    const storage = createObjectStorage({
      client: { send: async () => ({ Body: body, ContentLength: 12 }) },
      bucket: 'private-imports',
    });

    await expect(storage.readPrivateObjectBuffer('profile-imports/42/object-id', 10))
      .rejects.toThrow('Private object exceeds 10 byte read limit');
    expect(destroy).toHaveBeenCalled();
  });
});

describe('secure PDF upload middleware', () => {
  test('global upload gate rejects excess requests before handlers allocate and releases slots', async () => {
    expect(createUploadConcurrencyGate).toEqual(expect.any(Function));
    const gate = createUploadConcurrencyGate({ limit: 2 });
    const app = express();
    let entered = 0;
    let signalEntered;
    const bothEntered = new Promise((resolve) => { signalEntered = resolve; });
    let release;
    const blocker = new Promise((resolve) => { release = resolve; });
    app.get('/hold', gate, async (_req, res) => {
      entered += 1;
      if (entered === 2) signalEntered();
      await blocker;
      res.json({ ok: true });
    });
    const active = [
      request(app).get('/hold').then((response) => response),
      request(app).get('/hold').then((response) => response),
    ];
    await bothEntered;
    const rssBefore = process.memoryUsage().rss;

    const rejected = await Promise.all(
      Array.from({ length: 32 }, () => request(app).get('/hold'))
    );
    const rssGrowth = process.memoryUsage().rss - rssBefore;
    const enteredBeforeRelease = entered;
    release();
    await Promise.all(active);
    const afterRelease = await request(app).get('/hold');

    expect(rejected.every((response) => response.status === 503)).toBe(true);
    expect(rejected.every((response) => response.body.code === 'PROFILE_IMPORT_CONCURRENCY_LIMITED')).toBe(true);
    expect(enteredBeforeRelease).toBe(2);
    expect(rssGrowth).toBeLessThan(64 * 1024 * 1024);
    expect(afterRelease.status).toBe(200);
  });

  test('upload gate releases exactly once when close and finish both fire', () => {
    const gate = createUploadConcurrencyGate({ limit: 1 });
    const response = () => {
      const res = new EventEmitter();
      res.status = jest.fn(() => res);
      res.json = jest.fn(() => res);
      return res;
    };
    const first = response();
    const second = response();
    const rejected = response();
    const firstNext = jest.fn();
    const secondNext = jest.fn();
    const rejectedNext = jest.fn();

    gate({}, first, firstNext);
    first.emit('close');
    first.emit('finish');
    gate({}, second, secondNext);
    gate({}, rejected, rejectedNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(rejectedNext).not.toHaveBeenCalled();
    expect(rejected.status).toHaveBeenCalledWith(503);
    second.emit('finish');
  });

  test('accepts a real PDF signature, hashes it, and creates an opaque owner key', async () => {
    const response = await request(uploadApp())
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.7\nsafe'), {
        filename: 'linkedin.PDF',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      checksum: '0853475c0435c0a7be139dc45834246eb6df08f4e4ff9a348d65561f1671e309',
      size: 13,
    });
    expect(response.body.key).toMatch(/^profile-imports\/42\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test.each([
    ['fake PDF bytes', Buffer.from('not a pdf'), 'resume.pdf', 'application/pdf', 'INVALID_PDF_MAGIC'],
    ['wrong extension', Buffer.from('%PDF-1.7'), 'resume.txt', 'application/pdf', 'INVALID_PDF_EXTENSION'],
    ['wrong MIME', Buffer.from('%PDF-1.7'), 'resume.pdf', 'text/plain', 'INVALID_PDF_MIME'],
  ])('rejects %s', async (_label, body, filename, contentType, code) => {
    const response = await request(uploadApp())
      .post('/upload')
      .attach('file', body, { filename, contentType });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe(code);
  });

  test('rejects a PDF larger than 10 MiB before application processing', async () => {
    const body = Buffer.alloc(MAX_PDF_BYTES + 1, 0x20);
    body.write('%PDF-');

    const response = await request(uploadApp())
      .post('/upload')
      .attach('file', body, { filename: 'resume.pdf', contentType: 'application/pdf' });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('LIMIT_FILE_SIZE');
  });

  test('rejects multipart text fields through the production upload error handler', async () => {
    const response = await request(uploadApp())
      .post('/upload')
      .field('headline', 'must not be accepted')
      .attach('file', Buffer.from('%PDF-1.7'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'LIMIT_FIELD_COUNT', error: 'Invalid PDF upload' });
  });

  test('rejects multipart part/file-count abuse without falling through to 500', async () => {
    const response = await request(uploadApp())
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.7'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      })
      .attach('file', Buffer.from('%PDF-1.7'), {
        filename: 'second.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(['LIMIT_PART_COUNT', 'LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'])
      .toContain(response.body.code);
    expect(response.body.error).toBe('Invalid PDF upload');
  });

  test('rejects oversized multipart field names through the production handler', async () => {
    const response = await request(uploadApp())
      .post('/upload')
      .attach('f'.repeat(33), Buffer.from('%PDF-1.7'), {
        filename: 'resume.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'LIMIT_FIELD_KEY', error: 'Invalid PDF upload' });
  });
});

describe('profile import rate limits', () => {
  test('issues owner/kind-bound single-use reservation capabilities', async () => {
    const redis = new MemoryRedis();
    const quota = createProfileImportRateLimit({ getRedisClient: () => redis });
    expect(quota.reserve).toEqual(expect.any(Function));
    expect(quota.consumeReservation).toEqual(expect.any(Function));
    const reservation = await quota.reserve('upload', 'owner-capability');

    expect(() => quota.consumeReservation(reservation, 'upload', 'owner-capability')).not.toThrow();
    expect(() => quota.consumeReservation(reservation, 'upload', 'owner-capability')).toThrow(
      expect.objectContaining({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' })
    );
    const wrongKind = await quota.reserve('upload', 'owner-capability');
    expect(() => quota.consumeReservation(wrongKind, 'parse', 'owner-capability')).toThrow(
      expect.objectContaining({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' })
    );
    const wrongOwner = await quota.reserve('upload', 'owner-capability');
    expect(() => quota.consumeReservation(wrongOwner, 'upload', 'other-owner')).toThrow(
      expect.objectContaining({ code: 'PROFILE_IMPORT_QUOTA_RESERVATION_INVALID' })
    );
  });

  test('exposes one callable quota primitive for route and worker consumption', async () => {
    const redis = new MemoryRedis();
    const quota = createProfileImportRateLimit({
      getRedisClient: () => redis,
      now: () => Date.UTC(2026, 7, 16, 12, 30),
    });

    await expect(quota.consume('upload', 'owner-7')).resolves.toBe(1);
    await expect(quota.consume('parse', 'owner-7')).resolves.toBe(1);
    await expect(quota.consume('unknown', 'owner-7')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PROFILE_IMPORT_QUOTA',
    });
  });

  test('callable quota reports safe retry information when exhausted', async () => {
    const redis = new MemoryRedis();
    const quota = createProfileImportRateLimit({
      getRedisClient: () => redis,
      now: () => Date.UTC(2026, 7, 16, 12, 30),
    });

    await quota.consume('parse', 'owner-8');
    await quota.consume('parse', 'owner-8');
    await quota.consume('parse', 'owner-8');
    await expect(quota.consume('parse', 'owner-8')).rejects.toMatchObject({
      status: 429,
      code: 'PROFILE_IMPORT_RATE_LIMITED',
      retryAfter: expect.any(Number),
    });
  });

  test('rejects requests without an authenticated owner before consuming quota', async () => {
    const redis = new MemoryRedis();
    const limiter = createProfileImportRateLimit({ getRedisClient: () => redis });

    const response = await request(anonymousRateLimitApp(limiter.limitUploads)).get('/limited');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'AUTHENTICATION_REQUIRED' });
    expect(redis.values.size).toBe(0);
  });

  test.each([
    ['uploads', 'limitUploads', 5],
    ['parser starts', 'limitParserStarts', 3],
  ])('allows the configured number of %s and rejects the next attempt', async (_label, member, limit) => {
    const redis = new MemoryRedis();
    const stableLimiter = createProfileImportRateLimit({
      getRedisClient: () => redis,
      now: () => Date.UTC(2026, 7, 16, 12, 30),
    });
    const app = rateLimitApp(stableLimiter[member]);

    for (let attempt = 0; attempt < limit; attempt += 1) {
      await request(app).get('/limited').expect(200);
    }
    const rejected = await request(app).get('/limited');

    expect(rejected.status).toBe(429);
    expect(rejected.body).toEqual({ code: 'PROFILE_IMPORT_RATE_LIMITED' });
  });

  test('returns 503 in production when Redis is missing even if fallback is requested', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => null,
      environment: 'production',
      allowMemoryFallback: true,
    });

    const response = await request(rateLimitApp(limiter.limitUploads)).get('/limited');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE' });
  });

  test('uses memory fallback when explicitly enabled in test', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => null,
      environment: 'test',
      allowMemoryFallback: true,
      now: () => Date.UTC(2026, 7, 16, 12, 30),
    });
    const app = rateLimitApp(limiter.limitParserStarts);

    await request(app).get('/limited').expect(200);
    await request(app).get('/limited').expect(200);
    await request(app).get('/limited').expect(200);
    await request(app).get('/limited').expect(429);
  });

  test('does not permit memory fallback in staging', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => null,
      environment: 'staging',
      allowMemoryFallback: true,
    });

    await request(rateLimitApp(limiter.limitUploads)).get('/limited').expect(503);
  });

  test('fails closed on a malformed Redis counter result', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => ({ eval: async () => null }),
      environment: 'production',
    });

    await request(rateLimitApp(limiter.limitUploads)).get('/limited').expect(503);
  });

  test('returns 503 instead of bypassing the limit when Redis errors', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => ({ eval: async () => { throw new Error('redis down'); } }),
      environment: 'production',
    });

    const response = await request(rateLimitApp(limiter.limitUploads)).get('/limited');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE' });
  });

  test('returns 503 when production Redis initialization throws', async () => {
    const limiter = createProfileImportRateLimit({
      getRedisClient: () => { throw new Error('redis initialization failed'); },
      environment: 'production',
    });

    const response = await request(rateLimitApp(limiter.limitUploads)).get('/limited');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'PROFILE_IMPORT_RATE_LIMIT_UNAVAILABLE' });
  });
});
