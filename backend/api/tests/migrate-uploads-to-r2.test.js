'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  runUploadMigration, createCheckpointEnvelope, readCheckpoint,
  databaseFingerprintFromEnv, parseArgs, migrationExitCode,
} = require('../src/scripts/migrateUploadsToR2');

const secret = 'checkpoint-test-secret-at-least-32-bytes';
const environment = 'test';
const databaseFingerprint = 'db-' + 'a'.repeat(64);
const createdAt = new Date('2026-08-18T10:00:00.000Z');
const now = new Date('2026-08-18T12:00:00.000Z');
let root;
let checkpoint;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-migrate-'));
  checkpoint = path.join(root, 'state', 'checkpoint.json');
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

async function source(name, body = 'legacy') {
  const target = path.join(root, name);
  await fs.writeFile(target, body);
  return target;
}

function domain(rows, update = async () => true, name = 'documents') {
  const calls = [];
  return {
    name, calls,
    async fetchBatch({ cursor, limit, snapshotAt }) {
      calls.push({ cursor, limit, snapshotAt });
      return rows.filter((row) => new Date(row.createdAt) <= new Date(snapshotAt)
        && (!cursor || new Date(row.createdAt) > new Date(cursor.createdAt)
          || (new Date(row.createdAt).getTime() === new Date(cursor.createdAt).getTime() && row.id > cursor.id)))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
    updateIfUnchanged: update,
  };
}

function protectedStorage({ beforePersist, uploadError } = {}) {
  return {
    putWithCleanupIntent: jest.fn(async ({ object, persist }) => {
      if (uploadError) throw uploadError;
      const chunks = [];
      for await (const chunk of object.body) chunks.push(Buffer.from(chunk));
      if (beforePersist) await beforePersist();
      return persist({ transaction: { id: 'tx' } });
    }),
  };
}

function options(overrides = {}) {
  return {
    localRoot: root, checkpointPath: checkpoint, checkpointSecret: secret,
    environment, databaseFingerprint, domains: [], objectStorage: protectedStorage(), now,
    ...overrides,
  };
}

test('dry-run defaults to no upload or database update', async () => {
  const filePath = await source('doc.pdf', '%PDF-legacy');
  const update = jest.fn();
  const objectStorage = protectedStorage();
  const report = await runUploadMigration(options({
    domains: [domain([{ id: '1', createdAt, path: filePath, mimeType: 'application/pdf', storageKey: null }], update)],
    objectStorage,
  }));
  expect(report).toMatchObject({ dryRun: true, scanned: 1, wouldCopy: 1, copied: 0 });
  expect(objectStorage.putWithCleanupIntent).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('database fingerprint binds nonsecret connection identity and excludes passwords', () => {
  const first = databaseFingerprintFromEnv({
    DB_HOST: 'db.internal', DB_PORT: '5432', DB_NAME: 'app', DB_USER: 'worker', DB_PASSWORD: 'one',
  });
  const passwordChanged = databaseFingerprintFromEnv({
    DB_HOST: 'db.internal', DB_PORT: '5432', DB_NAME: 'app', DB_USER: 'worker', DB_PASSWORD: 'two',
  });
  const databaseChanged = databaseFingerprintFromEnv({
    DB_HOST: 'db.internal', DB_PORT: '5432', DB_NAME: 'other', DB_USER: 'worker', DB_PASSWORD: 'one',
  });
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(passwordChanged).toBe(first);
  expect(databaseChanged).not.toBe(first);
});

test('apply rejects a missing checkpoint HMAC key before upload', async () => {
  const filePath = await source('secret.txt', 'legacy');
  const objectStorage = protectedStorage();
  await expect(runUploadMigration(options({
    apply: true, checkpointSecret: undefined, objectStorage,
    domains: [domain([{ id: '1', createdAt, path: filePath, mimeType: 'text/plain', storageKey: null }])],
  }))).rejects.toThrow(/checkpoint HMAC secret/i);
  expect(objectStorage.putWithCleanupIntent).not.toHaveBeenCalled();
});

test('signed checkpoint schema binds environment, database, root, domains, mode, snapshot, cursor, and run', async () => {
  const canonicalRoot = await fs.realpath(root);
  const payload = {
    schemaVersion: 1, environment, databaseFingerprint, uploadRoot: canonicalRoot,
    domainOrder: ['documents'], mode: 'apply', snapshotAt: now.toISOString(),
    domainIndex: 0, cursor: { createdAt: createdAt.toISOString(), id: '1' },
    runId: '11111111-1111-4111-8111-111111111111',
  };
  const envelope = createCheckpointEnvelope(payload, secret);
  await fs.mkdir(path.dirname(checkpoint), { recursive: true });
  await fs.writeFile(checkpoint, JSON.stringify(envelope));
  await expect(readCheckpoint(checkpoint, {
    secret, expected: payload, now,
  })).resolves.toEqual(payload);

  envelope.payload.cursor.id = 'tampered';
  await fs.writeFile(checkpoint, JSON.stringify(envelope));
  await expect(readCheckpoint(checkpoint, { secret, expected: payload, now }))
    .rejects.toMatchObject({ code: 'INVALID_MIGRATION_CHECKPOINT' });
});

test.each([
  ['environment', { environment: 'production' }],
  ['database', { databaseFingerprint: 'other' }],
  ['root', { uploadRoot: '/different' }],
  ['domains', { domainOrder: ['other'] }],
  ['mode', { mode: 'dry-run' }],
])('rejects checkpoint %s mismatch', async (_label, mismatch) => {
  const canonicalRoot = await fs.realpath(root);
  const payload = {
    schemaVersion: 1, environment, databaseFingerprint, uploadRoot: canonicalRoot,
    domainOrder: ['documents'], mode: 'apply', snapshotAt: now.toISOString(), domainIndex: 0,
    cursor: null, runId: crypto.randomUUID(),
  };
  await fs.mkdir(path.dirname(checkpoint), { recursive: true });
  await fs.writeFile(checkpoint, JSON.stringify(createCheckpointEnvelope({ ...payload, ...mismatch }, secret)));
  await expect(runUploadMigration(options({ apply: true, domains: [domain([], undefined, 'documents')] })))
    .rejects.toMatchObject({ code: 'MIGRATION_CHECKPOINT_MISMATCH' });
});

test('rejects a stale checkpoint', async () => {
  const canonicalRoot = await fs.realpath(root);
  const stale = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  const payload = {
    schemaVersion: 1, environment, databaseFingerprint, uploadRoot: canonicalRoot,
    domainOrder: ['documents'], mode: 'apply', snapshotAt: stale.toISOString(), domainIndex: 0,
    cursor: null, runId: crypto.randomUUID(),
  };
  await fs.mkdir(path.dirname(checkpoint), { recursive: true });
  await fs.writeFile(checkpoint, JSON.stringify(createCheckpointEnvelope(payload, secret)));
  await expect(runUploadMigration(options({ apply: true, domains: [domain([], undefined, 'documents')] })))
    .rejects.toMatchObject({ code: 'STALE_MIGRATION_CHECKPOINT' });
});

test('snapshot keyset cursor uses createdAt plus UUID and defers concurrent inserts', async () => {
  const first = await source('first.txt', 'first');
  const second = await source('second.txt', 'second');
  const future = await source('future.txt', 'future');
  const rows = [
    { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', createdAt, path: first, mimeType: 'text/plain', storageKey: null },
    { id: '00000000-0000-4000-8000-000000000001', createdAt, path: second, mimeType: 'text/plain', storageKey: null },
    { id: '00000000-0000-4000-8000-000000000000', createdAt: new Date(now.getTime() + 1), path: future, mimeType: 'text/plain', storageKey: null },
  ];
  const migrationDomain = domain(rows);
  const report = await runUploadMigration(options({
    apply: true, domains: [migrationDomain], objectStorage: protectedStorage(), batchSize: 1,
  }));
  expect(report.scanned).toBe(2);
  expect(migrationDomain.calls.every((call) => new Date(call.snapshotAt).getTime() === now.getTime())).toBe(true);
  expect(migrationDomain.calls[1].cursor).toEqual({
    createdAt: createdAt.toISOString(), id: '00000000-0000-4000-8000-000000000001',
  });
});

test('apply uploads through protected cleanup intent and conditionally persists in its transaction', async () => {
  const filePath = await source('doc.txt', 'legacy body');
  const sha = crypto.createHash('sha256').update('legacy body').digest('hex');
  const update = jest.fn(async () => true);
  const objectStorage = protectedStorage();
  const report = await runUploadMigration(options({
    apply: true,
    domains: [domain([{ id: 'abc', createdAt, path: filePath, mimeType: 'text/plain', storageKey: null }], update)],
    objectStorage,
  }));
  expect(report.copied).toBe(1);
  expect(objectStorage.putWithCleanupIntent).toHaveBeenCalledWith(expect.objectContaining({
    object: expect.objectContaining({ key: `legacy/documents/abc/${sha}`, checksum: sha, contentLength: 11 }),
  }));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    id: 'abc', expectedPath: filePath, expectedStorageKey: null, transaction: { id: 'tx' },
  }));
});

test('tombstone or object mismatch blocks deterministic-key persistence', async () => {
  const filePath = await source('mismatch.txt', 'expected');
  const conflict = Object.assign(new Error('different object'), { code: 'STORAGE_KEY_TOMBSTONED' });
  const report = await runUploadMigration(options({
    apply: true,
    domains: [domain([{ id: '1', createdAt, path: filePath, mimeType: 'text/plain', storageKey: null }])],
    objectStorage: protectedStorage({ uploadError: conflict }),
  }));
  expect(report).toMatchObject({ failed: 1, mismatched: 1, copied: 0 });
});

test('O_NOFOLLOW rejects a symlink source before hashing or upload', async () => {
  const target = await source('target.txt', 'secret');
  const link = path.join(root, 'link.txt');
  await fs.symlink(target, link);
  const objectStorage = protectedStorage();
  const report = await runUploadMigration(options({
    apply: true,
    domains: [domain([{ id: '1', createdAt, path: link, mimeType: 'text/plain', storageKey: null }])],
    objectStorage,
  }));
  expect(report.failed).toBe(1);
  expect(objectStorage.putWithCleanupIntent).not.toHaveBeenCalled();
});

test('path replacement after fd upload is detected and never updates the database', async () => {
  const filePath = await source('race.txt', 'original');
  const secondPath = await source('after-race.txt', 'second');
  const update = jest.fn(async () => true);
  const objectStorage = protectedStorage({ beforePersist: async () => {
    await fs.rename(filePath, `${filePath}.old`);
    await fs.writeFile(filePath, 'replacement');
  } });
  const report = await runUploadMigration(options({
    apply: true,
    domains: [domain([
      { id: '1', createdAt, path: filePath, mimeType: 'text/plain', storageKey: null },
      { id: '2', createdAt, path: secondPath, mimeType: 'text/plain', storageKey: null },
    ], update)],
    objectStorage,
  }));
  expect(report.raced).toBe(1);
  expect(report.exitCode).toBe(1);
  expect(report.scanned).toBe(1);
  expect(update).not.toHaveBeenCalled();
});

test('conditional DB row race stops the batch and keeps checkpoint before the raced row', async () => {
  const firstPath = await source('db-first.txt', 'first');
  const racedPath = await source('db-raced.txt', 'raced');
  const thirdPath = await source('db-third.txt', 'third');
  let updates = 0;
  const update = jest.fn(async () => {
    updates += 1;
    return updates !== 2;
  });
  const migrationDomain = domain([
    { id: '1', createdAt, path: firstPath, mimeType: 'text/plain', storageKey: null },
    { id: '2', createdAt, path: racedPath, mimeType: 'text/plain', storageKey: null },
    { id: '3', createdAt, path: thirdPath, mimeType: 'text/plain', storageKey: null },
  ], update);
  const report = await runUploadMigration(options({
    apply: true, domains: [migrationDomain], objectStorage: protectedStorage(),
  }));
  expect(report).toMatchObject({ copied: 1, raced: 1, scanned: 2, exitCode: 1 });
  expect(update).toHaveBeenCalledTimes(2);
  const canonicalRoot = await fs.realpath(root);
  const saved = await readCheckpoint(checkpoint, {
    secret,
    expected: {
      environment, databaseFingerprint, uploadRoot: canonicalRoot,
      domainOrder: ['documents'], mode: 'apply',
    },
    now,
  });
  expect(saved.cursor).toEqual({ createdAt: createdAt.toISOString(), id: '1' });
});

test('apply CLI fails on races by default', () => {
  const args = parseArgs(['--apply']);
  expect(args.failOnRace).toBe(true);
  expect(migrationExitCode({ failed: 0, raced: 1 }, args)).toBe(1);
  expect(migrationExitCode({ failed: 0, raced: 0 }, args)).toBe(0);
});
