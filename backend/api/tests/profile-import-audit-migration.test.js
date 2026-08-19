const Sequelize = require('sequelize');
const { resetDb, models, makeMember } = require('./helpers');

const { sequelize } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(resetDb, 60000);

function loadMigration() {
  return require('../migrations/20260821000004-create-profile-import-audits');
}

test('00004 creates restart-safe content-free audits and import queue indexes', async () => {
  expect(loadMigration).not.toThrow();
  const migration = loadMigration();

  await queryInterface.dropTable('profile_import_audits');
  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('profile_import_audits');
  expect(Object.keys(columns).sort()).toEqual([
    'actor_user_id', 'created_at', 'event', 'expires_at', 'id', 'import_id',
    'owner_user_id',
  ].sort());

  const [foreignKeys] = await sequelize.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'profile_import_audits'
      AND c.contype = 'f'
  `);
  expect(foreignKeys).toEqual([]);

  const importColumns = await queryInterface.describeTable('lawyer_profile_imports');
  const profileColumns = await queryInterface.describeTable('lawyer_profiles');
  expect(importColumns.profile_revision.allowNull).toBe(false);
  expect(importColumns.profile_revision.defaultValue).toBe('1');
  expect(profileColumns.revision.allowNull).toBe(false);
  expect(profileColumns.revision.defaultValue).toBe('1');

  const [indexes] = await sequelize.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('lawyer_profile_imports', 'profile_import_audits')
  `);
  const byName = Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef]));
  expect(byName.lawyer_profile_imports_owner_idempotency_unique)
    .toMatch(/UNIQUE.*user_id, upload_idempotency_key.*WHERE.*IS NOT NULL/i);
  expect(byName.lawyer_profile_imports_parse_queue_idx).toMatch(/status, updated_at, created_at/i);
  expect(byName.lawyer_profile_imports_retention_queue_idx).toMatch(/status, expires_at, confirmed_at/i);
  expect(byName.profile_import_audits_expiry_idx).toMatch(/expires_at/i);
});

test('00004 enforces the audit event allowlist and expiry no later than 90 days', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  const owner = await makeMember('audit-schema@test.uz');
  const createdAt = new Date('2026-08-16T12:00:00.000Z');
  const expiresAt = new Date('2026-11-14T12:00:00.000Z');

  await expect(sequelize.query(`
    INSERT INTO profile_import_audits
      (id, import_id, owner_user_id, actor_user_id, event, created_at, expires_at)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), :ownerId, :ownerId, 'admin_view', :createdAt, :expiresAt)
  `, { replacements: { ownerId: owner.id, createdAt, expiresAt } })).resolves.toBeDefined();

  await expect(sequelize.query(`
    INSERT INTO profile_import_audits
      (id, import_id, owner_user_id, event, created_at, expires_at)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), :ownerId, 'pdf_text', :createdAt, :expiresAt)
  `, { replacements: { ownerId: owner.id, createdAt, expiresAt } })).rejects.toThrow();

  await expect(sequelize.query(`
    INSERT INTO profile_import_audits
      (id, import_id, owner_user_id, event, created_at, expires_at)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), :ownerId, 'owner_delete', :createdAt,
       :expiresAt + interval '1 second')
  `, { replacements: { ownerId: owner.id, createdAt, expiresAt } })).rejects.toThrow();
});

test('00004 repairs wrong named constraints and queue indexes on rerun', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE profile_import_audits
      DROP CONSTRAINT profile_import_audits_event_valid,
      DROP CONSTRAINT profile_import_audits_expiry_valid;
    ALTER TABLE profile_import_audits
      ADD CONSTRAINT profile_import_audits_event_valid CHECK (event <> ''),
      ADD CONSTRAINT profile_import_audits_expiry_valid CHECK (expires_at > created_at);
    DROP INDEX lawyer_profile_imports_parse_queue_idx;
    CREATE UNIQUE INDEX lawyer_profile_imports_parse_queue_idx
      ON lawyer_profile_imports (created_at, status)
  `);

  await migration.up(queryInterface, Sequelize);

  const [constraints] = await sequelize.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'profile_import_audits'::regclass
  `);
  const byName = Object.fromEntries(constraints.map((row) => [row.conname, row.definition]));
  expect(byName.profile_import_audits_event_valid).toMatch(/admin_view.*admin_download.*field_verified/i);
  expect(byName.profile_import_audits_expiry_valid).toMatch(/90 days/i);

  const [indexes] = await sequelize.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'lawyer_profile_imports_parse_queue_idx'
  `);
  expect(indexes[0].indexdef).toMatch(/^CREATE INDEX .+\(status, updated_at, created_at\)$/i);
});

test('00004 rejects a content-bearing audit table instead of accepting an unexpected payload column', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query('ALTER TABLE profile_import_audits ADD COLUMN payload text');

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    /Unexpected profile_import_audits column.*payload/i
  );
});

test('00004 removes an unexpected import foreign key so audit retention is independent', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE profile_import_audits
      ADD CONSTRAINT profile_import_audits_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES lawyer_profile_imports(id)
  `);

  await migration.up(queryInterface, Sequelize);

  const [foreignKeys] = await sequelize.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'profile_import_audits'::regclass AND contype = 'f'
  `);
  expect(foreignKeys).toEqual([]);
});

test('00004 repairs checks that include all tokens but allow an extra event or weakened expiry', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE profile_import_audits
      DROP CONSTRAINT profile_import_audits_event_valid,
      DROP CONSTRAINT profile_import_audits_expiry_valid;
    ALTER TABLE profile_import_audits
      ADD CONSTRAINT profile_import_audits_event_valid CHECK (event IN (
        'admin_view', 'admin_download', 'owner_delete', 'retention_cleanup',
        'profile_review_cleanup', 'field_verified', 'extra_event'
      )),
      ADD CONSTRAINT profile_import_audits_expiry_valid CHECK (
        expires_at <= created_at + interval '90 days' OR event = 'admin_view'
      )
  `);

  await migration.up(queryInterface, Sequelize);

  const owner = await makeMember('audit-exact-check@test.uz');
  await expect(sequelize.query(`
    INSERT INTO profile_import_audits
      (id, owner_user_id, event, created_at, expires_at)
    VALUES (gen_random_uuid(), :ownerId, 'extra_event', NOW(), NOW())
  `, { replacements: { ownerId: owner.id } })).rejects.toThrow();
  await expect(sequelize.query(`
    INSERT INTO profile_import_audits
      (id, owner_user_id, event, created_at, expires_at)
    VALUES (gen_random_uuid(), :ownerId, 'admin_view', NOW(), NOW() + interval '91 days')
  `, { replacements: { ownerId: owner.id } })).rejects.toThrow();
});
