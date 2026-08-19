const Sequelize = require('sequelize');
const { resetDb, models } = require('./helpers');

const { sequelize, User, Document, CaseDocument, LawyerDocument } = models;
const queryInterface = sequelize.getQueryInterface();

function loadMigration() {
  return require('../migrations/20260822000000-add-storage-metadata');
}

beforeEach(resetDb);
afterEach(async () => {
  await sequelize.query('DROP SCHEMA IF EXISTS storage_scope_test CASCADE');
});

test('storage metadata migration and model contract exist', () => {
  expect(loadMigration).not.toThrow();

  expect(User.rawAttributes).toEqual(expect.objectContaining({
    avatarStorageProvider: expect.any(Object),
    avatarStorageKey: expect.any(Object),
    avatarMimeType: expect.any(Object),
    avatarSize: expect.any(Object),
    avatarSha256: expect.any(Object),
    avatarLocalPath: expect.any(Object),
  }));
  for (const model of [Document, CaseDocument, LawyerDocument]) {
    expect(model.rawAttributes).toEqual(expect.objectContaining({
      storageProvider: expect.any(Object),
      storageKey: expect.any(Object),
      sha256: expect.any(Object),
    }));
    expect(model.rawAttributes.path.allowNull).toBe(true);
  }
  expect(Document.rawAttributes.mimeType).toEqual(expect.any(Object));
});

