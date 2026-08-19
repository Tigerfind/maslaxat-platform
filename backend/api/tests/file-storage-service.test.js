const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { PassThrough, Readable } = require('stream');
const { FILE_LIMITS, uploadLimitFor } = require('../src/config/fileLimits');

let buildStorageKey = () => { throw new Error('fileStorageService is not implemented'); };
let createFileStorageService = buildStorageKey;
try {
  ({ buildStorageKey, createFileStorageService } = require('../src/services/fileStorageService'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const IDS = Object.freeze({
  owner: '11111111-1111-4111-8111-111111111111',
  file: '22222222-2222-4222-8222-222222222222',
});
const BODY = Buffer.from('private legal document');
const SHA256 = crypto.createHash('sha256').update(BODY).digest('hex');

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'emaslaxat-storage-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function fakeObjectStorage(overrides = {}) {
  return {
    putWithCleanupIntent: async ({ object, persist }) => persist({
      transaction: { id: 'storage-transaction' }, cleanupIntentId: 'intent-1',
      cleanupIntentIds: ['intent-1'], object,
    }),
    readPrivateObjectBuffer: async () => BODY,
    headPrivateObject: async () => ({
      ContentLength: BODY.length, ContentType: 'application/pdf', Metadata: { sha256: SHA256 },
    }),
    withPrivateObjectStream: async (_key, consume) => consume(Readable.from([BODY]), {
      contentLength: BODY.length, contentType: 'application/pdf', metadata: { sha256: SHA256 },
    }),
    deletePrivateObject: async () => undefined,
    deletePrivateObjectIfOwned: async () => ({ deleted: true }),
    ...overrides,
  };
}

function fakeCleanup(overrides = {}) {
  return {
    createObjectCleanupIntent: async ({ storageKey, provider }) => ({
      id: `${provider}-intent`, storageKey, provider,
    }),
    armObjectCleanupIntent: async () => undefined,
    recordObjectCleanupOwnership: async () => undefined,
    deleteBusinessRowWithCleanupTask: async ({ destroy }) => {
      await destroy({ transaction: { id: 'delete-transaction' } });
      return {
        id: 'delete-task', provider: 'r2', storageKey: 'documents/private-key',
        status: 'pending', requiresOwnershipProof: true, ownershipToken: 'delete-task',
      };
    },
    deleteBusinessRowWithCleanupTasks: async ({ objects, destroy }) => {
      await destroy({ transaction: { id: 'delete-transaction' } });
      return objects.map((object, index) => ({
        id: `delete-task-${index}`,
        ...object,
        status: 'pending',
        requiresOwnershipProof: true,
        ownershipToken: `delete-task-${index}`,
      }));
    },
    deleteLocalObjectIfOwned: async (filePath) => fs.rm(filePath, { force: true }),
    resolveObjectCleanupIntent: async () => undefined,
    markObjectCleanupIntentDue: async () => undefined,
    ...overrides,
  };
}

test.each([
  ['avatar', 'avatars'],
  ['document', 'documents'],
  ['case', 'case-documents'],
  ['lawyer', 'lawyer-documents'],
])('builds deterministic opaque %s keys without using filenames', (kind, prefix) => {
  const input = { kind, scopeId: IDS.owner, fileId: IDS.file, originalName: '../../secret.pdf' };

  expect(buildStorageKey(input)).toBe(`${prefix}/${IDS.owner}/${IDS.file}`);
  expect(buildStorageKey(input)).not.toContain('secret.pdf');
});

test.each(['../owner', '/absolute', 'owner/child', '', 'a'.repeat(129)])(
  'rejects unsafe key segments: %s',
  (scopeId) => expect(() => buildStorageKey({ kind: 'document', scopeId, fileId: IDS.file })).toThrow()
);

test('accepts only UUID app file ids or explicit deterministic migration ids', () => {
  expect(() => buildStorageKey({
    kind: 'document', scopeId: IDS.owner, fileId: 'reused-human-name',
  })).toThrow('UUID or deterministic migration identifier');
  expect(buildStorageKey({
    kind: 'document', scopeId: IDS.owner, fileId: `migration-${'a'.repeat(64)}`,
  })).toBe(`documents/${IDS.owner}/migration-${'a'.repeat(64)}`);
});

test('rejects filesystem root as a local storage boundary', () => {
  expect(() => createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: '/',
  })).toThrow('localRoot must not be the filesystem root');
});

