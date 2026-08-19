const crypto = require('crypto');
const { resetDb, models } = require('./helpers');
const {
  processObjectCleanupTasks,
  MAX_CLEANUP_ATTEMPTS,
} = require('../src/services/objectCleanupTaskService');

const { ObjectCleanupTask } = models;
const NOW = new Date('2026-08-16T12:00:00.000Z');

beforeEach(resetDb);

async function dueTask(storageKey, overrides = {}) {
  const id = crypto.randomUUID();
  return ObjectCleanupTask.create({
    id,
    storageKey,
    provider: 'r2',
    status: 'pending',
    attempts: 0,
    nextAttemptAt: new Date(NOW.getTime() - 1000),
    requiresOwnershipProof: true,
    ownershipToken: id,
    ...overrides,
  });
}

test('processes due tasks once and treats delete-not-found as completed success', async () => {
  await dueTask('profile-imports/42/delete-me');
  await dueTask('profile-imports/42/already-gone');
  const deleted = [];
  const deleteObject = async (key) => {
    deleted.push(key);
    const claimed = await ObjectCleanupTask.findOne({ where: { storageKey: key } });
    expect(claimed.status).toBe('processing');
    expect(claimed.leaseToken).toEqual(expect.any(String));
    expect(claimed.leaseExpiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    if (key.endsWith('already-gone')) {
      throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    }
  };

  const first = await processObjectCleanupTasks({ limit: 10, now: NOW, deleteObject });
  const second = await processObjectCleanupTasks({ limit: 10, now: NOW, deleteObject });

  expect(first).toEqual({ claimed: 2, completed: 2, retried: 0, deadLettered: 0, manualReview: 0 });
  expect(second).toEqual({ claimed: 0, completed: 0, retried: 0, deadLettered: 0, manualReview: 0 });
  expect(new Set(deleted)).toEqual(new Set([
    'profile-imports/42/delete-me',
    'profile-imports/42/already-gone',
  ]));
  expect(deleted).toHaveLength(2);
  const rows = await ObjectCleanupTask.findAll();
  expect(rows.every((row) => row.status === 'completed' && row.nextAttemptAt === null)).toBe(true);
});

test('reclaims expired processing leases but leaves live leases untouched', async () => {
  await dueTask('profile-imports/42/expired-lease', {
    status: 'processing',
    leaseToken: '11111111-1111-4111-8111-111111111111',
    leaseExpiresAt: new Date(NOW.getTime() - 1),
  });
  await dueTask('profile-imports/42/live-lease', {
    status: 'processing',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
  });
  const deleted = [];

  const result = await processObjectCleanupTasks({
    limit: 10,
    now: NOW,
    deleteObject: async (key) => { deleted.push(key); },
  });

  expect(result.claimed).toBe(1);
  expect(deleted).toEqual(['profile-imports/42/expired-lease']);
  const expired = await ObjectCleanupTask.findOne({ where: { storageKey: deleted[0] } });
  const live = await ObjectCleanupTask.findOne({ where: { storageKey: 'profile-imports/42/live-lease' } });
  expect(expired.status).toBe('completed');
  expect(live).toMatchObject({
    status: 'processing',
    leaseToken: '22222222-2222-4222-8222-222222222222',
  });
});

test('increments attempts with sanitized bounded exponential retry then dead-letters', async () => {
  const task = await dueTask('profile-imports/42/retry-me');
  const failure = Object.assign(
    new Error('resume.pdf body=secret accessKey=top-secret'),
    { code: 'ETIMEDOUT' }
  );
  const deleteObject = async () => { throw failure; };

  const first = await processObjectCleanupTasks({ limit: 1, now: NOW, deleteObject });
  await task.reload();

  expect(first).toEqual({ claimed: 1, completed: 0, retried: 1, deadLettered: 0, manualReview: 0 });
  expect(task).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'OBJECT_DELETE_FAILED:ETIMEDOUT',
  });
  expect(task.nextAttemptAt.toISOString()).toBe('2026-08-16T12:01:00.000Z');
  expect(JSON.stringify(task.toJSON())).not.toMatch(/resume\.pdf|body=|secret|accessKey/i);

  const tooEarly = await processObjectCleanupTasks({
    limit: 1,
    now: new Date('2026-08-16T12:00:59.999Z'),
    deleteObject,
  });
  expect(tooEarly.claimed).toBe(0);

  await task.update({
    attempts: MAX_CLEANUP_ATTEMPTS - 2,
    nextAttemptAt: NOW,
  });
  await processObjectCleanupTasks({ limit: 1, now: NOW, deleteObject });
  await task.reload();
  expect(task.attempts).toBe(MAX_CLEANUP_ATTEMPTS - 1);
  expect(task.nextAttemptAt.toISOString()).toBe('2026-08-16T12:05:00.000Z');

  await task.update({ nextAttemptAt: NOW });
  const final = await processObjectCleanupTasks({ limit: 1, now: NOW, deleteObject });
  await task.reload();
  expect(final.deadLettered).toBe(1);
  expect(task).toMatchObject({ status: 'failed', attempts: MAX_CLEANUP_ATTEMPTS });
  expect(task.nextAttemptAt).toBeNull();
});