test('migration upgrades populated legacy rows, creates exact constraints, and reruns safely', async () => {
  const migration = loadMigration();
  const client = await User.create({
    name: 'Legacy Client', email: 'legacy-storage@test.uz', password: 'passw0rd', role: 'client',
  });
  const document = await Document.create({
    userId: client.id, name: 'legacy.txt', path: '/uploads/legacy.txt', size: 6,
  });
  for (const table of ['documents', 'case_documents', 'lawyer_documents']) {
    await queryInterface.changeColumn(table, 'path', {
      type: Sequelize.STRING,
      allowNull: false,
    });
  }

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const tableColumns = await Promise.all([
    queryInterface.describeTable('users'),
    queryInterface.describeTable('documents'),
    queryInterface.describeTable('case_documents'),
    queryInterface.describeTable('lawyer_documents'),
  ]);
  expect(tableColumns[0]).toEqual(expect.objectContaining({
    avatar_storage_provider: expect.any(Object), avatar_storage_key: expect.any(Object),
    avatar_mime_type: expect.any(Object), avatar_size: expect.any(Object), avatar_sha256: expect.any(Object),
    avatar_local_path: expect.any(Object),
  }));
  expect(tableColumns[0].avatar_local_path.allowNull).toBe(true);
  for (const columns of tableColumns.slice(1)) {
    expect(columns).toEqual(expect.objectContaining({
      storage_provider: expect.any(Object), storage_key: expect.any(Object), sha256: expect.any(Object),
    }));
    expect(columns.path.allowNull).toBe(true);
  }
  expect(tableColumns[1].mime_type).toEqual(expect.any(Object));

  const [constraints] = await sequelize.query(`
    SELECT t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND c.conname IN (
        'users_avatar_storage_pair_valid', 'users_avatar_storage_provider_valid',
        'users_avatar_sha256_valid', 'users_avatar_size_nonnegative',
        'documents_storage_pair_valid', 'documents_storage_provider_valid',
        'documents_sha256_valid', 'documents_size_nonnegative',
        'case_documents_storage_pair_valid', 'case_documents_storage_provider_valid',
        'case_documents_sha256_valid', 'case_documents_size_nonnegative',
        'lawyer_documents_storage_pair_valid', 'lawyer_documents_storage_provider_valid',
        'lawyer_documents_sha256_valid', 'lawyer_documents_size_nonnegative'
      )
  `);
  expect(constraints).toHaveLength(16);

  const [indexes] = await sequelize.query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'users_avatar_storage_key_unique', 'documents_storage_key_unique',
        'case_documents_storage_key_unique', 'lawyer_documents_storage_key_unique'
      )
  `);
  expect(indexes).toHaveLength(4);
  for (const index of indexes) {
    expect(index.indexdef).toMatch(/UNIQUE.*storage_provider.*storage_key.*WHERE.*storage_key IS NOT NULL/i);
  }

  await expect(Document.findByPk(document.id)).resolves.toMatchObject({
    path: '/uploads/legacy.txt', storageProvider: null, storageKey: null,
  });
});

test('migration constraints reject partial, unsafe, duplicate, and mismatched metadata', async () => {
  await loadMigration().up(queryInterface, Sequelize);
  const client = await User.create({
    name: 'Storage Client', email: 'storage-checks@test.uz', password: 'passw0rd', role: 'client',
  });
  const validSha = 'a'.repeat(64);

  await expect(Document.create({
    userId: client.id, name: 'partial', storageProvider: 'r2', size: 1,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'missing-mime', storageProvider: 'r2',
    storageKey: 'documents/missing-mime', size: 1, sha256: validSha,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'missing-size', storageProvider: 'r2',
    storageKey: 'documents/missing-size', mimeType: 'application/pdf', sha256: validSha,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'missing-sha', storageProvider: 'r2',
    storageKey: 'documents/missing-sha', mimeType: 'application/pdf', size: 1,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'unsafe', storageProvider: 'public', storageKey: 'documents/one', size: 1,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'bad-sha', storageProvider: 'r2', storageKey: 'documents/two',
    sha256: 'ABC', size: 1,
  })).rejects.toThrow();
  await expect(Document.create({
    userId: client.id, name: 'bad-size', storageProvider: 'r2', storageKey: 'documents/three',
    sha256: validSha, size: -1,
  })).rejects.toThrow();

  await Document.create({
    userId: client.id, name: 'valid', storageProvider: 'r2', storageKey: 'documents/unique',
    mimeType: 'application/pdf', sha256: validSha, size: 1,
  });
  await expect(Document.create({
    userId: client.id, name: 'duplicate', storageProvider: 'r2', storageKey: 'documents/unique',
    mimeType: 'application/pdf', sha256: validSha, size: 1,
  })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
});

test('all storage-backed models require MIME, size, and SHA-256 when a key is present', async () => {
  const client = await User.create({
    name: 'Strict Metadata', email: 'strict-storage@test.uz', password: 'passw0rd', role: 'client',
  });
  const common = { storageProvider: 'r2', storageKey: 'strict/key' };

  await expect(Document.create({ userId: client.id, name: 'document', ...common }))
    .rejects.toThrow();
  await expect(CaseDocument.create({
    consultationId: null, uploaderId: client.id, name: 'case', ...common,
  })).rejects.toThrow();
  await expect(LawyerDocument.create({ userId: client.id, name: 'lawyer', ...common }))
    .rejects.toThrow();
  await expect(client.update({
    avatarStorageProvider: 'r2', avatarStorageKey: 'strict/avatar',
  })).rejects.toThrow();
});

test('migration aborts before mutation when any required table is absent', async () => {
  const migration = loadMigration();
  await queryInterface.removeColumn('users', 'avatar_sha256');
  await sequelize.query('DROP TABLE lawyer_documents CASCADE');

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    'Required storage table is missing: lawyer_documents'
  );

  const users = await queryInterface.describeTable('users');
  expect(users.avatar_sha256).toBeUndefined();
});

test('migration repairs safe nullable/default/width drift and aborts incompatible types', async () => {
  const migration = loadMigration();
  await sequelize.query(`
    ALTER TABLE documents DROP COLUMN storage_provider;
    ALTER TABLE documents ADD COLUMN storage_provider varchar(10) NOT NULL DEFAULT 'local';
    ALTER TABLE users DROP COLUMN avatar_local_path;
    ALTER TABLE users ADD COLUMN avatar_local_path varchar(10) NOT NULL DEFAULT '/legacy';
  `);

  await migration.up(queryInterface, Sequelize);
  let columns = await queryInterface.describeTable('documents');
  expect(columns.storage_provider.allowNull).toBe(true);
  expect(columns.storage_provider.defaultValue).toBeNull();
  expect(columns.storage_provider.type).toMatch(/(?:VARCHAR|CHARACTER VARYING)\(20\)/i);
  const users = await queryInterface.describeTable('users');
  expect(users.avatar_local_path.allowNull).toBe(true);
  expect(users.avatar_local_path.defaultValue).toBeNull();
  expect(users.avatar_local_path.type).toMatch(/(?:VARCHAR|CHARACTER VARYING)\(255\)/i);

  await sequelize.query(`
    ALTER TABLE documents DROP CONSTRAINT documents_sha256_valid;
    ALTER TABLE documents DROP CONSTRAINT documents_storage_pair_valid;
    ALTER TABLE documents DROP COLUMN sha256;
    ALTER TABLE documents ADD COLUMN sha256 integer;
  `);
  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    'Incompatible storage column documents.sha256'
  );
  columns = await queryInterface.describeTable('documents');
  expect(columns.sha256.type).toMatch(/INTEGER/i);
});

test('migration preflights all column compatibility before repairing any table', async () => {
  const migration = loadMigration();
  await sequelize.query(`
    ALTER TABLE case_documents DROP COLUMN storage_provider;
    ALTER TABLE case_documents ADD COLUMN storage_provider varchar(10) NOT NULL DEFAULT 'local';
    ALTER TABLE lawyer_documents DROP COLUMN sha256;
    ALTER TABLE lawyer_documents ADD COLUMN sha256 integer;
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
    'Incompatible storage column lawyer_documents.sha256'
  );

  const columns = await queryInterface.describeTable('case_documents');
  expect(columns.storage_provider.allowNull).toBe(false);
  expect(columns.storage_provider.defaultValue).toBe('local');
  expect(columns.storage_provider.type).toMatch(/(?:VARCHAR|CHARACTER VARYING)\(10\)/i);
});