test('store enforces the avatar 5 MiB domain limit before any provider write', async () => {
  const providerWrite = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ putWithCleanupIntent: providerWrite }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await expect(storage.store({
    kind: 'avatar', scopeId: IDS.owner, fileId: IDS.file,
    body: Buffer.alloc((5 * 1024 * 1024) + 1), mimeType: 'image/png', persist: async () => undefined,
  })).rejects.toMatchObject({ code: 'STORAGE_SIZE_LIMIT' });
  expect(providerWrite).not.toHaveBeenCalled();
});

test('configured upload limits are clamped to each domain read limit', () => {
  expect(uploadLimitFor('avatar', String(50 * 1024 * 1024))).toBe(FILE_LIMITS.avatar);
  expect(uploadLimitFor('document', String(50 * 1024 * 1024))).toBe(FILE_LIMITS.document);
  expect(uploadLimitFor('case', '1024')).toBe(1024);
  expect(uploadLimitFor('lawyer', 'invalid')).toBe(FILE_LIMITS.lawyer);
});

test('dual write delegates pre-upload intent persistence and keeps a verified local copy', async () => {
  const events = [];
  const objectStorage = fakeObjectStorage({
    putWithCleanupIntent: async ({ object, additionalIntentIds, persist }) => {
      events.push(['intent-before-upload', object.key, object.checksum]);
      expect(additionalIntentIds).toEqual(['local-intent']);
      return persist({
        transaction: { id: 'tx' },
        cleanupIntentId: 'intent-7',
        cleanupIntentIds: ['intent-7', 'local-intent'],
      });
    },
  });
  const cleanupService = fakeCleanup({
    createObjectCleanupIntent: async ({ storageKey, provider }) => {
      await expect(fs.stat(storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
      events.push(['local-intent', provider]);
      return { id: 'local-intent' };
    },
  });
  const storage = createFileStorageService({
    objectStorage, cleanupService, writeMode: 'dual', localRoot: root,
  });
  const canonicalRoot = await fs.realpath(root);

  const result = await storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf',
    persist: async ({ transaction, cleanupIntentId, cleanupIntentIds, metadata }) => {
      events.push(['persist', transaction.id, cleanupIntentId, cleanupIntentIds]);
      expect(metadata).toEqual({
        storageProvider: 'r2',
        storageKey: `documents/${IDS.owner}/${IDS.file}`,
        mimeType: 'application/pdf',
        size: BODY.length,
        sha256: SHA256,
        path: path.join(canonicalRoot, 'documents', IDS.owner, IDS.file),
      });
      return { id: 'document-row' };
    },
  });

  expect(result).toEqual({ id: 'document-row' });
  expect(events).toEqual([
    ['local-intent', 'local'],
    ['intent-before-upload', `documents/${IDS.owner}/${IDS.file}`, SHA256],
    ['persist', 'tx', 'intent-7', ['intent-7', 'local-intent']],
  ]);
  await expect(fs.readFile(path.join(root, 'documents', IDS.owner, IDS.file))).resolves.toEqual(BODY);
});

test('failed dual pre-write deletion leaves the local intent pending and due', async () => {
  const due = [];
  const writeError = Object.assign(new Error('disk failed after partial write'), { code: 'EIO' });
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(),
    cleanupService: fakeCleanup({
      markObjectCleanupIntentDue: async (value) => due.push(value),
      resolveObjectCleanupIntent: async () => { throw new Error('must remain pending'); },
    }),
    writeMode: 'dual',
    localRoot: root,
    fileSystem: {
      writeFile: async () => { throw writeError; },
      rm: async () => { throw Object.assign(new Error('delete failed'), { code: 'EBUSY' }); },
    },
  });

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toBe(writeError);
  expect(due).toHaveLength(1);
  expect(due[0]).toMatchObject({ intentId: 'local-intent' });
});

