const Sequelize = require('sequelize');
const migration = require('../migrations/20260821000003-create-lawyer-profile-imports');
const { resetDb, models, makeMember } = require('./helpers');

const { sequelize, LawyerProfileImport } = models;
const queryInterface = sequelize.getQueryInterface();

beforeEach(resetDb);

test('00003 creates the exact restart-safe import schema and owner/status index', async () => {
  await queryInterface.dropTable('lawyer_profile_imports');

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('lawyer_profile_imports');
  expect(Object.keys(columns).sort()).toEqual([
    'accepted_data', 'confirmed_at', 'confirmed_from_version', 'created_at',
    'expires_at', 'id', 'mime_type', 'original_name', 'parsed_data',
    'parser_version', 'profile_revision', 'sha256', 'size', 'source', 'status', 'storage_key',
    'updated_at', 'upload_idempotency_key', 'user_id', 'version', 'warnings',
  ].sort());
  expect(columns.id.primaryKey).toBe(true);
  expect(columns.user_id.allowNull).toBe(false);
  expect(columns.warnings.allowNull).toBe(false);
  expect(columns.version.allowNull).toBe(false);

  const [indexes] = await sequelize.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'lawyer_profile_imports_owner_status'
  `);
  expect(indexes).toHaveLength(1);
  expect(indexes[0].indexdef).toMatch(/user_id.*status/i);
});

test('00003 accepts Task 7 queue and idempotency indexes on a restart-safe rerun', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS lawyer_profile_imports_owner_idempotency_unique
      ON lawyer_profile_imports (user_id, upload_idempotency_key)
      WHERE upload_idempotency_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS lawyer_profile_imports_parse_queue_idx
      ON lawyer_profile_imports (status, updated_at, created_at);
    CREATE INDEX IF NOT EXISTS lawyer_profile_imports_retention_queue_idx
      ON lawyer_profile_imports (status, expires_at, confirmed_at)
  `);

  await expect(migration.up(queryInterface, Sequelize)).resolves.toBeUndefined();
});

test('00003 repairs an empty partial table and rejects invalid persisted values', async () => {
  await queryInterface.dropTable('lawyer_profile_imports');
  await queryInterface.createTable('lawyer_profile_imports', {
    storage_key: { type: Sequelize.TEXT },
  });

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const member = await makeMember('import-migration@test.uz');
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: member.id,
    storageKey: 'profile-imports/owner/object',
    originalName: 'profile.pdf',
    mimeType: 'application/pdf',
    size: 512,
    sha256: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  };

  await expect(LawyerProfileImport.create(base)).resolves.toMatchObject({
    source: 'linkedin_pdf',
    status: 'uploaded',
    version: 1,
    confirmedFromVersion: null,
    warnings: [],
  });
  await expect(LawyerProfileImport.create({ ...base, id: undefined, status: 'approved' }))
    .rejects.toThrow();
  await expect(LawyerProfileImport.create({ ...base, id: undefined, size: 10485761 }))
    .rejects.toThrow();
  await expect(LawyerProfileImport.create({ ...base, id: undefined, mimeType: 'text/plain' }))
    .rejects.toThrow();
});

test('import records expose versioned draft and provenance foundation fields', async () => {
  const member = await makeMember('import-model@test.uz');
  const record = await LawyerProfileImport.create({
    userId: member.id,
    storageKey: `profile-imports/${member.id}/object`,
    originalName: 'sanitized-profile.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    sha256: 'b'.repeat(64),
    parsedData: { headline: 'Legal specialist' },
    acceptedData: { headline: 'Legal specialist' },
    warnings: [{ code: 'UNKNOWN_SECTION', section: 'Projects' }],
    parserVersion: 'linkedin-pdf-v1',
    version: 4,
    confirmedFromVersion: 3,
    expiresAt: new Date(Date.now() + 60_000),
    confirmedAt: new Date(),
  });

  expect(record.toJSON()).toMatchObject({
    source: 'linkedin_pdf',
    parsedData: { headline: 'Legal specialist' },
    acceptedData: { headline: 'Legal specialist' },
    parserVersion: 'linkedin-pdf-v1',
    version: 4,
    confirmedFromVersion: 3,
  });
  await expect(member.getProfileImports()).resolves.toHaveLength(1);
});

async function importArtifacts() {
  const [constraints] = await sequelize.query(`
    SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = 'lawyer_profile_imports'
  `);
  const [indexes] = await sequelize.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'lawyer_profile_imports'
  `);
  return {
    constraints: Object.fromEntries(constraints.map((row) => [row.conname, row.definition])),
    indexes: Object.fromEntries(indexes.map((row) => [row.indexname, row.indexdef])),
  };
}

test('00003 rebuilds an empty table when column type/null/default metadata is not exact', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports
      ALTER COLUMN storage_key TYPE varchar(64),
      ALTER COLUMN source DROP NOT NULL,
      ALTER COLUMN source DROP DEFAULT,
      ALTER COLUMN warnings SET DEFAULT '{}'::jsonb;
    ALTER TABLE lawyer_profile_imports
      DROP CONSTRAINT lawyer_profile_imports_status_valid;
    ALTER TABLE lawyer_profile_imports
      ADD CONSTRAINT lawyer_profile_imports_status_valid CHECK (status = 'uploaded');
    DROP INDEX lawyer_profile_imports_owner_status;
    CREATE INDEX lawyer_profile_imports_owner_status
      ON lawyer_profile_imports (status, user_id);
  `);

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('lawyer_profile_imports');
  expect(columns.storage_key.type).toBe('TEXT');
  expect(columns.source.allowNull).toBe(false);
  expect(columns.source.defaultValue).toBe('linkedin_pdf');
  expect(JSON.parse(columns.warnings.defaultValue)).toEqual([]);
  const artifacts = await importArtifacts();
  expect(artifacts.constraints.lawyer_profile_imports_status_valid)
    .toMatch(/uploaded.*parsing.*draft.*confirmed.*failed.*discarded/i);
  expect(artifacts.indexes.lawyer_profile_imports_owner_status)
    .toMatch(/\(user_id, status\)$/i);
});

