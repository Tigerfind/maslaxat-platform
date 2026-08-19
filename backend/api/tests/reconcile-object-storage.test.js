'use strict';

const {
  reconcileObjectStorage, createPostgresReferenceIndex, validateObjectEntry,
} = require('../src/scripts/reconcileObjectStorage');
const { sequelize } = require('../src/models');

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-08-18T12:00:00.000Z');

test.each([null, undefined, 'invalid', '', Number.NaN, Number.POSITIVE_INFINITY, new Date('invalid')])(
  'rejects invalid provider lastModified value %p',
  (lastModified) => {
    expect(validateObjectEntry({
      key: 'documents/u/valid', size: 1, lastModified,
    })).toBe(false);
  }
);

test.each([new Date('2026-08-18T00:00:00Z'), '2026-08-18T00:00:00Z', 0])(
  'accepts finite non-null provider lastModified value %p',
  (lastModified) => {
    expect(validateObjectEntry({
      key: 'documents/u/valid', size: 1, lastModified,
    })).toBe(true);
  }
);

function exactIndex() {
  const rows = new Map();
  const candidates = new Map();
  let maxBatch = 0;
  return {
    get maxBatch() { return maxBatch; },
    async initialize() {},
    async upsertBatch(batch) {
      maxBatch = Math.max(maxBatch, batch.length);
      const conflicts = [];
      for (const row of batch) {
        const existing = rows.get(row.key);
        if (existing) {
          const fields = ['domain', 'id', 'size', 'sha256', 'mimeType'];
          if (fields.some((field) => (existing[field] ?? null) !== (row[field] ?? null))) {
            conflicts.push({ key: row.key, domain: row.domain, id: row.id });
            continue;
          }
          existing.protected = Boolean(existing.protected || row.protected);
        } else rows.set(row.key, { ...row, seen: false });
      }
      return conflicts;
    },
    async find(key) { return rows.get(key) || null; },
    async markSeen(key) { const row = rows.get(key); if (row) row.seen = true; },
    async missingBatch({ afterKey, limit }) {
      return [...rows.values()].filter((row) => row.key && !row.seen && !row.protected
        && (!afterKey || row.key > afterKey)).sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit);
    },
    async addCandidateBatch(batch) { for (const row of batch) candidates.set(row.key, row); },
    async candidateBatch({ afterKey, limit }) {
      return [...candidates.values()].filter((row) => !afterKey || row.key > afterKey)
        .sort((a, b) => a.key.localeCompare(b.key)).slice(0, limit);
    },
    async close() {},
  };
}

function domain(name, rows) {
  const calls = [];
  return {
    name,
    calls,
    async listReferenceBatch({ cursor, limit, snapshotAt }) {
      calls.push({ cursor, limit, snapshotAt });
      const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + 1 : 0;
      return rows.slice(start, start + limit);
    },
  };
}

function pagedStorage(pages, heads = {}, maxCalls = 100) {
  let calls = 0;
  return {
    listPrivateObjects: jest.fn(async ({ continuationToken }) => {
      calls += 1;
      if (calls > maxCalls) throw new Error('test pagination runaway');
      return pages[continuationToken || 'first'];
    }),
    headPrivateObject: jest.fn(async (key) => heads[key] || {}),
  };
}

test('reconciles every domain through bounded keyset batches and exact-index lookups', async () => {
  const createdAt = new Date('2026-08-01T00:00:00Z');
  const domains = [
    domain('users', [{ id: '1', createdAt, key: 'avatars/u/a', size: 3, sha256: 'a'.repeat(64), retainedPath: '/uploads/a' }]),
    domain('documents', [{ id: '2', createdAt, key: 'documents/u/d', size: 4, sha256: 'b'.repeat(64) }]),
    domain('case', [{ id: '3', createdAt, key: 'case-documents/c/d', size: 5, sha256: 'c'.repeat(64) }]),
    domain('lawyer', [{ id: '4', createdAt, key: 'lawyer-documents/u/d', size: 6, sha256: 'd'.repeat(64) }]),
    domain('imports', [{ id: '5', createdAt, key: 'profile-imports/u/i', size: 7, sha256: 'e'.repeat(64) }]),
  ];
  const storage = pagedStorage({
    first: { objects: [
      { key: 'avatars/u/a', size: 3, lastModified: new Date(now - 48 * HOUR) },
      { key: 'documents/u/d', size: 99, lastModified: new Date(now - 48 * HOUR) },
      { key: 'documents/orphan/old', size: 1, lastModified: new Date(now - 48 * HOUR) },
    ], nextContinuationToken: 'next' },
    next: { objects: [
      { key: 'ai-temp/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333', size: 1, lastModified: new Date(now - HOUR) },
      { key: 'cleanup/protected', size: 1, lastModified: new Date(now - 48 * HOUR) },
    ] },
  }, {
    'avatars/u/a': { ContentLength: 3, Metadata: { sha256: '0'.repeat(64) } },
    'documents/u/d': { ContentLength: 99, Metadata: { sha256: 'b'.repeat(64) } },
  });
  const cleanupDomain = domain('cleanup', [
    { id: 'm', createdAt, key: 'cleanup/protected', status: 'manual_review', protected: true },
    { id: 'f', createdAt, key: 'gone', status: 'failed', protected: true },
  ]);
  const index = exactIndex();
  const report = await reconcileObjectStorage({
    domains, cleanupDomain, referenceIndex: index, objectStorage: storage, now, dbBatchSize: 2,
  });

  expect(index.maxBatch).toBeLessThanOrEqual(2);
  expect(domains.every((entry) => entry.calls.every((call) => call.limit === 2))).toBe(true);
  expect(storage.listPrivateObjects).toHaveBeenCalledTimes(2);
  expect(report.missing.items.map((item) => item.domain).sort()).toEqual(['case', 'imports', 'lawyer']);
  expect(report.sizeMismatch.count).toBe(1);
  expect(report.shaMismatch.count).toBe(1);
  expect(report.retained.count).toBe(1);
  expect(report.legacyOnly.count).toBe(0);
  expect(report.manualReview.count).toBe(1);
  expect(report.failed.count).toBe(1);
  expect(report.orphans.items.map((item) => item.key)).toEqual(['documents/orphan/old']);
  expect(report.tempExcluded).toBe(1);
  expect(report.ready).toBe(false);
});