test('dual EEXIST verifies and reuses an exact local file after resolving its non-owning intent', async () => {
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY);
  const events = [];
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      putWithCleanupIntent: async ({ persist }) => {
        events.push('r2');
        return persist({ transaction: {}, cleanupIntentId: 'r2', cleanupIntentIds: ['r2', 'local'] });
      },
    }),
    cleanupService: fakeCleanup({
      createObjectCleanupIntent: async (options) => {
        expect(options).toMatchObject({ provider: 'local', reserveCleanup: true, reclaimReserved: true });
        events.push('reserve');
        return { id: 'local' };
      },
      resolveObjectCleanupIntent: async () => events.push('resolve-local'),
    }),
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => ({ id: 'persisted' }),
  })).resolves.toEqual({ id: 'persisted' });
  expect(events).toEqual(['reserve', 'resolve-local', 'r2']);
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);
});

test('dual EEXIST mismatch resolves the non-owning intent and never schedules or deletes the existing file', async () => {
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);
  const existing = Buffer.from('different existing bytes');
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, existing);
  const resolved = [];
  const due = jest.fn();
  const rm = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(),
    cleanupService: fakeCleanup({
      createObjectCleanupIntent: async () => ({ id: 'local-reserved' }),
      resolveObjectCleanupIntent: async (value) => resolved.push(value),
      markObjectCleanupIntentDue: due,
    }),
    fileSystem: { writeFile: fs.writeFile, rm },
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toMatchObject({ code: 'LOCAL_FILE_CONFLICT' });
  expect(resolved).toHaveLength(1);
  expect(due).not.toHaveBeenCalled();
  expect(rm).not.toHaveBeenCalled();
  await expect(fs.readFile(localPath)).resolves.toEqual(existing);
});

test('dual EEXIST remains non-deletable when resolving the reused intent fails', async () => {
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY);
  const due = jest.fn();
  const rm = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(),
    cleanupService: fakeCleanup({
      createObjectCleanupIntent: async () => ({ id: 'local-reserved', status: 'reserved', nextAttemptAt: null }),
      resolveObjectCleanupIntent: async () => { throw new Error('database unavailable'); },
      markObjectCleanupIntentDue: due,
    }),
    fileSystem: { writeFile: fs.writeFile, rm },
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toThrow('database unavailable');
  expect(due).not.toHaveBeenCalled();
  expect(rm).not.toHaveBeenCalled();
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);
});

test('dual EEXIST exact reuse is never removed by later R2 or business compensation', async () => {
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY);
  const persistenceError = Object.assign(new Error('business rollback'), {
    transactionOutcome: 'rolled_back',
  });
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      putWithCleanupIntent: async () => { throw persistenceError; },
    }),
    cleanupService: fakeCleanup(),
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toBe(persistenceError);
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);
});

test('business rollback removes the dual local copy while preserving the original error', async () => {
  const businessError = Object.assign(new Error('database rollback'), { transactionOutcome: 'rolled_back' });
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ putWithCleanupIntent: async () => { throw businessError; } }),
    cleanupService: fakeCleanup(), writeMode: 'dual', localRoot: root,
  });
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toBe(businessError);
  await expect(fs.stat(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('ambiguous commit preserves both copies for reconciliation safety', async () => {
  const ambiguous = Object.assign(new Error('commit acknowledgement lost'), { transactionOutcome: 'unknown' });
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ putWithCleanupIntent: async () => { throw ambiguous; } }),
    cleanupService: fakeCleanup(), writeMode: 'dual', localRoot: root,
  });
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);

  await expect(storage.store({
    kind: 'document', scopeId: IDS.owner, fileId: IDS.file, body: BODY,
    mimeType: 'application/pdf', persist: async () => undefined,
  })).rejects.toBe(ambiguous);
  await expect(fs.readFile(localPath)).resolves.toEqual(BODY);
});

test('read is R2-first and falls back only after an R2 read error', async () => {
  const localPath = path.join(root, 'legacy.pdf');
  await fs.writeFile(localPath, BODY);
  const events = [];
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      readPrivateObjectBuffer: async () => {
        events.push('r2');
        throw Object.assign(new Error('r2 unavailable'), { code: 'ECONNRESET' });
      },
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.read({ record: {
    storageProvider: 'r2', storageKey: 'documents/remote', path: localPath, sha256: SHA256,
    mimeType: 'application/pdf', size: BODY.length,
  } })).resolves.toEqual(BODY);
  expect(events).toEqual(['r2']);
});