test('concurrent processors skip locked rows and never delete a key twice', async () => {
  await dueTask('profile-imports/42/concurrent-a');
  await dueTask('profile-imports/42/concurrent-b');
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const deleteObject = async (key) => {
    calls.push(key);
    const claimed = await ObjectCleanupTask.findOne({ where: { storageKey: key } });
    expect(claimed.status).toBe('processing');
    if (calls.length === 2) release();
    await gate;
  };

  const [first, second] = await Promise.all([
    processObjectCleanupTasks({ limit: 1, now: NOW, deleteObject }),
    processObjectCleanupTasks({ limit: 1, now: NOW, deleteObject }),
  ]);

  expect(first.claimed + second.claimed).toBe(2);
  expect(new Set(calls).size).toBe(2);
  expect(calls).toHaveLength(2);
  expect(await ObjectCleanupTask.count({ where: { status: 'completed' } })).toBe(2);
});

test('performs R2 deletes outside transactions with concurrency bounded at four', async () => {
  for (let index = 0; index < 6; index += 1) {
    await dueTask(`profile-imports/42/bounded-${index}`);
  }
  let active = 0;
  let maxActive = 0;
  let maxLeased = 0;
  const deleteObject = async (key) => {
    const claimed = await ObjectCleanupTask.findOne({ where: { storageKey: key } });
    expect(claimed.status).toBe('processing');
    maxLeased = Math.max(
      maxLeased,
      await ObjectCleanupTask.count({ where: { status: 'processing' } })
    );
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
  };

  const result = await processObjectCleanupTasks({ limit: 6, now: NOW, deleteObject });

  expect(result.completed).toBe(6);
  expect(maxActive).toBeGreaterThan(1);
  expect(maxActive).toBeLessThanOrEqual(4);
  expect(maxLeased).toBeLessThanOrEqual(4);
});

test('routes R2 and local cleanup tasks only to their matching deleters', async () => {
  await dueTask('documents/owner/r2');
  await dueTask('/safe/uploads/documents/owner/local', {
    provider: 'local',
    ownershipMetadata: {
      expectedPath: '/safe/uploads/documents/owner/local',
      size: 0,
      sha256: 'a'.repeat(64),
    },
  });
  const calls = [];

  const result = await processObjectCleanupTasks({
    limit: 10,
    now: NOW,
    deleteByProvider: {
      r2: async (key) => calls.push(['r2', key]),
      local: async (key) => calls.push(['local', key]),
    },
  });

  expect(result.completed).toBe(2);
  expect(new Set(calls.map(JSON.stringify))).toEqual(new Set([
    JSON.stringify(['r2', 'documents/owner/r2']),
    JSON.stringify(['local', '/safe/uploads/documents/owner/local']),
  ]));
});

test('proofless local cleanup moves to manual review instead of reaching the R2 deleter', async () => {
  const task = await dueTask('/safe/uploads/documents/owner/local-only', {
    provider: 'local', requiresOwnershipProof: false, ownershipToken: null,
  });
  const r2Delete = jest.fn();

  const result = await processObjectCleanupTasks({
    limit: 1,
    now: NOW,
    deleteByProvider: { r2: r2Delete },
  });

  await task.reload();
  expect(r2Delete).not.toHaveBeenCalled();
  expect(result.manualReview).toBe(1);
  expect(task).toMatchObject({ status: 'manual_review', lastError: 'OWNERSHIP_PROOF_MISSING' });
});

