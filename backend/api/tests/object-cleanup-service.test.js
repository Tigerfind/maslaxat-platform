const { resetDb, models } = require('./helpers');
const { createObjectStorage } = require('../src/services/objectStorage');
const cleanupService = require('../src/services/objectCleanupTaskService');

const { sequelize, ObjectCleanupTask, PlatformSetting } = models;

const object = {
  key: 'profile-imports/42/cleanup-intent',
  body: Buffer.from('%PDF-1.7'),
  contentType: 'application/pdf',
  checksum: '86edbaa24831badfa0a8b04bb410141e2ee4182b6d0014493fe262a7a331c20b',
};

beforeEach(resetDb);

test('cleanup task model accepts only routed R2 and local providers', async () => {
  await expect(ObjectCleanupTask.create({
    storageKey: 'unsafe/provider', provider: 'ftp', status: 'pending', nextAttemptAt: new Date(),
  })).rejects.toThrow();
  await expect(ObjectCleanupTask.create({
    storageKey: '/safe/local', provider: 'local', status: 'pending', nextAttemptAt: new Date(),
  })).resolves.toBeTruthy();
});

test('orphan cleanup scheduling is idempotent and proofless objects require manual review', async () => {
  const first = await cleanupService.scheduleObjectCleanup({ storageKey: 'orphan/proofless' });
  const second = await cleanupService.scheduleObjectCleanup({ storageKey: 'orphan/proofless' });
  expect(first.created).toBe(true);
  expect(first.task).toMatchObject({
    status: 'manual_review', preventsKeyReuse: true, requiresOwnershipProof: false,
  });
  expect(second.created).toBe(false);
  expect(second.task.id).toBe(first.task.id);
  expect(await ObjectCleanupTask.count({ where: { storageKey: 'orphan/proofless' } })).toBe(1);
});

test('orphan cleanup scheduling preserves provider ownership proof for worker deletion', async () => {
  const ownershipToken = '11111111-1111-4111-8111-111111111111';
  const result = await cleanupService.scheduleObjectCleanup({
    storageKey: 'orphan/owned', ownershipToken,
  });
  expect(result.task).toMatchObject({
    status: 'pending', preventsKeyReuse: true, requiresOwnershipProof: true, ownershipToken,
  });
});

test('reserved intents are not persistable deletes until armed or their fixed reclaim time arrives', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  const intent = await cleanupService.createObjectCleanupIntent({
    storageKey: 'documents/owner/reserved',
    provider: 'r2',
    reserveCleanup: true,
    reclaimReserved: true,
    now,
  });

  expect(intent).toMatchObject({ status: 'reserved', nextAttemptAt: expect.any(Date) });
  expect(intent.nextAttemptAt.getTime() - now.getTime()).toBe(cleanupService.RESERVED_RECLAIM_MS);
  const deleteObject = jest.fn();
  await expect(cleanupService.processObjectCleanupTasks({
    now: new Date(intent.nextAttemptAt.getTime() - 1), deleteObject,
  })).resolves.toMatchObject({ claimed: 0 });
  expect(deleteObject).not.toHaveBeenCalled();
});

function databaseWithAmbiguousCommit(mode, commitError) {
  return {
    async transaction(callback) {
      const transaction = await sequelize.transaction();
      const commit = transaction.commit.bind(transaction);
      const rollback = transaction.rollback.bind(transaction);

      if (callback) {
        let result;
        try {
          result = await callback(transaction);
        } catch (error) {
          await rollback();
          throw error;
        }
        if (mode === 'succeeded') await commit();
        else await rollback();
        throw commitError;
      }

      transaction.commit = async () => {
        if (mode === 'succeeded') await commit();
        else await rollback();
        throw commitError;
      };
      return transaction;
    },
  };
}

function cleanupServiceWithDatabase(database) {
  return {
    ...cleanupService,
    persistAndResolveObjectCleanupIntent: (options) => (
      cleanupService.persistAndResolveObjectCleanupIntent({ ...options, database })
    ),
  };
}