test('R2 checksum mismatch is terminal and never falls back to local content', async () => {
  const localPath = path.join(root, 'legacy.pdf');
  await fs.writeFile(localPath, BODY);
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ readPrivateObjectBuffer: async () => Buffer.from('tampered') }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.read({ record: {
    storageProvider: 'r2', storageKey: 'documents/remote', path: localPath, sha256: SHA256,
    mimeType: 'application/pdf', size: BODY.length,
  } })).rejects.toMatchObject({ code: 'STORAGE_CHECKSUM_MISMATCH' });
});

test('avatar reads enforce 5 MiB from the storage key even when the caller requests 10 MiB', async () => {
  const oversized = (5 * 1024 * 1024) + 1;
  const providerRead = jest.fn(async () => Buffer.alloc(oversized));
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      headPrivateObject: async () => ({
        ContentLength: oversized,
        ContentType: 'image/png',
        Metadata: { sha256: 'a'.repeat(64) },
      }),
      readPrivateObjectBuffer: providerRead,
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await expect(storage.read({
    record: {
      storageProvider: 'r2', storageKey: `avatars/${IDS.owner}/${IDS.file}`,
      mimeType: 'image/png', size: oversized, sha256: 'a'.repeat(64),
    },
    maxBytes: 10 * 1024 * 1024,
  })).rejects.toMatchObject({ code: 'STORAGE_SIZE_LIMIT' });
  expect(providerRead).not.toHaveBeenCalled();
});

test.each([
  ['missing SHA', { sha256: null }],
  ['malformed SHA', { sha256: 'ABC' }],
  ['missing MIME', { mimeType: null }],
  ['missing size', { size: null }],
  ['wrong provider', { storageProvider: 'public' }],
  ['missing key', { storageKey: null }],
])('R2 read rejects persisted metadata with %s before provider access or fallback', async (_label, override) => {
  const localPath = path.join(root, 'legacy.pdf');
  await fs.writeFile(localPath, BODY);
  const providerRead = jest.fn(async () => BODY);
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ readPrivateObjectBuffer: providerRead }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });
  const record = {
    storageProvider: 'r2', storageKey: 'documents/remote', path: localPath,
    sha256: SHA256, mimeType: 'application/pdf', size: BODY.length,
    ...override,
  };

  await expect(storage.read({ record })).rejects.toMatchObject({ code: 'INVALID_STORAGE_METADATA' });
  expect(providerRead).not.toHaveBeenCalled();
});

test('strict local keyed records require metadata while explicit legacy path fallback may hash and serve', async () => {
  const localPath = path.join(root, 'legacy.pdf');
  await fs.writeFile(localPath, BODY);
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(),
    writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.read({
    record: { storageProvider: 'local', storageKey: 'legacy/key', path: localPath },
  })).rejects.toMatchObject({ code: 'INVALID_STORAGE_METADATA' });
  await expect(storage.read({ record: { path: localPath } })).resolves.toEqual(BODY);
});

test('legacy local-only records require the explicit fallback contract', async () => {
  const localPath = path.join(root, 'legacy.pdf');
  await fs.writeFile(localPath, BODY);
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(),
    writeMode: 'r2', localRoot: root, localFallback: false,
  });

  await expect(storage.read({ record: { path: localPath } }))
    .rejects.toMatchObject({ code: 'LEGACY_LOCAL_FALLBACK_DISABLED' });
});

test('local fallback rejects oversized files from stat before reading any content', async () => {
  const localPath = path.join(root, 'oversized.pdf');
  await fs.writeFile(localPath, Buffer.alloc(12));
  const readSpy = jest.spyOn(fs, 'readFile');
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      headPrivateObject: async () => ({
        ContentLength: 12, ContentType: 'application/pdf', Metadata: { sha256: '0'.repeat(64) },
      }),
      readPrivateObjectBuffer: async () => { throw new Error('r2 down'); },
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.read({
    record: {
      storageProvider: 'r2', storageKey: 'documents/remote', path: localPath,
      sha256: '0'.repeat(64), mimeType: 'application/pdf', size: 12,
    },
    maxBytes: 10,
  })).rejects.toMatchObject({ code: 'STORAGE_SIZE_LIMIT' });
  expect(readSpy).not.toHaveBeenCalled();
  readSpy.mockRestore();
});

