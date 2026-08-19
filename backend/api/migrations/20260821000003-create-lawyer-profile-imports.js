'use strict';

const TABLE = 'lawyer_profile_imports';
const OWNER_INDEX = 'lawyer_profile_imports_owner_status';
const TASK7_INDEXES = [
  'lawyer_profile_imports_owner_idempotency_unique',
  'lawyer_profile_imports_parse_queue_idx',
  'lawyer_profile_imports_retention_queue_idx',
];

async function tableExists(sequelize, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT to_regclass(format('%I.%I', current_schema(), :tableName)) IS NOT NULL AS exists
  `, { replacements: { tableName: TABLE }, transaction });
  return row.exists;
}

function columns(Sequelize) {
  return {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    },
    user_id: {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'linkedin_pdf' },
    status: { type: Sequelize.STRING(24), allowNull: false, defaultValue: 'uploaded' },
    storage_key: { type: Sequelize.TEXT, allowNull: false },
    upload_idempotency_key: { type: Sequelize.STRING(128), allowNull: true },
    original_name: { type: Sequelize.TEXT, allowNull: false },
    mime_type: { type: Sequelize.STRING(128), allowNull: false },
    size: { type: Sequelize.INTEGER, allowNull: false },
    sha256: { type: Sequelize.CHAR(64), allowNull: false },
    parsed_data: { type: Sequelize.JSONB, allowNull: true },
    accepted_data: { type: Sequelize.JSONB, allowNull: true },
    warnings: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
    parser_version: { type: Sequelize.STRING(64), allowNull: true },
    profile_revision: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    confirmed_from_version: { type: Sequelize.INTEGER, allowNull: true },
    expires_at: { type: Sequelize.DATE, allowNull: false },
    confirmed_at: { type: Sequelize.DATE, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  };
}

const COLUMN_SPECS = {
  id: { type: 'uuid', nullable: false, defaultValue: 'gen_random_uuid()', defaultSql: 'gen_random_uuid()' },
  user_id: { type: 'uuid', nullable: false, defaultValue: null },
  source: { type: 'varchar', length: 32, nullable: false, defaultValue: "'linkedin_pdf'::character varying", defaultSql: "'linkedin_pdf'" },
  status: { type: 'varchar', length: 24, nullable: false, defaultValue: "'uploaded'::character varying", defaultSql: "'uploaded'" },
  storage_key: { type: 'text', nullable: false, defaultValue: null },
  upload_idempotency_key: { type: 'varchar', length: 128, nullable: true, defaultValue: null },
  original_name: { type: 'text', nullable: false, defaultValue: null },
  mime_type: { type: 'varchar', length: 128, nullable: false, defaultValue: null },
  size: { type: 'int4', nullable: false, defaultValue: null },
  sha256: { type: 'bpchar', length: 64, nullable: false, defaultValue: null },
  parsed_data: { type: 'jsonb', nullable: true, defaultValue: null },
  accepted_data: { type: 'jsonb', nullable: true, defaultValue: null },
  warnings: { type: 'jsonb', nullable: false, defaultValue: "'[]'::jsonb", defaultSql: "'[]'::jsonb" },
  parser_version: { type: 'varchar', length: 64, nullable: true, defaultValue: null },
  profile_revision: { type: 'int4', nullable: false, defaultValue: '1', defaultSql: '1' },
  version: { type: 'int4', nullable: false, defaultValue: '1', defaultSql: '1' },
  confirmed_from_version: { type: 'int4', nullable: true, defaultValue: null },
  expires_at: { type: 'timestamptz', nullable: false, defaultValue: null },
  confirmed_at: { type: 'timestamptz', nullable: true, defaultValue: null },
  created_at: { type: 'timestamptz', nullable: false, defaultValue: 'now()', defaultSql: 'NOW()' },
  updated_at: { type: 'timestamptz', nullable: false, defaultValue: 'now()', defaultSql: 'NOW()' },
};

const CONSTRAINTS = {
  lawyer_profile_imports_pkey: {
    type: 'p',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_pkey PRIMARY KEY (id)`,
    definition: 'PRIMARY KEY (id)',
  },
  lawyer_profile_imports_user_id_fkey: {
    type: 'f',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    definition: 'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
  },
  lawyer_profile_imports_source_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_source_valid CHECK (source = 'linkedin_pdf')`,
    definition: "CHECK (((source)::text = 'linkedin_pdf'::text))",
  },
  lawyer_profile_imports_status_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_status_valid
      CHECK (status IN ('uploaded','parsing','draft','confirmed','failed','discarded'))`,
    definition: "CHECK (((status)::text = ANY ((ARRAY['uploaded'::character varying, 'parsing'::character varying, 'draft'::character varying, 'confirmed'::character varying, 'failed'::character varying, 'discarded'::character varying])::text[])))",
  },
  lawyer_profile_imports_mime_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_mime_valid CHECK (mime_type = 'application/pdf')`,
    definition: "CHECK (((mime_type)::text = 'application/pdf'::text))",
  },
  lawyer_profile_imports_size_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_size_valid CHECK (size > 0 AND size <= 10485760)`,
    definition: 'CHECK (((size > 0) AND (size <= 10485760)))',
  },
  lawyer_profile_imports_sha256_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_sha256_valid CHECK (sha256 ~ '^[0-9a-f]{64}$')`,
    definition: "CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))",
  },
  lawyer_profile_imports_version_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_version_valid CHECK (version >= 1)`,
    definition: 'CHECK ((version >= 1))',
  },
  lawyer_profile_imports_confirmed_version_valid: {
    type: 'c',
    sql: `ALTER TABLE ${TABLE} ADD CONSTRAINT lawyer_profile_imports_confirmed_version_valid
      CHECK (confirmed_from_version IS NULL OR confirmed_from_version >= 1)`,
    definition: 'CHECK (((confirmed_from_version IS NULL) OR (confirmed_from_version >= 1)))',
  },
};