test('large inventories keep DB queries and report memory bounded', async () => {
  const createdAt = new Date('2026-08-01T00:00:00Z');
  const rows = Array.from({ length: 2500 }, (_, index) => ({
    id: String(index).padStart(4, '0'), createdAt,
    key: `documents/u/${String(index).padStart(4, '0')}`, size: 1,
  }));
  const documents = domain('documents', rows);
  const pages = {};
  for (let page = 0; page < 25; page += 1) {
    const token = page === 0 ? 'first' : `p${page}`;
    pages[token] = {
      objects: rows.slice(page * 100, (page + 1) * 100).map((row) => ({
        key: row.key, size: 1, lastModified: createdAt,
      })),
      ...(page < 24 ? { nextContinuationToken: `p${page + 1}` } : {}),
    };
  }
  const index = exactIndex();
  const report = await reconcileObjectStorage({
    domains: [documents], cleanupDomain: domain('cleanup', []), referenceIndex: index,
    objectStorage: pagedStorage(pages), now, dbBatchSize: 100, pageSize: 100,
    maxDbRows: 3000, maxPages: 30, reportLimit: 10,
  });
  expect(documents.calls).toHaveLength(26);
  expect(index.maxBatch).toBe(100);
  expect(report.scannedReferences).toBe(2500);
  expect(report.scannedObjects).toBe(2500);
  expect(report.missing.items.length).toBeLessThanOrEqual(10);
  expect(report.ready).toBe(true);
});

test('legacy-only paths block readiness while retained rollback paths do not', async () => {
  const createdAt = new Date('2026-08-01T00:00:00Z');
  const report = await reconcileObjectStorage({
    domains: [domain('documents', [
      { id: '1', createdAt, key: null, legacyOnlyPath: '/uploads/only.pdf' },
      { id: '2', createdAt, key: 'documents/u/retained', size: 1, sha256: 'a'.repeat(64), retainedPath: '/uploads/retained.pdf' },
    ])],
    cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: pagedStorage({ first: { objects: [
      { key: 'documents/u/retained', size: 1, lastModified: new Date(now - 48 * HOUR) },
    ] } }, { 'documents/u/retained': { Metadata: { sha256: 'a'.repeat(64) } } }), now,
  });
  expect(report.legacyOnly.count).toBe(1);
  expect(report.retained.count).toBe(1);
  expect(report.ready).toBe(false);
});

test('invalid provider entries and continuation loops are bounded blockers and never scheduled', async () => {
  const storage = pagedStorage({
    first: { objects: [{ key: '../bad', size: -1, lastModified: 'invalid' }], nextContinuationToken: 'loop' },
    loop: { objects: [], nextContinuationToken: 'loop' },
  }, {}, 5);
  const scheduleCleanup = jest.fn();
  const report = await reconcileObjectStorage({
    domains: [], cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: storage, scheduleCleanup, scheduleDeletion: true, now, maxPages: 3,
  });
  expect(report.invalidProvider.count).toBe(1);
  expect(report.paginationBlocked).toBe(true);
  expect(report.ready).toBe(false);
  expect(scheduleCleanup).not.toHaveBeenCalled();
  expect(storage.listPrivateObjects).toHaveBeenCalledTimes(2);
});