test('local fallback rejects paths and symlinks that escape the real root', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'emaslaxat-outside-'));
  const outsideFile = path.join(outside, 'secret.pdf');
  const symlink = path.join(root, 'linked.pdf');
  await fs.writeFile(outsideFile, BODY);
  await fs.symlink(outsideFile, symlink);
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ readPrivateObjectBuffer: async () => { throw new Error('r2 down'); } }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.read({ record: {
    storageProvider: 'r2', storageKey: 'documents/remote', path: outsideFile, sha256: SHA256,
    mimeType: 'application/pdf', size: BODY.length,
  } })).rejects.toMatchObject({ code: 'UNSAFE_LOCAL_STORAGE_PATH' });
  await expect(storage.read({ record: {
    storageProvider: 'r2', storageKey: 'documents/remote', path: symlink, sha256: SHA256,
    mimeType: 'application/pdf', size: BODY.length,
  } })).rejects.toMatchObject({ code: 'UNSAFE_LOCAL_STORAGE_PATH' });
  await fs.rm(outside, { recursive: true, force: true });
});

test('delete commits the business-row deletion with a cleanup task before object deletion', async () => {
  const events = [];
  const cleanupService = fakeCleanup({
    deleteBusinessRowWithCleanupTask: async ({ storageKey, provider, destroy }) => {
      events.push(['task', storageKey, provider]);
      await destroy({ transaction: { id: 'delete-tx' } });
      return {
        id: 'task-1', storageKey, provider, status: 'pending',
        requiresOwnershipProof: true, ownershipToken: 'task-1',
      };
    },
    resolveObjectCleanupIntent: async ({ intentId }) => events.push(['resolved', intentId]),
  });
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      deletePrivateObjectIfOwned: async (key) => events.push(['object', key]),
    }),
    cleanupService, writeMode: 'r2', localRoot: root,
  });

  await storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key' },
    destroy: async ({ transaction }) => events.push(['row', transaction.id]),
  });

  expect(events).toEqual([
    ['task', 'documents/private-key', 'r2'],
    ['row', 'delete-tx'],
    ['object', 'documents/private-key'],
    ['resolved', 'task-1'],
  ]);
});

test('delete leaves the committed cleanup task due when object deletion fails', async () => {
  const deleteError = Object.assign(new Error('provider unavailable'), { code: 'ETIMEDOUT' });
  const due = [];
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      deletePrivateObjectIfOwned: async () => { throw deleteError; },
    }),
    cleanupService: fakeCleanup({
      markObjectCleanupIntentDue: async (value) => due.push(value),
    }),
    writeMode: 'r2', localRoot: root,
  });

  await expect(storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key' },
    destroy: async () => undefined,
  })).resolves.toEqual({ cleanupPending: true });
  expect(due).toEqual([{ intentId: 'delete-task', error: deleteError }]);
});

test('delete does not resolve cleanup when provider ownership proof mismatches', async () => {
  const due = [];
  const resolved = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      deletePrivateObjectIfOwned: async () => ({ deleted: false, ownershipMismatch: true }),
    }),
    cleanupService: fakeCleanup({
      resolveObjectCleanupIntent: resolved,
      markObjectCleanupIntentDue: async (value) => due.push(value),
    }),
    writeMode: 'r2', localRoot: root,
  });

  await expect(storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key' },
    destroy: async () => undefined,
  })).resolves.toEqual({ cleanupPending: true });
  expect(resolved).not.toHaveBeenCalled();
  expect(due).toHaveLength(1);
  expect(due[0].error).toMatchObject({ code: 'STORAGE_OWNERSHIP_MISMATCH' });
});

test('delete rejects an escaping local path and never deletes the business row', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'emaslaxat-delete-outside-'));
  const outsideFile = path.join(outside, 'private.pdf');
  await fs.writeFile(outsideFile, BODY);
  const destroy = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(),
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key', path: outsideFile }, destroy,
  })).rejects.toMatchObject({ code: 'UNSAFE_LOCAL_STORAGE_PATH', status: 400 });
  expect(destroy).not.toHaveBeenCalled();
  await expect(fs.readFile(outsideFile)).resolves.toEqual(BODY);
  await fs.rm(outside, { recursive: true, force: true });
});