test('creates a durable intent before PUT and atomically completes it with business persistence', async () => {
  const events = [];
  const client = {
    async send(command) {
      expect(command.constructor.name).toBe('PutObjectCommand');
      const intent = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
      expect(intent).toMatchObject({ status: 'reserved', attempts: 0 });
      events.push('put');
      return { ETag: 'stored' };
    },
  };
  const storage = createObjectStorage({ client, bucket: 'private-imports' });

  const result = await storage.putWithCleanupIntent({
    object,
    persist: async ({ transaction }) => {
      events.push('persist');
      await PlatformSetting.create(
        { key: 'profile-import:test', value: 'created' },
        { transaction }
      );
      return { id: 'business-record' };
    },
  });

  expect(result).toEqual({ id: 'business-record' });
  expect(events).toEqual(['put', 'persist']);
  await expect(PlatformSetting.findByPk('profile-import:test')).resolves.toBeTruthy();
  const intent = await ObjectCleanupTask.findOne();
  expect(intent).toMatchObject({ status: 'completed', attempts: 0, lastError: null });
  expect(intent.nextAttemptAt).toBeNull();
});

test('protected migration stream uses the cleanup intent and persists only a newly created object', async () => {
  const body = require('stream').Readable.from(['legacy-stream']);
  const checksum = require('crypto').createHash('sha256').update('legacy-stream').digest('hex');
  const contentMD5 = require('crypto').createHash('md5').update('legacy-stream').digest('base64');
  const client = { send: jest.fn(async (command) => {
    expect(command.constructor.name).toBe('PutObjectCommand');
    const chunks = [];
    for await (const chunk of command.input.Body) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('legacy-stream');
    expect(command.input.Metadata.cleanupIntentId).toMatch(/^[0-9a-f-]{36}$/);
    return {};
  }) };
  const storage = createObjectStorage({ client, bucket: 'private-imports' });
  const persist = jest.fn(async () => 'persisted');
  await expect(storage.putWithCleanupIntent({
    object: {
      key: `legacy/documents/1/${checksum}`, body, contentType: 'text/plain', checksum,
      contentMD5, contentLength: 13, requireCreated: true,
    },
    persist,
  })).resolves.toBe('persisted');
  expect(persist).toHaveBeenCalledTimes(1);
});

test('does not upload when durable intent creation fails', async () => {
  let uploads = 0;
  const storage = createObjectStorage({
    client: { send: async () => { uploads += 1; } },
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      createObjectCleanupIntent: async () => { throw new Error('database unavailable'); },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => ({}) }))
    .rejects.toThrow('database unavailable');
  expect(uploads).toBe(0);
});

test('deletes a business row and creates its R2 cleanup task in one transaction', async () => {
  await PlatformSetting.create({ key: 'delete-with-object', value: 'present' });

  const task = await cleanupService.deleteBusinessRowWithCleanupTask({
    storageKey: 'documents/owner/file',
    destroy: ({ transaction }) => PlatformSetting.destroy({
      where: { key: 'delete-with-object' }, transaction,
    }),
  });

  await expect(PlatformSetting.findByPk('delete-with-object')).resolves.toBeNull();
  expect(task).toMatchObject({
    storageKey: 'documents/owner/file', provider: 'r2', status: 'manual_review', attempts: 0,
    lastError: 'OWNERSHIP_PROOF_MISSING', preventsKeyReuse: true,
  });
  expect(task.nextAttemptAt).toBeNull();
});

test('deletes a dual-backed business row with R2 and local cleanup tasks atomically', async () => {
  await PlatformSetting.create({ key: 'delete-dual-object', value: 'present' });

  const tasks = await cleanupService.deleteBusinessRowWithCleanupTasks({
    objects: [
      { storageKey: 'documents/owner/dual', provider: 'r2' },
      { storageKey: '/safe/uploads/documents/owner/dual', provider: 'local' },
    ],
    destroy: ({ transaction }) => PlatformSetting.destroy({
      where: { key: 'delete-dual-object' }, transaction,
    }),
  });

  await expect(PlatformSetting.findByPk('delete-dual-object')).resolves.toBeNull();
  expect(tasks.map((task) => task.provider).sort()).toEqual(['local', 'r2']);
  expect(tasks.every((task) => task.status === 'manual_review')).toBe(true);
});

