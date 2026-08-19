const path = require('path');
const childProcess = require('child_process');

const fixturePath = path.join(__dirname, 'fixtures', 'representative-db');
const databaseName = `emaslaxat_session_a_a1_representative_${process.pid}`;

test('representative schema is built independently without invoking the migration CLI', async () => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  const spawn = jest.spyOn(childProcess, 'spawnSync').mockImplementation(() => {
    throw new Error('migration CLI must not build the representative schema');
  });
  jest.resetModules();
  try {
    const freshFixture = require(fixturePath);
    await expect(freshFixture.createRepresentativeDatabase(databaseName)).resolves.toBeUndefined();
  } finally {
    spawn.mockRestore();
    jest.resetModules();
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test('a deterministic sync-era database migrates without losing business or push data', async () => {
  let fixture;
  let loadError;
  try {
    fixture = require(fixturePath);
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();

  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    const before = await fixture.readRepresentativeSnapshot(databaseName);
    expect(before.migrations).not.toContain('20260723000000-initial-sync-baseline.js');

    const migration = fixture.runMigrations(databaseName);
    expect({ status: migration.status, stdout: migration.stdout, stderr: migration.stderr })
      .toEqual(expect.objectContaining({ status: 0 }));

    const after = await fixture.readRepresentativeSnapshot(databaseName);
    expect(after).toEqual(expect.objectContaining({
      userIds: before.userIds,
      consultationIds: before.consultationIds,
      payment: expect.objectContaining({
        id: before.payment.id,
        amount: before.payment.amount,
        amount_tiyin: '12500000',
        purpose: 'consultation',
        provider_transaction_id: before.payment.transaction_id,
      }),
      push: before.push,
      promo: before.promo,
      withdrawal: before.withdrawal,
      documentPath: before.documentPath,
      preserved: before.preserved,
      rowCounts: before.rowCounts,
      consultations: before.consultations,
      profile: before.profile,
    }));
    expect(after.payment).toEqual(expect.objectContaining({
      id: before.payment.id,
      amount: before.payment.amount,
      currency: before.payment.currency,
      provider: before.payment.provider,
      status: before.payment.status,
      transaction_id: before.payment.transaction_id,
      provider_response: before.payment.provider_response,
      provider_data: before.payment.provider_response,
    }));
    expect(before.paymentStable).toEqual({
      id: before.payment.id,
      user_id: before.payment.user_id,
      consultation_id: before.payment.consultation_id,
      amount: before.payment.amount,
      currency: before.payment.currency,
      provider: before.payment.provider,
      status: before.payment.status,
      transaction_id: before.payment.transaction_id,
      provider_response: before.payment.provider_response,
      escrow_released: before.payment.escrow_released,
      created_at: before.payment.created_at,
      updated_at: before.payment.updated_at,
    });
    expect(after.paymentStable).toEqual(before.paymentStable);
    expect(after.paymentBackfill).toEqual({
      amount_tiyin: '12500000',
      purpose: 'consultation',
      provider_transaction_id: before.payment.transaction_id,
      provider_data: before.payment.provider_response,
    });
    expect(after.pushColumns).toEqual(['created_at', 'endpoint', 'id', 'keys', 'updated_at', 'user_id']);
    expect(after.migrations).toEqual(fixture.migrationFilenames());

    const rerun = fixture.runMigrations(databaseName);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain('No migrations were executed');
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test.each([
  ['missing payment transaction id', 'ALTER TABLE payments DROP COLUMN transaction_id'],
  ['wrong payment provider payload type', 'ALTER TABLE payments ALTER COLUMN provider_response TYPE text USING provider_response::text'],
  ['missing payment consultation foreign key', 'ALTER TABLE payments DROP CONSTRAINT payments_consultation_id_fkey'],
  ['missing user email uniqueness', 'ALTER TABLE users DROP CONSTRAINT users_email_key'],
  ['missing applied lawyer verification status', 'ALTER TABLE lawyer_profiles DROP COLUMN verification_status'],
  ['missing applied lawyer document table', 'DROP TABLE lawyer_documents'],
  ['missing applied case document table', 'DROP TABLE case_documents'],
])('baseline adoption refuses %s before recording adoption', async (_label, mutation) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    await fixture.executeSql(databaseName, mutation);
    const result = fixture.runMigrations(databaseName, ['--to', '20260723000000-initial-sync-baseline.js']);
    expect(result.status).not.toBe(0);
    const [meta] = await fixture.queryRows(databaseName, `
      SELECT COUNT(*)::integer AS count FROM "SequelizeMeta"
      WHERE name = '20260723000000-initial-sync-baseline.js'
    `);
    expect(meta.count).toBe(0);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test.each([
  ['nullable legacy payment amount', 'ALTER TABLE payments ALTER COLUMN amount DROP NOT NULL'],
  ['wrong legacy payment numeric shape', 'ALTER TABLE payments ALTER COLUMN amount TYPE numeric(13,3)'],
  ['unknown legacy role enum value', "ALTER TYPE enum_users_role ADD VALUE 'owner'"],
])('baseline adoption refuses %s', async (_label, mutation) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    await fixture.executeSql(databaseName, mutation);
    const result = fixture.runMigrations(databaseName, ['--to', '20260723000000-initial-sync-baseline.js']);
    expect(result.status).not.toBe(0);
    const [meta] = await fixture.queryRows(databaseName, `
      SELECT COUNT(*)::integer AS count FROM "SequelizeMeta"
      WHERE name = '20260723000000-initial-sync-baseline.js'
    `);
    expect(meta.count).toBe(0);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test.each([
  ['non-positive amount', 'UPDATE payments SET amount = 0'],
  ['unclassified subject', `UPDATE payments SET consultation_id = NULL, provider_response = '{}'::jsonb`],
  ['ambiguous subscription owner', `
    UPDATE payments SET consultation_id = NULL, provider_response = '{"subscription":true}'::jsonb;
    INSERT INTO subscriptions (id, user_id, plan, price, created_at, updated_at)
    VALUES ('00000000-0000-4000-8000-0000000000d1',
      '00000000-0000-4000-8000-000000000001', 'free', 0, now(), now())
  `],
  ['duplicate provider transaction', `
    INSERT INTO payments
      (id, user_id, consultation_id, amount, currency, provider, status, transaction_id,
       provider_response, escrow_released, created_at, updated_at)
    SELECT '00000000-0000-4000-8000-000000000031', user_id, consultation_id, amount,
      currency, provider, status, transaction_id, provider_response, escrow_released, created_at, updated_at
    FROM payments WHERE id = '00000000-0000-4000-8000-000000000030'
  `],
])('baseline preflight refuses legacy payment %s before expansion mutates schema', async (_label, mutation) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    await fixture.executeSql(databaseName, mutation);
    const result = fixture.runMigrations(databaseName);
    expect(result.status).not.toBe(0);
    const columns = await fixture.queryRows(databaseName, `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'payments' AND column_name = 'purpose'
    `);
    expect(columns).toEqual([]);
    const [meta] = await fixture.queryRows(databaseName, `
      SELECT COUNT(*)::integer AS count FROM "SequelizeMeta"
      WHERE name = '20260723000000-initial-sync-baseline.js'
    `);
    expect(meta.count).toBe(0);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test('push bridge refuses conflicting camelCase and snake_case owner data without dropping either value', async () => {
  let fixture;
  let loadError;
  try {
    fixture = require(fixturePath);
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();

  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    expect(fixture.runMigrations(databaseName).status).toBe(0);
    await fixture.addConflictingCamelPushOwner(databaseName);

    const bridge = require('../migrations/20260823000000-sync-era-schema-bridge');
    await expect(fixture.runBridge(databaseName, bridge)).rejects.toThrow(/conflict/i);

    const state = await fixture.readPushConflictState(databaseName);
    expect(state.snakeUserId).not.toBe(state.camelUserId);
    expect(state.hasCamelUserId).toBe(true);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test.each([
  [
    'promo defaults',
    'ALTER TABLE promos ALTER COLUMN used_count DROP DEFAULT',
    /promos.*default|incompatible.*promos/i,
  ],
  [
    'withdrawal status enum',
    `ALTER TABLE withdrawals ALTER COLUMN status TYPE text USING status::text`,
    /withdrawals.*status|incompatible.*withdrawals/i,
  ],
  [
    'push timestamp type',
    `ALTER TABLE push_subscriptions ALTER COLUMN created_at TYPE text USING created_at::text`,
    /push_subscriptions.*created_at|incompatible.*push/i,
  ],
])('bridge rejects incompatible existing %s contracts', async (_label, mutation, expectedError) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    expect(fixture.runMigrations(databaseName).status).toBe(0);
    await fixture.executeSql(databaseName, mutation);

    const bridge = require('../migrations/20260823000000-sync-era-schema-bridge');
    await expect(fixture.runBridge(databaseName, bridge)).rejects.toThrow(expectedError);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test('bridge replaces a partial promo unique index with an unconditional valid ready index', async () => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    expect(fixture.runMigrations(databaseName).status).toBe(0);
    await fixture.executeSql(databaseName, `
      ALTER TABLE promos DROP CONSTRAINT promos_code_key;
      CREATE UNIQUE INDEX promos_code_partial ON promos(code) WHERE is_active = true;
    `);
    const bridge = require('../migrations/20260823000000-sync-era-schema-bridge');
    await fixture.runBridge(databaseName, bridge);
    const [contract] = await fixture.queryRows(databaseName, `
      SELECT COUNT(*)::integer AS count
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute attribute ON attribute.attrelid = t.oid AND attribute.attnum = ANY(i.indkey)
      WHERE n.nspname = current_schema() AND t.relname = 'promos'
        AND attribute.attname = 'code'
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
        AND i.indnkeyatts = 1
    `);
    expect(contract.count).toBe(1);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test.each([
  ['promos', 'code', 'promos_code_key', 'id', 'promos_code_include_decoy'],
  ['push_subscriptions', 'endpoint', 'push_subscriptions_endpoint_key', 'id', 'push_endpoint_include_decoy'],
])('bridge does not treat UNIQUE(%s other key) INCLUDE target as target uniqueness', async (
  table, column, constraint, otherColumn, decoyName
) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    expect(fixture.runMigrations(databaseName).status).toBe(0);
    await fixture.executeSql(databaseName, `
      ALTER TABLE ${table} DROP CONSTRAINT ${constraint};
      CREATE UNIQUE INDEX ${decoyName} ON ${table}(${otherColumn}) INCLUDE (${column})
    `);

    const bridge = require('../migrations/20260823000000-sync-era-schema-bridge');
    await fixture.runBridge(databaseName, bridge);
    const [contract] = await fixture.queryRows(databaseName, `
      SELECT COUNT(*)::integer AS count
      FROM pg_index index
      JOIN pg_class source ON source.oid = index.indrelid
      JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
      JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, ordinality)
        ON key.ordinality <= index.indnkeyatts
      JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
      WHERE namespace.nspname = current_schema() AND source.relname = '${table}'
        AND index.indisunique AND index.indisvalid AND index.indisready AND index.indpred IS NULL
        AND index.indnkeyatts = 1 AND attribute.attname = '${column}'
    `);
    expect(contract.count).toBe(1);
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});

test('disposable database lifecycle ignores conflicting PG connection variables', async () => {
  const fixture = require(fixturePath);
  const previous = { PGHOST: process.env.PGHOST, PGPORT: process.env.PGPORT, PGUSER: process.env.PGUSER };
  process.env.PGHOST = '127.0.0.1';
  process.env.PGPORT = '1';
  process.env.PGUSER = 'wrong-test-role';
  try {
    await expect(fixture.recreateDisposableDatabase(databaseName)).resolves.toBeUndefined();
    await expect(fixture.dropDisposableDatabase(databaseName)).resolves.toBeUndefined();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test.each([
  ['identical dual values', false],
  ['one-sided null snake values', true],
])('bridge preserves %s and produces the final push constraints', async (_label, nullSnake) => {
  const fixture = require(fixturePath);
  await fixture.recreateDisposableDatabase(databaseName);
  try {
    await fixture.createRepresentativeDatabase(databaseName);
    expect(fixture.runMigrations(databaseName).status).toBe(0);
    const original = await fixture.readRepresentativeSnapshot(databaseName);
    await fixture.executeSql(databaseName, `
      ALTER TABLE push_subscriptions
        ADD COLUMN "userId" uuid,
        ADD COLUMN "createdAt" timestamptz,
        ADD COLUMN "updatedAt" timestamptz;
      UPDATE push_subscriptions SET
        "userId" = user_id, "createdAt" = created_at, "updatedAt" = updated_at;
      ${nullSnake ? `
        ALTER TABLE push_subscriptions
          ALTER COLUMN user_id DROP NOT NULL,
          ALTER COLUMN created_at DROP NOT NULL,
          ALTER COLUMN updated_at DROP NOT NULL;
        UPDATE push_subscriptions SET user_id = NULL, created_at = NULL, updated_at = NULL;
      ` : ''}
    `);
    const bridge = require('../migrations/20260823000000-sync-era-schema-bridge');
    await fixture.runBridge(databaseName, bridge);
    const after = await fixture.readRepresentativeSnapshot(databaseName);
    expect(after.push).toEqual(original.push);
    expect(after.pushContract).toEqual({
      camelColumns: 0,
      endpointUniqueIndexes: 1,
      userForeignKeys: 1,
      requiredSnakeColumns: 3,
    });
  } finally {
    await fixture.dropDisposableDatabase(databaseName);
  }
});