test('delete rejects a local symlink escape and never loses the business reference', async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'emaslaxat-delete-symlink-'));
  const outsideFile = path.join(outside, 'private.pdf');
  const linked = path.join(root, 'linked.pdf');
  await fs.writeFile(outsideFile, BODY);
  await fs.symlink(outsideFile, linked);
  const destroy = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(),
    writeMode: 'dual', localRoot: root,
  });

  await expect(storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key', path: linked }, destroy,
  })).rejects.toMatchObject({ code: 'UNSAFE_LOCAL_STORAGE_PATH', status: 400 });
  expect(destroy).not.toHaveBeenCalled();
  await expect(fs.readFile(outsideFile)).resolves.toEqual(BODY);
  await fs.rm(outside, { recursive: true, force: true });
});

test('dual delete durably queues both providers before deleting either copy', async () => {
  const localPath = path.join(root, 'documents', IDS.owner, IDS.file);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, BODY);
  const events = [];
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      deletePrivateObjectIfOwned: async (key) => events.push(['delete-r2', key]),
    }),
    cleanupService: fakeCleanup({
      deleteBusinessRowWithCleanupTasks: async ({ objects, destroy }) => {
        events.push(['tasks', objects]);
        await destroy({ transaction: { id: 'dual-delete-tx' } });
        return objects.map((object, index) => ({
          id: `task-${index}`, ...object, status: 'pending',
          requiresOwnershipProof: true, ownershipToken: `task-${index}`,
        }));
      },
      resolveObjectCleanupIntent: async ({ intentId }) => events.push(['resolve', intentId]),
    }),
    writeMode: 'dual', localRoot: root,
  });

  await storage.delete({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key', path: localPath },
    destroy: async ({ transaction }) => events.push(['row', transaction.id]),
  });

  expect(events[0][0]).toBe('tasks');
  expect(events[0][1][0]).toEqual({ provider: 'r2', storageKey: 'documents/private-key' });
  expect(events[0][1][1]).toEqual(expect.objectContaining({
    provider: 'local',
    storageKey: await fs.realpath(path.dirname(localPath)).then((dir) => path.join(dir, IDS.file)),
    requiresOwnershipProof: true,
    ownershipMetadata: expect.objectContaining({ size: BODY.length, sha256: SHA256 }),
  }));
  expect(events[1]).toEqual(['row', 'dual-delete-tx']);
  expect(events).toEqual(expect.arrayContaining([
    ['delete-r2', 'documents/private-key'], ['resolve', 'task-0'], ['resolve', 'task-1'],
  ]));
  await expect(fs.stat(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('stream sets private hardened headers and serves checksum-verified bytes', async () => {
  const response = new PassThrough();
  const headers = new Map();
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    filename: 'court\r\nX-Evil: yes.pdf',
  });

  expect(Buffer.concat(chunks)).toEqual(BODY);
  expect(Object.fromEntries(headers)).toEqual({
    'cache-control': 'private, no-store',
    'content-security-policy': "sandbox; default-src 'none'",
    'content-disposition': 'attachment; filename="courtX-Evil_ yes.pdf"; filename*=UTF-8\'\'courtX-Evil%3A%20yes.pdf',
    'content-length': String(BODY.length),
    'content-type': 'application/pdf',
    'x-content-type-options': 'nosniff',
  });
});

test('public inline stream supports stable cache and ETag headers without an attachment', async () => {
  const response = new PassThrough();
  const headers = new Map();
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.resume();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'avatars/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    disposition: 'inline',
    cacheControl: 'public, max-age=300',
    etag: `"${SHA256}"`,
  });

  expect(Object.fromEntries(headers)).toMatchObject({
    'cache-control': 'public, max-age=300',
    etag: `"${SHA256}"`,
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
  });
});

test('attachment disposition has safe ASCII fallback and RFC5987 UTF-8 filename', async () => {
  const response = new PassThrough();
  const headers = new Map();
  response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
  response.resume();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    filename: 'Шартнома\r\nX-Evil: yes.pdf',
  });

  const disposition = headers.get('content-disposition');
  expect(disposition).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  expect(disposition).toContain("filename*=UTF-8''%D0%A8%D0%B0%D1%80%D1%82%D0%BD%D0%BE%D0%BC%D0%B0X-Evil%3A%20yes.pdf");
  expect(disposition).not.toMatch(/[\r\n]/);
  expect(disposition.length).toBeLessThanOrEqual(600);
});