test('atomically persists a business row and resolves R2 and local pre-write intents', async () => {
  const r2 = await cleanupService.createObjectCleanupIntent({
    storageKey: 'documents/owner/file', provider: 'r2', reserveCleanup: true,
  });
  const local = await cleanupService.createObjectCleanupIntent({
    storageKey: '/safe/uploads/documents/owner/file', provider: 'local', reserveCleanup: true,
  });
  await cleanupService.armObjectCleanupIntent({ intentId: r2.id });
  await cleanupService.armObjectCleanupIntent({ intentId: local.id });

  await cleanupService.persistAndResolveObjectCleanupIntents({
    intentIds: [r2.id, local.id],
    persist: ({ transaction, cleanupIntentIds }) => PlatformSetting.create({
      key: 'dual:persisted', value: cleanupIntentIds.join(','),
    }, { transaction }),
  });

  await expect(PlatformSetting.findByPk('dual:persisted')).resolves.toBeTruthy();
  const intents = await ObjectCleanupTask.findAll({ order: [['provider', 'ASC']] });
  expect(intents.map((intent) => [intent.provider, intent.status])).toEqual([
    ['local', 'completed'], ['r2', 'completed'],
  ]);
});

test('rolls back business persistence and both intent resolutions together', async () => {
  const r2 = await cleanupService.createObjectCleanupIntent({
    storageKey: 'documents/owner/rollback', provider: 'r2', reserveCleanup: true,
  });
  const local = await cleanupService.createObjectCleanupIntent({
    storageKey: '/safe/uploads/documents/owner/rollback', provider: 'local', reserveCleanup: true,
  });
  await cleanupService.armObjectCleanupIntent({ intentId: r2.id });
  await cleanupService.armObjectCleanupIntent({ intentId: local.id });

  await expect(cleanupService.persistAndResolveObjectCleanupIntents({
    intentIds: [r2.id, local.id],
    persist: async ({ transaction }) => {
      await PlatformSetting.create({ key: 'dual:rollback', value: 'no' }, { transaction });
      throw new Error('rollback both');
    },
  })).rejects.toMatchObject({ transactionOutcome: 'rolled_back' });

  await expect(PlatformSetting.findByPk('dual:rollback')).resolves.toBeNull();
  const intents = await ObjectCleanupTask.findAll();
  expect(intents.every((intent) => intent.status === 'pending')).toBe(true);
});

test('a concurrent tombstone commits before PUT persistence and prevents a business row', async () => {
  const intent = await cleanupService.createObjectCleanupIntent({
    storageKey: 'documents/owner/tombstone-race',
    provider: 'r2',
    reserveCleanup: true,
  });
  await cleanupService.armObjectCleanupIntent({ intentId: intent.id });
  await PlatformSetting.create({ key: 'race:source', value: 'present' });

  let releaseDelete;
  const deletePaused = new Promise((resolve) => { releaseDelete = resolve; });
  let tombstoneWritten;
  const tombstoneReady = new Promise((resolve) => { tombstoneWritten = resolve; });
  const deletion = cleanupService.deleteBusinessRowWithCleanupTask({
    storageKey: intent.storageKey,
    provider: 'r2',
    destroy: async ({ transaction }) => {
      tombstoneWritten();
      await deletePaused;
      await PlatformSetting.destroy({ where: { key: 'race:source' }, transaction });
    },
  });
  await tombstoneReady;

  let persistenceSettled = false;
  const persistence = cleanupService.persistAndResolveObjectCleanupIntent({
    intentId: intent.id,
    persist: ({ transaction }) => PlatformSetting.create(
      { key: 'race:destination', value: intent.storageKey },
      { transaction }
    ),
  }).then(
    (value) => { persistenceSettled = true; return value; },
    (error) => { persistenceSettled = true; throw error; }
  );
  await new Promise((resolve) => setTimeout(resolve, 75));
  expect(persistenceSettled).toBe(false);

  releaseDelete();
  await deletion;
  await expect(persistence).rejects.toMatchObject({ code: 'STORAGE_KEY_TOMBSTONED' });
  await expect(PlatformSetting.findByPk('race:destination')).resolves.toBeNull();
  await expect(ObjectCleanupTask.findByPk(intent.id)).resolves.toMatchObject({
    preventsKeyReuse: true,
  });
});

