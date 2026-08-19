const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertReconciliationDatabase,
  buildReconciliationSummary,
  runCli,
} = require('../src/scripts/reconcilePayments');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort();
const currentHead = migrations.at(-1);

function fakeDatabase(applied = migrations) {
  const transaction = { id: 'same-read-only-transaction' };
  const calls = [];
  const sequelize = {
    async query(sql, options) {
      calls.push({ sql, options });
      if (sql.includes('SequelizeMeta')) return [applied.map((name) => ({ name }))];
      if (sql.includes('txid_current_snapshot')) {
        return [[{
          databaseName: 'staging_private_name',
          databaseOid: '16422',
          serverVersion: '160004',
          snapshot: '900:900:',
        }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { sequelize, transaction, calls };
}

test('reconciliation refuses a pending current migration on the same transaction', async () => {
  const fixture = fakeDatabase(migrations.slice(0, -1));
  await expect(assertReconciliationDatabase({
    ...fixture,
    expectedMigrationHead: currentHead,
    reconciledAt: new Date('2026-08-19T12:00:00.000Z'),
  })).rejects.toMatchObject({ code: 'MIGRATIONS_PENDING', pending: [currentHead] });
  expect(fixture.calls.every(({ options }) => options.transaction === fixture.transaction)).toBe(true);
});

test('reconciliation refuses an unknown applied migration on the same transaction', async () => {
  const fixture = fakeDatabase([...migrations, '20990101000000-unknown.js']);
  await expect(assertReconciliationDatabase({
    ...fixture,
    expectedMigrationHead: currentHead,
    reconciledAt: new Date('2026-08-19T12:00:00.000Z'),
  })).rejects.toMatchObject({ code: 'MIGRATIONS_UNKNOWN', unknown: ['20990101000000-unknown.js'] });
});

test('reconciliation refuses an attested head different from the actual current head', async () => {
  const fixture = fakeDatabase();
  await expect(assertReconciliationDatabase({
    ...fixture,
    expectedMigrationHead: '20260823000000-sync-era-schema-bridge.js',
    reconciledAt: new Date('2026-08-19T12:00:00.000Z'),
  })).rejects.toMatchObject({
    code: 'RECONCILIATION_MIGRATION_HEAD_MISMATCH',
    actualMigrationHead: currentHead,
  });
});

test('current latest state returns only hashed database/snapshot identity and reconciliation time', async () => {
  const fixture = fakeDatabase();
  const evidence = await assertReconciliationDatabase({
    ...fixture,
    expectedMigrationHead: currentHead,
    reconciledAt: new Date('2026-08-19T12:00:00.000Z'),
  });

  expect(evidence).toEqual({
    migrationHead: '20260824000000-create-authorization-evidence-events.js',
    databaseIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    snapshotIdentityDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    reconciledAt: '2026-08-19T12:00:00.000Z',
  });
  expect(JSON.stringify(evidence)).not.toMatch(/staging_private_name|16422|900:900/);
  expect(fixture.calls.every(({ options }) => options.transaction === fixture.transaction)).toBe(true);
});

test('signed reconciliation summary uses actual database evidence instead of a caller migration label', () => {
  const databaseEvidence = {
    migrationHead: currentHead,
    databaseIdentityDigest: 'd'.repeat(64),
    snapshotIdentityDigest: 'e'.repeat(64),
    reconciledAt: '2026-08-19T12:00:00.000Z',
  };
  const summary = buildReconciliationSummary({
    ready: true,
    mismatchCount: 0,
    mismatches: {},
    databaseEvidence,
  }, {
    environment: 'staging', commitSha: 'a'.repeat(40), deploymentId: 'deployment', serviceId: 'api',
    configDigest: 'b'.repeat(64), expectedMigrationHead: currentHead,
    providerSnapshotDigest: 'c'.repeat(64), providerSnapshotCapturedAt: '2026-08-19T11:59:00.000Z',
  });

  expect(summary.release.migrationHead).toBe(currentHead);
  expect(summary).toEqual(expect.objectContaining({
    databaseIdentityDigest: databaseEvidence.databaseIdentityDigest,
    snapshotIdentityDigest: databaseEvidence.snapshotIdentityDigest,
    reconciledAt: databaseEvidence.reconciledAt,
  }));
  expect(() => buildReconciliationSummary({
    ready: true, mismatchCount: 0, mismatches: {}, databaseEvidence,
  }, {
    environment: 'staging', commitSha: 'a'.repeat(40), deploymentId: 'deployment', serviceId: 'api',
    configDigest: 'b'.repeat(64), expectedMigrationHead: '20260823000000-sync-era-schema-bridge.js',
    providerSnapshotDigest: 'c'.repeat(64),
  })).toThrow(/migration head/i);
});

test('CLI derives release and expected head directly from the verified source attestation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-reconcile-source-'));
  const sourceFile = path.join(directory, 'source.json');
  const bindingsFile = path.join(directory, 'bindings.json');
  const summaryFile = path.join(directory, 'summary.json');
  const source = {
    commitSha: 'a'.repeat(40), deploymentId: 'signed-deployment', serviceId: 'signed-api',
    configDigest: 'b'.repeat(64), migrationHead: currentHead,
  };
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  fs.writeFileSync(bindingsFile, JSON.stringify({
    environment: 'staging', providerSnapshotDigest: 'c'.repeat(64),
    providerSnapshotCapturedAt: '2026-08-19T11:59:00.000Z',
    commitSha: 'f'.repeat(40), expectedMigrationHead: '20260823000000-sync-era-schema-bridge.js',
  }));
  const reconcile = jest.fn().mockResolvedValue({
    ready: true, mismatchCount: 0, mismatches: {},
    databaseEvidence: {
      migrationHead: currentHead, databaseIdentityDigest: 'd'.repeat(64),
      snapshotIdentityDigest: 'e'.repeat(64), reconciledAt: '2026-08-19T12:00:00.000Z',
    },
  });

  try {
    await runCli([
      '--source-attestation', sourceFile,
      '--summary-bindings', bindingsFile,
      '--summary-file', summaryFile,
      '--reconcile-at', '2026-08-19T12:00:00.000Z',
    ], { reconcile });
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ expectedMigrationHead: currentHead }));
    expect(JSON.parse(fs.readFileSync(summaryFile, 'utf8')).release).toEqual(source);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