function normalizeDefinition(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

async function getColumnIssues(sequelize, transaction) {
  const [rows] = await sequelize.query(`
    SELECT column_name, udt_name, character_maximum_length, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :tableName
  `, { replacements: { tableName: TABLE }, transaction });
  const actual = new Map(rows.map((row) => [row.column_name, row]));
  const issues = [];

  for (const [name, spec] of Object.entries(COLUMN_SPECS)) {
    const column = actual.get(name);
    if (!column) {
      issues.push({ name, kind: 'missing' });
      continue;
    }
    if (column.udt_name !== spec.type
      || (spec.length || null) !== (column.character_maximum_length || null)) {
      issues.push({ name, kind: 'type' });
    }
    if ((column.is_nullable === 'YES') !== spec.nullable) {
      issues.push({ name, kind: 'nullability' });
    }
    if ((column.column_default || null) !== spec.defaultValue) {
      issues.push({ name, kind: 'default' });
    }
    actual.delete(name);
  }
  for (const name of actual.keys()) issues.push({ name, kind: 'unexpected' });
  return issues;
}

async function rowCount(sequelize, transaction) {
  const [[row]] = await sequelize.query(
    `SELECT COUNT(*)::integer AS count FROM ${TABLE}`,
    { transaction }
  );
  return row.count;
}

async function repairPopulatedColumns(sequelize, issues, transaction) {
  const unsafe = issues.filter(({ kind }) => ['missing', 'unexpected', 'type'].includes(kind));
  if (unsafe.length) {
    const detail = unsafe.map(({ name, kind }) => `${name}:${kind}`).join(', ');
    throw new Error(`Cannot safely repair populated ${TABLE}; incompatible columns: ${detail}`);
  }
  for (const issue of issues) {
    const spec = COLUMN_SPECS[issue.name];
    if (issue.kind === 'nullability') {
      if (!spec.nullable) {
        const [[row]] = await sequelize.query(
          `SELECT COUNT(*)::integer AS count FROM ${TABLE} WHERE ${issue.name} IS NULL`,
          { transaction }
        );
        if (row.count > 0) {
          throw new Error(`Cannot safely repair populated ${TABLE}; ${issue.name} contains NULL`);
        }
        await sequelize.query(
          `ALTER TABLE ${TABLE} ALTER COLUMN ${issue.name} SET NOT NULL`,
          { transaction }
        );
      } else {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ALTER COLUMN ${issue.name} DROP NOT NULL`,
          { transaction }
        );
      }
    }
    if (issue.kind === 'default') {
      const action = spec.defaultValue === null
        ? 'DROP DEFAULT'
        : `SET DEFAULT ${spec.defaultSql}`;
      await sequelize.query(
        `ALTER TABLE ${TABLE} ALTER COLUMN ${issue.name} ${action}`,
        { transaction }
      );
    }
  }
}

async function getConstraints(sequelize, transaction) {
  const [rows] = await sequelize.query(`
    SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = :tableName
  `, { replacements: { tableName: TABLE }, transaction });
  return new Map(rows.map((row) => [row.conname, row]));
}

async function assertNoUnexpectedArtifacts(sequelize, transaction) {
  const constraints = await getConstraints(sequelize, transaction);
  const [indexes] = await sequelize.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = :tableName
  `, { replacements: { tableName: TABLE }, transaction });
  const allowedConstraints = new Set(Object.keys(CONSTRAINTS));
  const allowedIndexes = new Set(['lawyer_profile_imports_pkey', OWNER_INDEX, ...TASK7_INDEXES]);
  const unexpected = [
    ...[...constraints.keys()]
      .filter((name) => !allowedConstraints.has(name))
      .map((name) => `constraint:${name}`),
    ...indexes
      .map((row) => row.indexname)
      .filter((name) => !allowedIndexes.has(name))
      .map((name) => `index:${name}`),
  ].sort();
  if (unexpected.length) {
    throw new Error(`Unexpected ${TABLE} artifacts; manual review required: ${unexpected.join(', ')}`);
  }
}

async function ensureConstraints(queryInterface, sequelize, transaction) {
  const actual = await getConstraints(sequelize, transaction);
  for (const [name, spec] of Object.entries(CONSTRAINTS)) {
    const existing = actual.get(name);
    const matches = existing
      && existing.contype === spec.type
      && normalizeDefinition(existing.definition) === normalizeDefinition(spec.definition);
    if (matches) continue;
    if (existing) await queryInterface.removeConstraint(TABLE, name, { transaction });
    await sequelize.query(spec.sql, { transaction });
  }
}

async function getOwnerIndex(sequelize, transaction) {
  const [rows] = await sequelize.query(`
    SELECT i.indisunique, i.indisvalid, pg_get_expr(i.indpred, i.indrelid) AS predicate,
      array_agg(a.attname ORDER BY keys.ordinality) AS columns
    FROM pg_class index_class
    JOIN pg_index i ON i.indexrelid = index_class.oid
    JOIN pg_class table_class ON table_class.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = table_class.relnamespace
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY keys(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = table_class.oid AND a.attnum = keys.attnum
    WHERE n.nspname = current_schema()
      AND table_class.relname = :tableName
      AND index_class.relname = :indexName
    GROUP BY i.indisunique, i.indisvalid, i.indpred, i.indrelid
  `, { replacements: { tableName: TABLE, indexName: OWNER_INDEX }, transaction });
  return rows[0] || null;
}

async function ensureOwnerIndex(queryInterface, sequelize, transaction) {
  const index = await getOwnerIndex(sequelize, transaction);
  const matches = index
    && index.indisunique === false
    && index.indisvalid === true
    && index.predicate === null
    && JSON.stringify(index.columns) === JSON.stringify(['user_id', 'status']);
  if (matches) return;
  if (index) await queryInterface.removeIndex(TABLE, OWNER_INDEX, { transaction });
  await queryInterface.addIndex(TABLE, ['user_id', 'status'], {
    name: OWNER_INDEX,
    transaction,
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      const definitions = columns(Sequelize);
      if (!(await tableExists(sequelize, transaction))) {
        await queryInterface.createTable(TABLE, definitions, { transaction });
      } else {
        await assertNoUnexpectedArtifacts(sequelize, transaction);
        const issues = await getColumnIssues(sequelize, transaction);
        if (issues.length) {
          const count = await rowCount(sequelize, transaction);
          if (count === 0) {
            await queryInterface.dropTable(TABLE, { transaction });
            await queryInterface.createTable(TABLE, definitions, { transaction });
          } else {
            await repairPopulatedColumns(sequelize, issues, transaction);
          }
        }
      }
      await ensureConstraints(queryInterface, sequelize, transaction);
      await ensureOwnerIndex(queryInterface, sequelize, transaction);
    });
  },

  // Imports are user-owned retention records; rollback must not silently delete them.
  async down() {},
};
