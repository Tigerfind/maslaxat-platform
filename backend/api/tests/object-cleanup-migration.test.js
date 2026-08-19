const Sequelize = require('sequelize');
const migration = require('../migrations/20260821000002-object-cleanup-tasks');
const { resetDb, models } = require('./helpers');

const { sequelize, ObjectCleanupTask } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(resetDb);
afterEach(async () => {
  await sequelize.query('DROP SCHEMA IF EXISTS cleanup_scope_test CASCADE');
});

test('00002 creates restart-safe durable cleanup tasks and reruns safely', async () => {
  await queryInterface.dropTable('object_cleanup_tasks');

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('object_cleanup_tasks');
  expect(columns).toEqual(expect.objectContaining({
    id: expect.objectContaining({ primaryKey: true }),
    storage_key: expect.any(Object),
    provider: expect.any(Object),
    attempts: expect.any(Object),
    last_error: expect.any(Object),
    status: expect.any(Object),
    next_attempt_at: expect.any(Object),
    lease_token: expect.any(Object),
    lease_expires_at: expect.any(Object),
    requires_ownership_proof: expect.any(Object),
    ownership_token: expect.any(Object),
    ownership_metadata: expect.any(Object),
    prevents_key_reuse: expect.any(Object),
    created_at: expect.any(Object),
    updated_at: expect.any(Object),
  }));

  const [indexes] = await sequelize.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'object_cleanup_tasks_active_key_unique',
        'object_cleanup_tasks_due_idx',
        'object_cleanup_tasks_tombstone_unique'
      )
  `);
  expect(new Set(indexes.map((row) => row.indexname))).toEqual(new Set([
    'object_cleanup_tasks_active_key_unique',
    'object_cleanup_tasks_due_idx',
    'object_cleanup_tasks_tombstone_unique',
  ]));
  expect(indexes.find((row) => row.indexname === 'object_cleanup_tasks_active_key_unique').indexdef)
    .toMatch(/UNIQUE.*provider.*storage_key.*WHERE.*status.*reserved.*pending.*processing/i);
  expect(indexes.find((row) => row.indexname === 'object_cleanup_tasks_tombstone_unique').indexdef)
    .toMatch(/UNIQUE.*provider.*storage_key.*WHERE.*prevents_key_reuse.*true/i);

  await expect(ObjectCleanupTask.create({
    storageKey: 'reserved/key', provider: 'r2', status: 'reserved',
    nextAttemptAt: new Date(Date.now() + 60_000),
  })).resolves.toBeTruthy();
});

test('00002 repairs an empty partial table and reruns without losing cleanup state', async () => {
  await queryInterface.dropTable('object_cleanup_tasks');
  await queryInterface.createTable('object_cleanup_tasks', {
    storage_key: { type: Sequelize.STRING(1024), allowNull: true },
  });

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('object_cleanup_tasks');
  expect(columns.next_attempt_at).toBeTruthy();
  expect(columns.lease_token).toBeTruthy();
  expect(columns.lease_expires_at).toBeTruthy();
  expect(columns.status).toBeTruthy();
  expect(columns.id.primaryKey).toBe(true);
  expect(columns.storage_key.allowNull).toBe(false);
});

test('00002 upgrades a populated Round1 table with next-attempt scheduling in place', async () => {
  await queryInterface.dropTable('object_cleanup_tasks');
  await queryInterface.createTable('object_cleanup_tasks', {
    id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
    storage_key: { type: Sequelize.STRING(1024), allowNull: false },
    provider: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'r2' },
    attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: Sequelize.STRING(255), allowNull: true },
    status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  });
  const id = '11111111-1111-4111-8111-111111111111';
  await sequelize.query(`
    INSERT INTO object_cleanup_tasks
      (id, storage_key, provider, attempts, status, created_at, updated_at)
    VALUES
      (:id, 'profile-imports/42/existing', 'r2', 0, 'pending', NOW(), NOW())
  `, { replacements: { id } });

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const row = await ObjectCleanupTask.findByPk(id);
  expect(row).toMatchObject({
    storageKey: 'profile-imports/42/existing', status: 'manual_review',
    lastError: 'OWNERSHIP_PROOF_MISSING', preventsKeyReuse: true,
  });
  expect(row.nextAttemptAt).toBeNull();
  expect(row.leaseToken).toBeNull();
  expect(row.leaseExpiresAt).toBeNull();
});

test('00002 creates the current-schema table when another schema has the same table name', async () => {
  await queryInterface.dropTable('object_cleanup_tasks');
  await sequelize.query(`
    CREATE SCHEMA cleanup_scope_test;
    CREATE TABLE cleanup_scope_test.object_cleanup_tasks (shadow_marker text NOT NULL);
    INSERT INTO cleanup_scope_test.object_cleanup_tasks (shadow_marker) VALUES ('preserve-me');
  `);

  await migration.up(queryInterface, Sequelize);

  const [[registry]] = await sequelize.query(`
    SELECT
      to_regclass(format('%I.%I', current_schema(), 'object_cleanup_tasks')) AS current_table,
      to_regclass('cleanup_scope_test.object_cleanup_tasks') AS shadow_table
  `);
  expect(registry.current_table).toBe('object_cleanup_tasks');
  expect(registry.shadow_table).toBe('cleanup_scope_test.object_cleanup_tasks');
  const [[shadow]] = await sequelize.query(`
    SELECT shadow_marker FROM cleanup_scope_test.object_cleanup_tasks
  `);
  expect(shadow.shadow_marker).toBe('preserve-me');
});

test('00002 upgrades the old due index to include expired lease scans', async () => {
  await sequelize.query(`
    DROP INDEX IF EXISTS object_cleanup_tasks_due_idx;
    CREATE INDEX object_cleanup_tasks_due_idx
      ON object_cleanup_tasks (status, next_attempt_at, created_at);
  `);

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const [[index]] = await sequelize.query(`
    SELECT pg_get_indexdef(i.oid) AS definition
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'object_cleanup_tasks'
      AND i.relname = 'object_cleanup_tasks_due_idx'
  `);
  expect(index.definition).toMatch(/lease_expires_at/i);
});

test('00002 ignores same-named constraints in another schema and repairs the target table', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE object_cleanup_tasks
      DROP CONSTRAINT IF EXISTS object_cleanup_tasks_status_valid,
      DROP CONSTRAINT IF EXISTS object_cleanup_tasks_attempts_nonnegative;
    CREATE SCHEMA cleanup_scope_test;
    CREATE TABLE cleanup_scope_test.shadow_tasks (
      status text CONSTRAINT object_cleanup_tasks_status_valid CHECK (status = 'shadow'),
      attempts integer CONSTRAINT object_cleanup_tasks_attempts_nonnegative CHECK (attempts >= 100)
    );
  `);

  await migration.up(queryInterface, Sequelize);

  const [constraints] = await sequelize.query(`
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'object_cleanup_tasks'
      AND c.conname IN (
        'object_cleanup_tasks_status_valid',
        'object_cleanup_tasks_attempts_nonnegative',
        'object_cleanup_tasks_provider_valid'
      )
  `);
  expect(new Set(constraints.map((row) => row.conname))).toEqual(new Set([
    'object_cleanup_tasks_status_valid',
    'object_cleanup_tasks_attempts_nonnegative',
    'object_cleanup_tasks_provider_valid',
  ]));
});