test('ambiguous upload failure never deletes and leaves the pre-created intent reserved without unsafe error text', async () => {
  const uploadError = Object.assign(
    new Error('resume.pdf body=secret accessKey=top-secret'),
    { code: 'ECONNRESET' }
  );
  const events = [];
  const storage = createObjectStorage({
    client: {
      send: async (command) => {
        events.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') throw uploadError;
        return {};
      },
    },
    bucket: 'private-imports',
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => ({}) }))
    .rejects.toBe(uploadError);

  const intent = await ObjectCleanupTask.findOne();
  expect(intent).toMatchObject({
    status: 'reserved',
    lastError: null,
  });
  expect(intent.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  expect(events).toEqual(['PutObjectCommand']);
  expect(JSON.stringify(intent.toJSON())).not.toMatch(/resume\.pdf|body=|secret|accessKey/i);
});

test('business rollback deletes the object but preserves pending intent if DB becomes unavailable', async () => {
  const events = [];
  let metadata;
  const databaseError = new Error('business persistence failed');
  const storage = createObjectStorage({
    client: {
      async send(command) {
        events.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') metadata = command.input.Metadata;
        if (command.constructor.name === 'HeadObjectCommand') return { ETag: 'stored', Metadata: metadata };
        return {};
      },
    },
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      resolveObjectCleanupIntent: async () => { throw new Error('database unavailable'); },
    },
  });

  let received;
  try {
    await storage.putWithCleanupIntent({
      object,
      persist: async ({ transaction }) => {
        await PlatformSetting.create(
          { key: 'profile-import:rollback', value: 'must rollback' },
          { transaction }
        );
        throw databaseError;
      },
    });
  } catch (error) {
    received = error;
  }

  expect(received).toBe(databaseError);
  expect(received.cleanup).toEqual({
    intentId: expect.any(String),
    deleteSucceeded: true,
    intentResolved: false,
  });
  expect(events).toEqual(['PutObjectCommand', 'HeadObjectCommand', 'DeleteObjectCommand']);
  await expect(PlatformSetting.findByPk('profile-import:rollback')).resolves.toBeNull();
  const intent = await ObjectCleanupTask.findOne();
  expect(intent.status).toBe('pending');
});

test('failed delete leaves the original durable intent pending and preserves the business error', async () => {
  const databaseError = new Error('database insert failed');
  const client = {
    async send(command) {
      if (command.constructor.name === 'PutObjectCommand') return { ETag: 'stored' };
      throw Object.assign(new Error('secret delete detail'), { code: 'ETIMEDOUT' });
    },
  };
  const storage = createObjectStorage({ client, bucket: 'private-imports' });

  let received;
  try {
    await storage.putWithCleanupIntent({
      object,
      persist: async () => { throw databaseError; },
    });
  } catch (error) {
    received = error;
  }

  expect(received).toBe(databaseError);
  expect(received.cleanup).toEqual({
    intentId: expect.any(String),
    deleteSucceeded: false,
    intentResolved: false,
  });
  const intent = await ObjectCleanupTask.findOne();
  expect(intent).toMatchObject({
    storageKey: object.key,
    provider: 'r2',
    status: 'pending',
    attempts: 0,
    lastError: 'OBJECT_DELETE_FAILED:ETIMEDOUT',
  });
  expect(intent.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(JSON.stringify(intent.toJSON())).not.toContain('secret delete detail');
});

test('business rollback never deletes an exact pre-existing object reused after conditional conflict', async () => {
  const databaseError = new Error('business insert failed');
  const events = [];
  const storage = createObjectStorage({
    client: {
      async send(command) {
        events.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') {
          throw Object.assign(new Error('exists'), {
            name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
          });
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return {
            ContentLength: object.body.length,
            ContentType: object.contentType,
            Metadata: { sha256: object.checksum },
          };
        }
        throw new Error('pre-existing object must not be deleted');
      },
    },
    bucket: 'private-imports',
  });

  await expect(storage.putWithCleanupIntent({
    object,
    persist: async () => { throw databaseError; },
  })).rejects.toBe(databaseError);

  expect(events).toEqual(['PutObjectCommand', 'HeadObjectCommand']);
  const intent = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
  expect(intent.status).toBe('completed');
});