test('migration uses validated NOT VALID checks and concurrent indexes idempotently', async () => {
  const migration = loadMigration();
  await sequelize.query(`
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_storage_pair_valid;
    DROP INDEX IF EXISTS documents_storage_key_unique;
  `);
  const querySpy = jest.spyOn(sequelize, 'query');

  await migration.up(queryInterface, Sequelize);
  const firstSql = querySpy.mock.calls.map(([sql]) => String(sql)).join('\n');
  expect(firstSql).toMatch(/ADD CONSTRAINT "?documents_storage_pair_valid"?[\s\S]*NOT VALID/i);
  expect(firstSql).toMatch(/VALIDATE CONSTRAINT "?documents_storage_pair_valid"?/i);
  expect(firstSql).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY "?documents_storage_key_unique"?/i);
  querySpy.mockClear();

  await migration.up(queryInterface, Sequelize);
  const secondSql = querySpy.mock.calls.map(([sql]) => String(sql)).join('\n');
  expect(secondSql).not.toMatch(/DROP CONSTRAINT "?documents_storage_pair_valid"?/i);
  expect(secondSql).not.toMatch(/CREATE UNIQUE INDEX CONCURRENTLY "?documents_storage_key_unique"?/i);
  querySpy.mockRestore();

  const [[constraint]] = await sequelize.query(`
    SELECT c.convalidated FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND c.conname = 'documents_storage_pair_valid'
  `);
  expect(constraint.convalidated).toBe(true);
});