test('model permits history but only one active cleanup task per provider and key', async () => {
  expect(ObjectCleanupTask).toBeTruthy();
  const values = {
    provider: 'r2',
    storageKey: 'profile-imports/42/orphaned-object',
    lastError: 'OBJECT_DELETE_FAILED',
  };

  const pending = await ObjectCleanupTask.create(values);
  await expect(ObjectCleanupTask.create(values)).rejects.toMatchObject({
    name: 'SequelizeUniqueConstraintError',
  });
  await pending.update({ status: 'completed', attempts: 1 });
  await expect(ObjectCleanupTask.create(values)).resolves.toBeTruthy();
});

test('00002 repairs weakened ownership/status constraints and an interrupted invalid active index', async () => {
  await migration.up(queryInterface, Sequelize);
  const columns = await queryInterface.describeTable('object_cleanup_tasks');
  if (!columns.requires_ownership_proof) {
    await queryInterface.addColumn('object_cleanup_tasks', 'requires_ownership_proof', {
      type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
    });
  }
  if (!columns.ownership_token) {
    await queryInterface.addColumn('object_cleanup_tasks', 'ownership_token', {
      type: Sequelize.UUID, allowNull: true,
    });
  }
  if (!columns.ownership_metadata) {
    await queryInterface.addColumn('object_cleanup_tasks', 'ownership_metadata', {
      type: Sequelize.JSONB, allowNull: true,
    });
  }
  await sequelize.query(`
    ALTER TABLE object_cleanup_tasks DROP CONSTRAINT object_cleanup_tasks_status_valid;
    ALTER TABLE object_cleanup_tasks ADD CONSTRAINT object_cleanup_tasks_status_valid
      CHECK (status IN ('reserved', 'pending', 'processing', 'completed', 'failed', 'unsafe'));
    ALTER TABLE object_cleanup_tasks DROP CONSTRAINT IF EXISTS object_cleanup_tasks_ownership_valid;
    ALTER TABLE object_cleanup_tasks ADD CONSTRAINT object_cleanup_tasks_ownership_valid
      CHECK (requires_ownership_proof IS NOT NULL);
    DROP INDEX object_cleanup_tasks_active_key_unique;
    DROP INDEX object_cleanup_tasks_tombstone_unique;
    CREATE INDEX object_cleanup_tasks_tombstone_unique
      ON object_cleanup_tasks (provider, storage_key)
      WHERE prevents_key_reuse = false;
    INSERT INTO object_cleanup_tasks
      (id, storage_key, provider, status, attempts, requires_ownership_proof,
       created_at, updated_at)
    VALUES
      ('55555555-5555-4555-8555-555555555555', 'duplicate/key', 'r2', 'completed', 0, false, NOW(), NOW()),
      ('66666666-6666-4666-8666-666666666666', 'duplicate/key', 'r2', 'completed', 0, false, NOW(), NOW());
  `);
  await expect(sequelize.query(`
    CREATE UNIQUE INDEX CONCURRENTLY object_cleanup_tasks_active_key_unique
      ON object_cleanup_tasks (provider, storage_key)
      WHERE status IN ('reserved', 'pending', 'processing', 'completed')
  `)).rejects.toThrow();
  await sequelize.query(`
    DELETE FROM object_cleanup_tasks WHERE id = '66666666-6666-4666-8666-666666666666'
  `);

  await migration.up(queryInterface, Sequelize);

  const [constraints] = await sequelize.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'object_cleanup_tasks'
      AND c.conname IN ('object_cleanup_tasks_status_valid', 'object_cleanup_tasks_ownership_valid')
  `);
  const definitions = Object.fromEntries(constraints.map((row) => [row.conname, row.definition]));
  expect(definitions.object_cleanup_tasks_status_valid).not.toMatch(/unsafe/);
  expect(definitions.object_cleanup_tasks_ownership_valid).toMatch(/ownership_token/);
  const [indexes] = await sequelize.query(`
    SELECT i.relname AS name, pg_get_indexdef(i.oid) AS definition,
           ix.indisunique, ix.indisvalid, ix.indisready
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = current_schema()
      AND i.relname IN ('object_cleanup_tasks_active_key_unique', 'object_cleanup_tasks_tombstone_unique')
  `);
  const byName = Object.fromEntries(indexes.map((index) => [index.name, index]));
  expect(byName.object_cleanup_tasks_active_key_unique).toMatchObject({ indisvalid: true, indisready: true });
  expect(byName.object_cleanup_tasks_active_key_unique.definition).not.toMatch(/completed/);
  expect(byName.object_cleanup_tasks_tombstone_unique)
    .toMatchObject({ indisunique: true, indisvalid: true, indisready: true });
  expect(byName.object_cleanup_tasks_tombstone_unique.definition).toMatch(/prevents_key_reuse.*true/i);
  expect(definitions.object_cleanup_tasks_status_valid).toMatch(/manual_review/);
});

test('00002 protects ownership-bearing tasks and quarantines every proofless active task', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE object_cleanup_tasks
      DROP CONSTRAINT IF EXISTS object_cleanup_tasks_ownership_valid;
    INSERT INTO object_cleanup_tasks
      (id, storage_key, provider, status, attempts, next_attempt_at,
       requires_ownership_proof, ownership_token, ownership_metadata, created_at, updated_at)
    VALUES
      ('71111111-1111-4111-8111-111111111111', 'proof/pending', 'r2', 'pending', 0, NOW(),
       false, '71111111-1111-4111-8111-111111111111', NULL, NOW(), NOW()),
      ('72222222-2222-4222-8222-222222222222', 'proof/processing', 'r2', 'processing', 0, NOW(),
       false, NULL, '{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb, NOW(), NOW()),
      ('73333333-3333-4333-8333-333333333333', 'proof/reserved', 'r2', 'reserved', 0, NOW(),
       false, '73333333-3333-4333-8333-333333333333', NULL, NOW(), NOW()),
      ('74444444-4444-4444-8444-444444444444', 'legacy/report-only', 'r2', 'pending', 0, NOW(),
       false, NULL, NULL, NOW(), NOW()),
      ('75555555-5555-4555-8555-555555555555', '/legacy/local', 'local', 'processing', 0, NOW(),
       false, NULL, NULL, NOW(), NOW()),
      ('76666666-6666-4666-8666-666666666666', 'legacy/reserved', 'r2', 'reserved', 0, NOW(),
       false, NULL, NULL, NOW(), NOW())
  `);

  await migration.up(queryInterface, Sequelize);

  const [rows] = await sequelize.query(`
    SELECT storage_key, status, last_error, next_attempt_at,
           requires_ownership_proof, ownership_token
    FROM object_cleanup_tasks
    WHERE storage_key LIKE 'proof/%' OR storage_key LIKE 'legacy/%' OR storage_key = '/legacy/local'
    ORDER BY storage_key
  `);
  expect(rows).toEqual([
    expect.objectContaining({
      storage_key: '/legacy/local', status: 'manual_review', last_error: 'OWNERSHIP_PROOF_MISSING',
      next_attempt_at: null, requires_ownership_proof: false, ownership_token: null,
    }),
    expect.objectContaining({
      storage_key: 'legacy/report-only', status: 'manual_review', last_error: 'OWNERSHIP_PROOF_MISSING',
      next_attempt_at: null, requires_ownership_proof: false, ownership_token: null,
    }),
    expect.objectContaining({
      storage_key: 'legacy/reserved', status: 'manual_review', last_error: 'OWNERSHIP_PROOF_MISSING',
      next_attempt_at: null, requires_ownership_proof: false, ownership_token: null,
    }),
    expect.objectContaining({ storage_key: 'proof/pending', requires_ownership_proof: true }),
    expect.objectContaining({
      storage_key: 'proof/processing', requires_ownership_proof: true,
      ownership_token: '72222222-2222-4222-8222-222222222222',
    }),
    expect.objectContaining({ storage_key: 'proof/reserved', requires_ownership_proof: true }),
  ]);
});