test('a reused-object intent remains unscheduled and undeletable if resolving it fails', async () => {
  const events = [];
  const storage = createObjectStorage({
    client: {
      async send(command) {
        events.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') {
          throw Object.assign(new Error('exists'), {
            name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
          });
        }
        return {
          ContentLength: object.body.length,
          ContentType: object.contentType,
          Metadata: { sha256: object.checksum },
        };
      },
    },
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      resolveObjectCleanupIntent: async () => { throw new Error('database unavailable'); },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toThrow('database unavailable');
  const intent = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
  expect(intent).toMatchObject({ status: 'reserved', nextAttemptAt: expect.any(Date) });
  const deleteObject = jest.fn();
  await expect(cleanupService.processObjectCleanupTasks({ deleteObject }))
    .resolves.toMatchObject({ claimed: 0 });
  expect(deleteObject).not.toHaveBeenCalled();
});

test('a conditional conflict with failed HEAD never arms deletion of the pre-existing key', async () => {
  const headError = Object.assign(new Error('HEAD unavailable'), { code: 'ECONNRESET' });
  const storage = createObjectStorage({
    client: {
      async send(command) {
        if (command.constructor.name === 'PutObjectCommand') {
          throw Object.assign(new Error('exists'), {
            name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
          });
        }
        throw headError;
      },
    },
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      resolveObjectCleanupIntent: async () => { throw new Error('database unavailable'); },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toBe(headError);
  const intent = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
  expect(intent).toMatchObject({ status: 'reserved', nextAttemptAt: expect.any(Date) });
  const deleteObject = jest.fn();
  await expect(cleanupService.processObjectCleanupTasks({ deleteObject }))
    .resolves.toMatchObject({ claimed: 0 });
  expect(deleteObject).not.toHaveBeenCalled();
});

test('post-PUT arm failure deletes the newly created object and resolves its reservation', async () => {
  const objects = new Map();
  const events = [];
  const client = {
    async send(command) {
      const { Key, Body, Metadata } = command.input;
      events.push(command.constructor.name);
      if (command.constructor.name === 'PutObjectCommand') {
        objects.set(Key, { Body, Metadata });
        return {};
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        return { ETag: 'stored', Metadata: objects.get(Key).Metadata };
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        objects.delete(Key);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  const armError = new Error('database unavailable after PUT');
  const storage = createObjectStorage({
    client,
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      armObjectCleanupIntent: async () => { throw armError; },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toBe(armError);
  expect(events).toEqual(['PutObjectCommand', 'HeadObjectCommand', 'DeleteObjectCommand']);
  expect(objects.size).toBe(0);
  const intent = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
  expect(intent.status).toBe('completed');
});

test('arm and delete failure leaves an owned reservation reclaimable, then retry creates no orphan', async () => {
  const objects = new Map();
  let failArm = true;
  let failDelete = true;
  const client = {
    async send(command) {
      const { Key, Body, ContentLength, ContentType, Metadata } = command.input;
      if (command.constructor.name === 'PutObjectCommand') {
        if (objects.has(Key)) {
          throw Object.assign(new Error('exists'), {
            name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 },
          });
        }
        objects.set(Key, { Body, ContentLength, ContentType, Metadata });
        return {};
      }
      if (command.constructor.name === 'HeadObjectCommand') {
        const stored = objects.get(Key);
        return {
          ETag: 'stored', ContentLength: stored.ContentLength,
          ContentType: stored.ContentType, Metadata: stored.Metadata,
        };
      }
      if (command.constructor.name === 'DeleteObjectCommand') {
        if (failDelete) throw Object.assign(new Error('delete unavailable'), { code: 'ETIMEDOUT' });
        objects.delete(Key);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  const storage = createObjectStorage({
    client,
    bucket: 'private-imports',
    cleanupService: {
      ...cleanupService,
      armObjectCleanupIntent: (options) => {
        if (failArm) throw new Error('arm unavailable');
        return cleanupService.armObjectCleanupIntent(options);
      },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toThrow('arm unavailable');
  const reserved = await ObjectCleanupTask.findOne({ where: { storageKey: object.key } });
  expect(reserved).toMatchObject({ status: 'reserved', nextAttemptAt: expect.any(Date) });
  expect(objects.get(object.key).Metadata.cleanupIntentId).toBe(reserved.id);

  const before = await cleanupService.processObjectCleanupTasks({
    now: new Date(reserved.nextAttemptAt.getTime() - 1),
    deleteByProvider: { r2: jest.fn() },
  });
  expect(before.claimed).toBe(0);

  failDelete = false;
  const reclaimed = await cleanupService.processObjectCleanupTasks({
    now: reserved.nextAttemptAt,
    deleteByProvider: {
      r2: async (key, claim) => {
        expect(claim.ownershipToken).toBe(reserved.id);
        expect(objects.get(key).Metadata.cleanupIntentId).toBe(claim.ownershipToken);
        objects.delete(key);
      },
    },
  });
  expect(reclaimed.completed).toBe(1);
  expect(objects.size).toBe(0);

  failArm = false;
  await expect(storage.putWithCleanupIntent({
    object,
    persist: async () => ({ id: 'business-row' }),
  })).resolves.toEqual({ id: 'business-row' });
  expect(objects.size).toBe(1);
  expect(await ObjectCleanupTask.count({ where: { status: 'pending' } })).toBe(0);
});

test.each([
  ['commit succeeded but acknowledgement threw', 'succeeded', true, 'completed'],
  ['commit failed with unknown outcome', 'failed', false, 'pending'],
])('never deletes after ambiguous transaction commit: %s', async (_label, mode, rowExists, intentStatus) => {
  const commitError = new Error('commit acknowledgement unavailable');
  const events = [];
  const database = databaseWithAmbiguousCommit(mode, commitError);
  const storage = createObjectStorage({
    client: {
      async send(command) {
        events.push(command.constructor.name);
        return {};
      },
    },
    bucket: 'private-imports',
    cleanupService: cleanupServiceWithDatabase(database),
  });

  let received;
  try {
    await storage.putWithCleanupIntent({
      object: { ...object, key: `profile-imports/42/ambiguous-${mode}` },
      persist: async ({ transaction }) => {
        await PlatformSetting.create(
          { key: `ambiguous:${mode}`, value: 'business row' },
          { transaction }
        );
      },
    });
  } catch (error) {
    received = error;
  }

  expect(received).toBe(commitError);
  expect(received.transactionOutcome).toBe('unknown');
  expect(events).toEqual(['PutObjectCommand']);
  await expect(PlatformSetting.findByPk(`ambiguous:${mode}`))
    .resolves[rowExists ? 'toBeTruthy' : 'toBeNull']();
  const intent = await ObjectCleanupTask.findOne({
    where: { storageKey: `profile-imports/42/ambiguous-${mode}` },
  });
  expect(intent.status).toBe(intentStatus);
});

test('deletion tombstone rejects rewriting the same R2 key while pending and after cleanup', async () => {
  const intentId = '81111111-1111-4111-8111-111111111111';
  await ObjectCleanupTask.create({
    id: intentId,
    storageKey: object.key,
    provider: 'r2',
    status: 'completed',
    nextAttemptAt: null,
    requiresOwnershipProof: true,
    ownershipToken: intentId,
  });
  const task = await cleanupService.deleteBusinessRowWithCleanupTask({
    storageKey: object.key,
    provider: 'r2',
    destroy: async () => undefined,
  });
  expect(task).toMatchObject({
    id: intentId, status: 'pending', preventsKeyReuse: true,
    requiresOwnershipProof: true, ownershipToken: intentId,
  });

  const providerCall = jest.fn();
  const storage = createObjectStorage({
    client: { send: providerCall }, bucket: 'private-imports',
  });
  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toMatchObject({ code: 'STORAGE_KEY_TOMBSTONED' });
  expect(providerCall).not.toHaveBeenCalled();

  await task.update({ status: 'completed', nextAttemptAt: null });
  await expect(storage.putWithCleanupIntent({ object, persist: async () => undefined }))
    .rejects.toMatchObject({ code: 'STORAGE_KEY_TOMBSTONED' });
  expect(providerCall).not.toHaveBeenCalled();
});

test('a tombstone appearing after PUT rejects the write and compensates the owned object', async () => {
  const intentId = '82222222-2222-4222-8222-222222222222';
  const tombstoneError = Object.assign(new Error('key deletion has started'), {
    code: 'STORAGE_KEY_TOMBSTONED',
  });
  const writable = jest.fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(tombstoneError);
  const events = [];
  let storedMetadata;
  const storage = createObjectStorage({
    bucket: 'private-imports',
    cleanupService: {
      createObjectCleanupIntent: async () => ({ id: intentId }),
      assertStorageKeyWritable: writable,
      armObjectCleanupIntent: async () => undefined,
      resolveObjectCleanupIntent: async () => undefined,
      persistAndResolveObjectCleanupIntent: async ({ persist }) => persist({ transaction: {} }),
    },
    client: {
      async send(command) {
        events.push(command.constructor.name);
        if (command.constructor.name === 'PutObjectCommand') {
          storedMetadata = command.input.Metadata;
          return {};
        }
        if (command.constructor.name === 'HeadObjectCommand') {
          return { Metadata: storedMetadata };
        }
        if (command.constructor.name === 'DeleteObjectCommand') return {};
        throw new Error('unexpected command');
      },
    },
  });

  await expect(storage.putWithCleanupIntent({ object, persist: jest.fn() }))
    .rejects.toBe(tombstoneError);
  expect(writable).toHaveBeenCalledTimes(2);
  expect(events).toEqual(['PutObjectCommand', 'HeadObjectCommand', 'DeleteObjectCommand']);
});

test('cleanup reconciliation reports terminal failed and manual-review tasks as bounded readiness blockers', async () => {
  await ObjectCleanupTask.bulkCreate([
    {
      storageKey: 'legacy/blocker-a', provider: 'r2', status: 'manual_review',
      nextAttemptAt: null, lastError: 'OWNERSHIP_PROOF_MISSING', preventsKeyReuse: true,
    },
    {
      storageKey: '/private/legacy/blocker-b', provider: 'local', status: 'manual_review',
      nextAttemptAt: null, lastError: 'OWNERSHIP_PROOF_MISSING', preventsKeyReuse: true,
    },
    {
      storageKey: 'history/completed', provider: 'r2', status: 'completed', nextAttemptAt: null,
    },
    {
      storageKey: 'history/failed', provider: 'r2', status: 'failed', nextAttemptAt: null,
      lastError: 'OBJECT_DELETE_FAILED:ETIMEDOUT', preventsKeyReuse: true,
    },
  ]);

  const blocked = await cleanupService.getObjectCleanupReconciliationReport({ blockerLimit: 1 });
  expect(blocked).toEqual({
    ready: false,
    total: 4,
    statusCounts: { completed: 1, failed: 1, manual_review: 2 },
    manualReviewCount: 2,
    failedCount: 1,
    blockers: [{
      id: expect.any(String), provider: expect.stringMatching(/^(r2|local)$/),
      reason: 'OWNERSHIP_PROOF_MISSING',
    }],
    blockersTruncated: true,
  });
  expect(JSON.stringify(blocked)).not.toMatch(/blocker-a|blocker-b|private\/legacy/);

  await ObjectCleanupTask.destroy({ where: { status: ['manual_review', 'failed'] } });
  await expect(cleanupService.getObjectCleanupReconciliationReport()).resolves.toEqual({
    ready: true,
    total: 1,
    statusCounts: { completed: 1 },
    manualReviewCount: 0,
    failedCount: 0,
    blockers: [],
    blockersTruncated: false,
  });
});