test('max page and row limits stop unbounded reconciliation', async () => {
  let calls = 0;
  const endless = { listPrivateObjects: jest.fn(async ({ continuationToken }) => {
    calls += 1;
    if (calls > 5) throw new Error('test pagination runaway');
    return { objects: [], nextContinuationToken: `${continuationToken || 'first'}x` };
  }) };
  const report = await reconcileObjectStorage({
    domains: [], cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: endless, maxPages: 4,
  });
  expect(endless.listPrivateObjects).toHaveBeenCalledTimes(4);
  expect(report.paginationBlocked).toBe(true);

  const tooMany = domain('documents', Array.from({ length: 5 }, (_, index) => ({
    id: String(index), createdAt: now, key: `documents/u/${index}`,
  })));
  await expect(reconcileObjectStorage({
    domains: [tooMany], cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: pagedStorage({ first: { objects: [] } }), maxDbRows: 4, dbBatchSize: 2,
  })).rejects.toMatchObject({ code: 'RECONCILIATION_ROW_LIMIT' });
});

test('explicit scheduling processes every bounded candidate, not only report samples', async () => {
  const objects = Array.from({ length: 25 }, (_, index) => ({
    key: `documents/orphans/${String(index).padStart(2, '0')}`,
    size: 1, lastModified: new Date(now - 48 * HOUR),
  }));
  const heads = Object.fromEntries(objects.map((object) => [object.key, {
    Metadata: { cleanupIntentId: '11111111-1111-4111-8111-111111111111' },
  }]));
  const scheduleCleanup = jest.fn(async () => ({ created: true }));
  const report = await reconcileObjectStorage({
    domains: [], cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: pagedStorage({ first: { objects } }, heads), scheduleCleanup,
    scheduleDeletion: true, now, dbBatchSize: 5, reportLimit: 3,
  });
  expect(report.orphans.count).toBe(25);
  expect(report.orphans.items).toHaveLength(3);
  expect(report.scheduled).toBe(25);
  expect(scheduleCleanup).toHaveBeenCalledTimes(25);
});

test('default PostgreSQL temp index supports exact bounded reference and candidate scans', async () => {
  const index = createPostgresReferenceIndex(sequelize);
  await index.initialize();
  try {
    await index.upsertBatch([
      { key: 'documents/u/1', domain: 'documents', id: '1', size: 3, sha256: 'a'.repeat(64), mimeType: 'text/plain' },
      { key: 'documents/u/2', domain: 'documents', id: '2', protected: true },
    ]);
    await expect(index.find('documents/u/1')).resolves.toMatchObject({
      key: 'documents/u/1', domain: 'documents', id: '1', size: 3,
    });
    await index.markSeen('documents/u/1');
    await expect(index.missingBatch({ afterKey: '', limit: 10 })).resolves.toEqual([]);
    await index.addCandidateBatch([{ key: 'documents/orphan/1', size: 9 }]);
    await expect(index.candidateBatch({ afterKey: '', limit: 10 })).resolves.toEqual([
      { key: 'documents/orphan/1', size: 9 },
    ]);
    await expect(index.upsertBatch([
      { key: 'documents/u/1', domain: 'documents', id: '1', size: 3, sha256: 'a'.repeat(64), mimeType: 'text/plain' },
    ])).resolves.toEqual([]);
    await expect(index.upsertBatch([
      { key: 'documents/u/1', domain: 'case', id: 'other', size: 4, sha256: 'b'.repeat(64), mimeType: 'application/pdf' },
    ])).resolves.toEqual([
      { key: 'documents/u/1', domain: 'case', id: 'other' },
    ]);
  } finally {
    await index.close();
  }
});

test('exact duplicate references dedupe while conflicting metadata blocks readiness', async () => {
  const shared = {
    id: '1', createdAt: now, key: 'documents/u/shared', size: 3,
    sha256: 'a'.repeat(64), mimeType: 'text/plain',
  };
  const scheduleCleanup = jest.fn();
  const report = await reconcileObjectStorage({
    domains: [
      domain('documents', [shared]),
      domain('documents', [{ ...shared }]),
      domain('case', [{
        ...shared, id: '2', size: 4, sha256: 'b'.repeat(64), mimeType: 'application/pdf',
      }]),
    ],
    cleanupDomain: domain('cleanup', []), referenceIndex: exactIndex(),
    objectStorage: pagedStorage({ first: { objects: [{
      key: shared.key, size: 3, lastModified: now,
    }] } }, { [shared.key]: { Metadata: { sha256: shared.sha256 } } }),
    scheduleCleanup, scheduleDeletion: true, now,
  });
  expect(report.referenceConflict.count).toBe(1);
  expect(report.referenceConflict.items).toEqual([
    { key: shared.key, domain: 'case', id: '2' },
  ]);
  expect(report.ready).toBe(false);
  expect(scheduleCleanup).not.toHaveBeenCalled();
});