test('migration repairs only current-schema constraints and indexes', async () => {
  const migration = loadMigration();
  await sequelize.query(`
    CREATE SCHEMA storage_scope_test;
    CREATE TABLE storage_scope_test.documents (
      storage_provider text,
      storage_key text,
      CONSTRAINT documents_storage_pair_valid CHECK (storage_provider = 'shadow')
    );
    CREATE UNIQUE INDEX documents_storage_key_unique
      ON storage_scope_test.documents (storage_provider, storage_key);
  `);
  await sequelize.query(`
    ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_storage_pair_valid;
    DROP INDEX IF EXISTS documents_storage_key_unique;
  `);

  await migration.up(queryInterface, Sequelize);

  const [[target]] = await sequelize.query(`
    SELECT COUNT(*)::integer AS count
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND c.conname = 'documents_storage_pair_valid'
  `);
  const [[shadow]] = await sequelize.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'storage_scope_test' AND t.relname = 'documents'
      AND c.conname = 'documents_storage_pair_valid'
  `);
  expect(target.count).toBe(1);
  expect(shadow.definition).toMatch(/shadow/);
});

test('migration replaces same-named malformed current-schema checks and partial indexes', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE documents DROP CONSTRAINT documents_storage_provider_valid;
    ALTER TABLE documents ADD CONSTRAINT documents_storage_provider_valid
      CHECK (storage_provider IS NULL OR storage_provider = 'shadow');
    DROP INDEX documents_storage_key_unique;
    CREATE UNIQUE INDEX documents_storage_key_unique
      ON documents (storage_key) WHERE storage_provider = 'shadow';
  `);

  await migration.up(queryInterface, Sequelize);

  const [[constraint]] = await sequelize.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND c.conname = 'documents_storage_provider_valid'
  `);
  const [[index]] = await sequelize.query(`
    SELECT indexdef AS definition FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'documents'
      AND indexname = 'documents_storage_key_unique'
  `);
  expect(constraint.definition).toMatch(/storage_provider.*local.*r2/i);
  expect(constraint.definition).not.toMatch(/shadow/i);
  expect(index.definition).toMatch(/UNIQUE.*storage_provider.*storage_key.*WHERE.*storage_key IS NOT NULL/i);
  expect(index.definition).not.toMatch(/shadow/i);
});

test('migration repairs weakened or extra full constraint expressions that retain expected tokens', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    ALTER TABLE documents DROP CONSTRAINT documents_storage_pair_valid;
    ALTER TABLE documents ADD CONSTRAINT documents_storage_pair_valid CHECK (
      (((storage_key IS NULL AND storage_provider IS NULL) OR (
        storage_key IS NOT NULL AND storage_provider IS NOT NULL
        AND mime_type IS NOT NULL AND btrim(mime_type) <> ''
        AND size IS NOT NULL AND size >= 0
        AND sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$')))
      OR storage_key IS NOT NULL
    );
    ALTER TABLE documents DROP CONSTRAINT documents_size_nonnegative;
    ALTER TABLE documents ADD CONSTRAINT documents_size_nonnegative
      CHECK ((size IS NULL OR size >= 0) AND (size IS NULL OR size < 999999999));
  `);

  await migration.up(queryInterface, Sequelize);

  const [constraints] = await sequelize.query(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND c.conname IN ('documents_storage_pair_valid', 'documents_size_nonnegative')
  `);
  const definitions = Object.fromEntries(constraints.map((row) => [row.conname, row.definition]));
  expect(definitions.documents_storage_pair_valid).not.toMatch(/OR \(storage_key IS NOT NULL\)\)\)$/i);
  expect(definitions.documents_size_nonnegative).not.toMatch(/999999999/);
  await expect(sequelize.query(`
    INSERT INTO documents (id, name, storage_key, created_at, updated_at)
    VALUES (gen_random_uuid(), 'invalid', 'documents/invalid', NOW(), NOW())
  `)).rejects.toThrow();
});

test('migration drops and recreates invalid, unready, or extra-clause concurrent indexes', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    DROP INDEX documents_storage_key_unique;
    INSERT INTO documents
      (id, name, storage_provider, storage_key, mime_type, size, sha256, created_at, updated_at)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'a', 'r2', 'documents/duplicate',
       'application/pdf', 1, '${'a'.repeat(64)}', NOW(), NOW()),
      ('22222222-2222-4222-8222-222222222222', 'b', 'r2', 'documents/duplicate',
       'application/pdf', 1, '${'a'.repeat(64)}', NOW(), NOW());
  `);
  await expect(sequelize.query(`
    CREATE UNIQUE INDEX CONCURRENTLY documents_storage_key_unique
      ON documents (storage_provider, storage_key) WHERE storage_key IS NOT NULL
  `)).rejects.toThrow();
  await sequelize.query(`
    DELETE FROM documents WHERE id = '22222222-2222-4222-8222-222222222222'
  `);

  await migration.up(queryInterface, Sequelize);

  const [[index]] = await sequelize.query(`
    SELECT pg_get_indexdef(i.oid) AS definition, ix.indisvalid, ix.indisready
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND i.relname = 'documents_storage_key_unique'
  `);
  expect(index.indisvalid).toBe(true);
  expect(index.indisready).toBe(true);
  expect(index.definition).toMatch(/UNIQUE.*storage_provider.*storage_key.*WHERE.*storage_key IS NOT NULL/i);
});

test('migration replaces a valid ready index when its full definition has an extra clause', async () => {
  const migration = loadMigration();
  await migration.up(queryInterface, Sequelize);
  await sequelize.query(`
    DROP INDEX documents_storage_key_unique;
    CREATE UNIQUE INDEX documents_storage_key_unique
      ON documents (storage_provider, storage_key) INCLUDE (size)
      WHERE storage_key IS NOT NULL
  `);

  await migration.up(queryInterface, Sequelize);

  const [[index]] = await sequelize.query(`
    SELECT pg_get_indexdef(i.oid) AS definition, ix.indisvalid, ix.indisready
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'documents'
      AND i.relname = 'documents_storage_key_unique'
  `);
  expect(index).toMatchObject({ indisvalid: true, indisready: true });
  expect(index.definition).not.toMatch(/INCLUDE/i);
});