test('R2 streaming uses HEAD and the provider body stream without buffering the whole object', async () => {
  const events = [];
  const response = new PassThrough();
  response.setHeader = () => undefined;
  response.resume();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      readPrivateObjectBuffer: async () => { throw new Error('buffer read must not be used'); },
      headPrivateObject: async () => {
        events.push('head');
        return { ContentLength: BODY.length, ContentType: 'application/pdf', Metadata: { sha256: SHA256 } };
      },
      withPrivateObjectStream: async (_key, consume, options) => {
        events.push(['stream', options.signal instanceof AbortSignal]);
        return consume(Readable.from([BODY]), {
          contentLength: BODY.length, contentType: 'application/pdf', metadata: { sha256: SHA256 },
        });
      },
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    filename: 'private.pdf',
    signal: new AbortController().signal,
  });
  expect(events).toEqual(['head', ['stream', true]]);
});

test('delayed stream abort destroys the upstream provider body', async () => {
  const controller = new AbortController();
  let source;
  let releaseSecondChunk;
  const secondChunk = new Promise((resolve) => { releaseSecondChunk = resolve; });
  const response = new PassThrough();
  response.setHeader = () => undefined;
  response.resume();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      headPrivateObject: async () => ({
        ContentLength: BODY.length, ContentType: 'application/pdf', Metadata: { sha256: SHA256 },
      }),
      withPrivateObjectStream: async (_key, consume) => {
        source = Readable.from((async function* chunks() {
          yield BODY.subarray(0, 4);
          await secondChunk;
          yield BODY.subarray(4);
        }()));
        return consume(source, {
          contentLength: BODY.length, contentType: 'application/pdf', metadata: { sha256: SHA256 },
        });
      },
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  const streaming = storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    filename: 'private.pdf',
    signal: controller.signal,
  });
  await new Promise((resolve) => response.once('data', resolve));
  controller.abort();
  releaseSecondChunk();

  await expect(streaming).rejects.toMatchObject({ name: 'AbortError' });
  expect(source).toBeDefined();
  expect(source?.destroyed).toBe(true);
});

test('stream rejects HEAD size or checksum mismatch before opening the provider body', async () => {
  const open = jest.fn();
  const response = new PassThrough();
  response.setHeader = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({
      headPrivateObject: async () => ({
        ContentLength: BODY.length + 1,
        ContentType: 'application/pdf',
        Metadata: { sha256: 'f'.repeat(64) },
      }),
      withPrivateObjectStream: open,
    }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await expect(storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256,
      mimeType: 'application/pdf', size: BODY.length,
    },
    response,
    filename: 'private.pdf',
  })).rejects.toMatchObject({ code: 'STORAGE_METADATA_MISMATCH' });
  expect(open).not.toHaveBeenCalled();
  expect(response.setHeader).not.toHaveBeenCalled();
});

test('R2 stream rejects missing SHA before HEAD and never falls back to local', async () => {
  const head = jest.fn();
  const response = new PassThrough();
  response.setHeader = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage({ headPrivateObject: head }),
    cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root, localFallback: true,
  });

  await expect(storage.stream({
    record: {
      storageProvider: 'r2', storageKey: 'documents/private-key', sha256: null,
      mimeType: 'application/pdf', size: BODY.length, path: path.join(root, 'fallback.pdf'),
    },
    response,
    filename: 'private.pdf',
  })).rejects.toMatchObject({ code: 'INVALID_STORAGE_METADATA' });
  expect(head).not.toHaveBeenCalled();
  expect(response.setHeader).not.toHaveBeenCalled();
});

test('stream honors an already-aborted signal before writing headers or bytes', async () => {
  const controller = new AbortController();
  controller.abort();
  const response = new PassThrough();
  response.setHeader = jest.fn();
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  await expect(storage.stream({
    record: { storageProvider: 'r2', storageKey: 'documents/private-key', sha256: SHA256 },
    response,
    filename: 'private.pdf',
    signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(response.setHeader).not.toHaveBeenCalled();
  expect(response.readableLength).toBe(0);
});

test('service is IDOR-neutral: storage operations consume an authorized record, never a request ID', () => {
  const storage = createFileStorageService({
    objectStorage: fakeObjectStorage(), cleanupService: fakeCleanup(), writeMode: 'r2', localRoot: root,
  });

  expect(Object.keys(storage).sort()).toEqual(['delete', 'read', 'store', 'stream']);
  expect(storage).not.toHaveProperty('findById');
  expect(storage).not.toHaveProperty('authorize');
  expect(storage).not.toHaveProperty('createSignedDownload');
});