test('00003 transactionally replaces wrong populated FK/check/index artifacts without losing rows', async () => {
  await migration.up(queryInterface, Sequelize);
  const member = await makeMember('artifact-repair@test.uz');
  const id = '22222222-2222-4222-8222-222222222222';
  await LawyerProfileImport.create({
    id,
    userId: member.id,
    storageKey: `profile-imports/${member.id}/artifact`,
    originalName: 'artifact.pdf',
    mimeType: 'application/pdf',
    size: 128,
    sha256: 'c'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports
      DROP CONSTRAINT lawyer_profile_imports_user_id_fkey,
      DROP CONSTRAINT lawyer_profile_imports_status_valid;
    ALTER TABLE lawyer_profile_imports
      ADD CONSTRAINT lawyer_profile_imports_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE NO ACTION,
      ADD CONSTRAINT lawyer_profile_imports_status_valid CHECK (status = 'uploaded');
    DROP INDEX lawyer_profile_imports_owner_status;
    CREATE UNIQUE INDEX lawyer_profile_imports_owner_status
      ON lawyer_profile_imports (status, user_id);
  `);

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  await expect(LawyerProfileImport.findByPk(id)).resolves.toMatchObject({ id });
  const artifacts = await importArtifacts();
  expect(artifacts.constraints.lawyer_profile_imports_user_id_fkey)
    .toMatch(/FOREIGN KEY \(user_id\).*ON DELETE CASCADE/i);
  expect(artifacts.constraints.lawyer_profile_imports_status_valid)
    .toMatch(/uploaded.*parsing.*draft.*confirmed.*failed.*discarded/i);
  expect(artifacts.indexes.lawyer_profile_imports_owner_status)
    .toMatch(/^CREATE INDEX .*\(user_id, status\)$/i);
});

test('00003 aborts unsafe populated column repair with an artifact diagnostic', async () => {
  await migration.up(queryInterface, Sequelize);
  const member = await makeMember('unsafe-repair@test.uz');
  const id = '33333333-3333-4333-8333-333333333333';
  await LawyerProfileImport.create({
    id,
    userId: member.id,
    storageKey: 'short-key',
    originalName: 'unsafe.pdf',
    mimeType: 'application/pdf',
    size: 128,
    sha256: 'd'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports
      ALTER COLUMN storage_key TYPE varchar(64)
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    /Cannot safely repair populated lawyer_profile_imports.*storage_key.*type/i
  );
  const [rows] = await sequelize.query(`
    SELECT id, storage_key FROM lawyer_profile_imports WHERE id = :id
  `, { replacements: { id } });
  expect(rows).toEqual([{ id, storage_key: 'short-key' }]);
});

test('00003 safely repairs populated nullability and defaults when existing rows conform', async () => {
  await migration.up(queryInterface, Sequelize);
  const member = await makeMember('safe-column-repair@test.uz');
  const id = '44444444-4444-4444-8444-444444444444';
  await LawyerProfileImport.create({
    id,
    userId: member.id,
    storageKey: 'profile-imports/safe/defaults',
    originalName: 'safe.pdf',
    mimeType: 'application/pdf',
    size: 128,
    sha256: 'e'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports
      ALTER COLUMN source DROP NOT NULL,
      ALTER COLUMN source DROP DEFAULT,
      ALTER COLUMN warnings SET DEFAULT '{}'::jsonb
  `);

  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('lawyer_profile_imports');
  expect(columns.source.allowNull).toBe(false);
  expect(columns.source.defaultValue).toBe('linkedin_pdf');
  expect(JSON.parse(columns.warnings.defaultValue)).toEqual([]);
  await expect(LawyerProfileImport.findByPk(id)).resolves.toMatchObject({ id });
});

test('00003 aborts before DDL when an unexpected table constraint exists', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports
      ALTER COLUMN source DROP DEFAULT,
      ADD CONSTRAINT lawyer_profile_imports_custom_check CHECK (size < 9000000)
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    /Unexpected lawyer_profile_imports artifacts.*constraint:lawyer_profile_imports_custom_check/i
  );

  const [[source]] = await sequelize.query(`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'lawyer_profile_imports'
      AND column_name = 'source'
  `);
  expect(source.column_default).toBeNull();
  const artifacts = await importArtifacts();
  expect(artifacts.constraints.lawyer_profile_imports_custom_check).toBeTruthy();
});

test('00003 aborts before DDL when an unexpected table index exists', async () => {
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE lawyer_profile_imports ALTER COLUMN source DROP DEFAULT;
    CREATE INDEX lawyer_profile_imports_custom_idx
      ON lawyer_profile_imports (created_at)
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    /Unexpected lawyer_profile_imports artifacts.*index:lawyer_profile_imports_custom_idx/i
  );

  const [[source]] = await sequelize.query(`
    SELECT column_default FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'lawyer_profile_imports'
      AND column_name = 'source'
  `);
  expect(source.column_default).toBeNull();
  const artifacts = await importArtifacts();
  expect(artifacts.indexes.lawyer_profile_imports_custom_idx).toBeTruthy();
});
