const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { resetDb, models } = require('./helpers');
const cleanupService = require('../src/services/objectCleanupTaskService');
const { createFileStorageService } = require('../src/services/fileStorageService');

const { ObjectCleanupTask, PlatformSetting } = models;
const BODY = Buffer.from('owned local file');
const SHA256 = crypto.createHash('sha256').update(BODY).digest('hex');
const SCOPE = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';

let root;
beforeEach(async () => {
  await resetDb();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ownership-'));
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

function storageWithFailedArmAndRemove() {
  return createFileStorageService({
    objectStorage: {
      putWithCleanupIntent: async () => { throw new Error('R2 must not run after local arm failure'); },
      readPrivateObjectBuffer: async () => BODY,
      deletePrivateObject: async () => undefined,
      deletePrivateObjectIfOwned: async () => ({ deleted: true }),
    },
    cleanupService: {
      ...cleanupService,
      armObjectCleanupIntent: async () => { throw new Error('arm database unavailable'); },
    },
    fileSystem: {
      writeFile: fs.writeFile,
      rm: async () => { throw Object.assign(new Error('local remove unavailable'), { code: 'EBUSY' }); },
    },
    writeMode: 'dual',
    localRoot: root,
  });
}

async function createRecoverableOrphan() {
  await expect(storageWithFailedArmAndRemove().store({
    kind: 'document', scopeId: SCOPE, fileId: FILE, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toThrow('arm database unavailable');
  const task = await ObjectCleanupTask.findOne({ where: { provider: 'local' } });
  expect(task).toMatchObject({
    status: 'reserved',
    requiresOwnershipProof: true,
    ownershipToken: task.id,
    ownershipMetadata: expect.objectContaining({
      size: BODY.length,
      sha256: SHA256,
      dev: expect.any(String),
      ino: expect.any(String),
      mtimeMs: expect.any(Number),
    }),
    nextAttemptAt: expect.any(Date),
  });
  return task;
}

test('local arm/remove failure becomes reclaimable and eventually deletes the exact orphan', async () => {
  const task = await createRecoverableOrphan();
  const localPath = task.storageKey;
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);

  await expect(cleanupService.processObjectCleanupTasks({
    now: new Date(task.nextAttemptAt.getTime() - 1),
  })).resolves.toMatchObject({ claimed: 0 });
  const result = await cleanupService.processObjectCleanupTasks({ now: task.nextAttemptAt });

  expect(result.completed).toBe(1);
  await expect(fs.stat(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('local reclaim resolves safely without deleting a replacement file', async () => {
  const task = await createRecoverableOrphan();
  const localPath = task.storageKey;
  const replacement = Buffer.from('replacement file');
  await fs.rm(localPath, { force: true });
  await fs.writeFile(localPath, replacement);

  const result = await cleanupService.processObjectCleanupTasks({ now: task.nextAttemptAt });

  expect(result.completed).toBe(1);
  await expect(fs.readFile(localPath)).resolves.toEqual(replacement);
});

test('pre-write identity makes a crash immediately after exclusive write reclaimable', async () => {
  const crash = new Error('simulated crash after write');
  const storage = createFileStorageService({
    objectStorage: {
      putWithCleanupIntent: async () => { throw new Error('R2 must not run after local crash'); },
      readPrivateObjectBuffer: async () => BODY,
      deletePrivateObject: async () => undefined,
      deletePrivateObjectIfOwned: async () => ({ deleted: true }),
    },
    cleanupService: {
      ...cleanupService,
      recordObjectCleanupOwnership: async () => { throw crash; },
    },
    fileSystem: {
      writeFile: fs.writeFile,
      rm: async () => { throw Object.assign(new Error('process crashed before remove'), { code: 'EBUSY' }); },
    },
    writeMode: 'dual',
    localRoot: root,
  });

  await expect(storage.store({
    kind: 'document', scopeId: SCOPE, fileId: FILE, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toBe(crash);

  const task = await ObjectCleanupTask.findOne({ where: { provider: 'local' } });
  expect(task.ownershipMetadata).toEqual({
    expectedPath: task.storageKey,
    size: BODY.length,
    sha256: SHA256,
  });
  const result = await cleanupService.processObjectCleanupTasks({ now: task.nextAttemptAt });
  expect(result.completed).toBe(1);
  await expect(fs.stat(task.storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('local cleanup final check preserves a replacement injected after hashing', async () => {
  const localPath = path.join(root, 'raced-file');
  const replacement = Buffer.from('replacement after verification');
  await fs.writeFile(localPath, BODY, { flag: 'wx', mode: 0o600 });
  const stat = await fs.stat(localPath);
  const claim = {
    id: '88888888-8888-4888-8888-888888888888',
    requiresOwnershipProof: true,
    ownershipToken: '88888888-8888-4888-8888-888888888888',
    ownershipMetadata: {
      expectedPath: localPath,
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      size: BODY.length,
      sha256: SHA256,
    },
  };

  await expect(cleanupService.deleteLocalObjectIfOwned(localPath, claim, {
    beforeFinalCheck: async () => {
      await fs.rm(localPath);
      await fs.writeFile(localPath, replacement, { flag: 'wx', mode: 0o600 });
    },
  })).resolves.toEqual({ deleted: false, ownershipMismatch: true });
  await expect(fs.readFile(localPath)).resolves.toEqual(replacement);
});

test('business deletion persists exact local identity transactionally and worker retries a failed remove', async () => {
  const r2Key = `documents/${SCOPE}/${FILE}`;
  const r2IntentId = '89999999-9999-4999-8999-999999999999';
  let localPath = path.join(root, 'documents', SCOPE, FILE);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY, { flag: 'wx', mode: 0o600 });
  localPath = await fs.realpath(localPath);
  await PlatformSetting.create({ key: 'local-delete-row', value: 'present' });
  await ObjectCleanupTask.create({
    id: r2IntentId,
    storageKey: r2Key,
    provider: 'r2',
    status: 'completed',
    nextAttemptAt: null,
    requiresOwnershipProof: true,
    ownershipToken: r2IntentId,
  });
  const r2DeleteOwned = jest.fn(async () => ({ deleted: true }));
  const rawRm = jest.fn(async () => { throw new Error('raw local rm is forbidden'); });
  const storage = createFileStorageService({
    objectStorage: {
      putWithCleanupIntent: async () => undefined,
      readPrivateObjectBuffer: async () => BODY,
      deletePrivateObject: async () => { throw new Error('unconditional R2 delete is forbidden'); },
      deletePrivateObjectIfOwned: r2DeleteOwned,
    },
    cleanupService: {
      ...cleanupService,
      deleteLocalObjectIfOwned: async () => {
        throw Object.assign(new Error('local remove busy'), { code: 'EBUSY' });
      },
    },
    fileSystem: {
      writeFile: fs.writeFile,
      rm: rawRm,
    },
    writeMode: 'dual',
    localRoot: root,
  });

  const result = await storage.delete({
    record: { storageProvider: 'r2', storageKey: r2Key, path: localPath },
    destroy: async ({ transaction }) => {
      const localTask = await ObjectCleanupTask.findOne({
        where: { provider: 'local', storageKey: localPath }, transaction,
      });
      expect(localTask).toMatchObject({
        status: 'pending', requiresOwnershipProof: true,
        ownershipToken: localTask.id, preventsKeyReuse: true,
        ownershipMetadata: expect.objectContaining({
          expectedPath: localPath,
          size: BODY.length,
          sha256: SHA256,
          dev: expect.any(String),
          ino: expect.any(String),
        }),
      });
      await PlatformSetting.destroy({ where: { key: 'local-delete-row' }, transaction });
    },
  });

  expect(result).toEqual({ cleanupPending: true });
  expect(r2DeleteOwned).toHaveBeenCalledWith(r2Key, r2IntentId);
  expect(rawRm).not.toHaveBeenCalled();
  await expect(PlatformSetting.findByPk('local-delete-row')).resolves.toBeNull();
  const localTask = await ObjectCleanupTask.findOne({ where: { provider: 'local' } });
  expect(localTask.status).toBe('pending');
  const retried = await cleanupService.processObjectCleanupTasks({ now: localTask.nextAttemptAt });
  expect(retried.completed).toBe(1);
  await expect(fs.stat(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('local cleanup task creation failure rolls back the business deletion and R2 tombstone', async () => {
  const r2Key = `documents/${SCOPE}/${FILE}`;
  const r2IntentId = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const localPath = path.join(root, 'documents', SCOPE, FILE);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY, { flag: 'wx', mode: 0o600 });
  await PlatformSetting.create({ key: 'local-task-failure-row', value: 'present' });
  await ObjectCleanupTask.create({
    id: r2IntentId,
    storageKey: r2Key,
    provider: 'r2',
    status: 'completed',
    nextAttemptAt: null,
    requiresOwnershipProof: true,
    ownershipToken: r2IntentId,
  });
  const create = jest.spyOn(ObjectCleanupTask, 'create').mockRejectedValueOnce(
    Object.assign(new Error('cleanup task database unavailable'), { code: 'ECONNRESET' })
  );
  const storage = createFileStorageService({
    objectStorage: {
      putWithCleanupIntent: async () => undefined,
      readPrivateObjectBuffer: async () => BODY,
      deletePrivateObject: async () => undefined,
      deletePrivateObjectIfOwned: async () => ({ deleted: true }),
    },
    cleanupService,
    writeMode: 'dual',
    localRoot: root,
  });

  await expect(storage.delete({
    record: { storageProvider: 'r2', storageKey: r2Key, path: localPath },
    destroy: ({ transaction }) => PlatformSetting.destroy({
      where: { key: 'local-task-failure-row' }, transaction,
    }),
  })).rejects.toMatchObject({ code: 'ECONNRESET' });
  create.mockRestore();

  await expect(PlatformSetting.findByPk('local-task-failure-row')).resolves.toBeTruthy();
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);
  await expect(ObjectCleanupTask.findByPk(r2IntentId)).resolves.toMatchObject({
    status: 'completed', preventsKeyReuse: false,
  });
  await expect(ObjectCleanupTask.count({ where: { provider: 'local' } })).resolves.toBe(0);
});