test('proofless R2 and local tasks move to manual review without invoking any deleter', async () => {
  const r2 = await dueTask('legacy/proofless-r2', {
    requiresOwnershipProof: false, ownershipToken: null, ownershipMetadata: null,
  });
  const local = await dueTask('/legacy/proofless-local', {
    provider: 'local', requiresOwnershipProof: false, ownershipToken: null, ownershipMetadata: null,
  });
  const r2Delete = jest.fn();
  const localDelete = jest.fn();

  const result = await processObjectCleanupTasks({
    limit: 2,
    now: NOW,
    deleteByProvider: { r2: r2Delete, local: localDelete },
  });
  await Promise.all([r2.reload(), local.reload()]);

  expect(result).toEqual({ claimed: 2, completed: 0, retried: 0, deadLettered: 0, manualReview: 2 });
  expect(r2Delete).not.toHaveBeenCalled();
  expect(localDelete).not.toHaveBeenCalled();
  for (const task of [r2, local]) {
    expect(task).toMatchObject({
      status: 'manual_review', lastError: 'OWNERSHIP_PROOF_MISSING',
      nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null,
    });
  }
});

test('R2 ownership proof survives retry, expired lease reclaim, and replacement mismatch', async () => {
  const intentId = '33333333-3333-4333-8333-333333333333';
  const task = await dueTask('documents/owner/protected', {
    id: intentId,
    status: 'reserved',
    requiresOwnershipProof: true,
    ownershipToken: intentId,
  });
  let replacement = false;
  let deletes = 0;
  const heads = [];
  const storage = require('../src/services/objectStorage').createObjectStorage({
    bucket: 'private',
    client: {
      async send(command) {
        if (command.constructor.name === 'HeadObjectCommand') {
          heads.push(command.input.Key);
          return {
            ETag: replacement ? 'replacement-etag' : 'owned-etag',
            Metadata: { cleanupIntentId: replacement ? 'replacement-token' : intentId },
          };
        }
        if (command.constructor.name === 'DeleteObjectCommand') {
          deletes += 1;
          throw Object.assign(new Error('delete unavailable'), { code: 'ETIMEDOUT' });
        }
        throw new Error('unexpected command');
      },
    },
  });
  const deleteOwned = (key, claim) => {
    expect(claim).toMatchObject({
      requiresOwnershipProof: true,
      ownershipToken: intentId,
    });
    return storage.deletePrivateObjectIfOwned(key, claim.ownershipToken);
  };

  const first = await processObjectCleanupTasks({
    limit: 1, now: NOW, deleteByProvider: { r2: deleteOwned },
  });
  await task.reload();
  expect(first.retried).toBe(1);
  expect(task).toMatchObject({
    status: 'pending', requiresOwnershipProof: true, ownershipToken: intentId,
  });

  await task.update({
    status: 'processing',
    leaseToken: '44444444-4444-4444-8444-444444444444',
    leaseExpiresAt: new Date(NOW.getTime() - 1),
  });
  replacement = true;
  const reclaimed = await processObjectCleanupTasks({
    limit: 1, now: NOW, deleteByProvider: { r2: deleteOwned },
  });
  await task.reload();

  expect(reclaimed.completed).toBe(1);
  expect(task).toMatchObject({
    status: 'completed', requiresOwnershipProof: true, ownershipToken: intentId,
  });
  expect(heads).toHaveLength(2);
  expect(deletes).toBe(1);
});

test('R2 owned delete uses metadata proof and never sends unsupported IfMatch', async () => {
  const intentId = '77777777-7777-4777-8777-777777777777';
  let object = { ownershipToken: intentId };
  const storage = require('../src/services/objectStorage').createObjectStorage({
    bucket: 'private',
    client: {
      async send(command) {
        if (command.constructor.name === 'HeadObjectCommand') {
          return {
            Metadata: { cleanupIntentId: object.ownershipToken },
          };
        }
        if (command.constructor.name === 'DeleteObjectCommand') {
          expect(command.input).not.toHaveProperty('IfMatch');
          object = null;
          return {};
        }
        throw new Error('unexpected command');
      },
    },
  });

  await expect(storage.deletePrivateObjectIfOwned('documents/owner/raced', intentId))
    .resolves.toEqual({ deleted: true });
  expect(object).toBeNull();
});
