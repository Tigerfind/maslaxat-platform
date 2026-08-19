'use strict';

const TABLES = Object.freeze([
  {
    table: 'users', prefix: 'users_avatar', provider: 'avatar_storage_provider',
    key: 'avatar_storage_key', mime: 'avatar_mime_type', size: 'avatar_size',
    sha: 'avatar_sha256', path: 'avatar_local_path',
  },
  {
    table: 'documents', prefix: 'documents', provider: 'storage_provider', key: 'storage_key',
    mime: 'mime_type', size: 'size', sha: 'sha256', path: 'path',
  },
  {
    table: 'case_documents', prefix: 'case_documents', provider: 'storage_provider', key: 'storage_key',
    mime: 'mime_type', size: 'size', sha: 'sha256', path: 'path',
  },
  {
    table: 'lawyer_documents', prefix: 'lawyer_documents', provider: 'storage_provider', key: 'storage_key',
    mime: 'mime_type', size: 'size', sha: 'sha256', path: 'path',
  },
]);

function specs(Sequelize, entry) {
  return {
    [entry.provider]: { type: Sequelize.STRING(20), sqlType: 'varchar', length: 20 },
    [entry.key]: { type: Sequelize.STRING(1024), sqlType: 'varchar', length: 1024 },
    [entry.mime]: { type: Sequelize.STRING(255), sqlType: 'varchar', length: 255 },
    [entry.size]: { type: Sequelize.INTEGER, sqlType: 'integer' },
    [entry.sha]: { type: Sequelize.CHAR(64), sqlType: 'char', length: 64 },
    ...(entry.path ? { [entry.path]: { type: Sequelize.STRING(255), sqlType: 'varchar', length: 255 } } : {}),
  };
}

async function tableExists(sequelize, table) {
  const [[row]] = await sequelize.query(`
    SELECT to_regclass(format('%I.%I', current_schema(), :table)) IS NOT NULL AS exists
  `, { replacements: { table } });
  return row.exists;
}

async function columnInfo(sequelize, table, column, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT data_type, character_maximum_length, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column
  `, { replacements: { table, column }, transaction });
  return row || null;
}

function compatibleColumn(info, spec) {
  if (spec.sqlType === 'integer') return info.data_type === 'integer';
  if (!['character varying', 'character'].includes(info.data_type)) return false;
  return Number(info.character_maximum_length) <= spec.length;
}

function exactColumn(info, spec) {
  if (spec.sqlType === 'integer') return info.data_type === 'integer';
  const expectedType = spec.sqlType === 'char' ? 'character' : 'character varying';
  return info.data_type === expectedType && Number(info.character_maximum_length) === spec.length;
}

async function repairColumns(queryInterface, Sequelize, entry) {
  const sequelize = queryInterface.sequelize;
  return sequelize.transaction(async (transaction) => {
    for (const [column, spec] of Object.entries(specs(Sequelize, entry))) {
      const info = await columnInfo(sequelize, entry.table, column, transaction);
      if (!info) {
        await queryInterface.addColumn(entry.table, column, {
          type: spec.type, allowNull: true,
        }, { transaction });
        continue;
      }
      if (!compatibleColumn(info, spec)) {
        throw new Error(`Incompatible storage column ${entry.table}.${column}`);
      }
      if (!exactColumn(info, spec) || info.is_nullable !== 'YES' || info.column_default !== null) {
        const table = queryInterface.queryGenerator.quoteTable(entry.table);
        const field = queryInterface.queryGenerator.quoteIdentifier(column);
        const targetType = spec.sqlType === 'integer'
          ? 'INTEGER'
          : `${spec.sqlType === 'char' ? 'CHAR' : 'VARCHAR'}(${spec.length})`;
        await sequelize.query(`
          ALTER TABLE ${table}
            ALTER COLUMN ${field} TYPE ${targetType} USING ${field}::${targetType},
            ALTER COLUMN ${field} DROP NOT NULL,
            ALTER COLUMN ${field} DROP DEFAULT
        `, { transaction });
      }
    }
  });
}

async function preflightColumns(queryInterface, Sequelize, entry) {
  for (const [column, spec] of Object.entries(specs(Sequelize, entry))) {
    const info = await columnInfo(queryInterface.sequelize, entry.table, column);
    if (info && !compatibleColumn(info, spec)) {
      throw new Error(`Incompatible storage column ${entry.table}.${column}`);
    }
  }
}

function constraintSpecs(entry) {
  return [
    {
      name: `${entry.prefix}_storage_pair_valid`,
      expression: `((${entry.key} IS NULL AND ${entry.provider} IS NULL) OR (`
        + `${entry.key} IS NOT NULL AND ${entry.provider} IS NOT NULL `
        + `AND ${entry.mime} IS NOT NULL AND btrim(${entry.mime}) <> '' `
        + `AND ${entry.size} IS NOT NULL AND ${entry.size} >= 0 `
        + `AND ${entry.sha} IS NOT NULL AND ${entry.sha} ~ '^[0-9a-f]{64}$'))`,
    },
    {
      name: `${entry.prefix}_storage_provider_valid`,
      expression: `(${entry.provider} IS NULL OR ${entry.provider} = ANY (ARRAY['local', 'r2']))`,
    },
    {
      name: `${entry.prefix}_sha256_valid`,
      expression: `(${entry.sha} IS NULL OR ${entry.sha} ~ '^[0-9a-f]{64}$')`,
    },
    {
      name: `${entry.prefix}_size_nonnegative`,
      expression: `(${entry.size} IS NULL OR ${entry.size} >= 0)`,
    },
  ];
}

function normalizeSqlDefinition(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/::(?:character varying|text|bpchar|integer)(?:\[\])?/g, '')
    .replace(/\bcheck\b/g, '')
    .replace(/["\s()]/g, '');
}

async function constraintState(sequelize, table, name) {
  const [[row]] = await sequelize.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition, c.convalidated
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = :table AND c.conname = :name
  `, { replacements: { table, name } });
  return row || null;
}

async function ensureConstraint(queryInterface, entry, spec) {
  const sequelize = queryInterface.sequelize;
  const current = await constraintState(sequelize, entry.table, spec.name);
  const expectedDefinition = normalizeSqlDefinition(`CHECK (${spec.expression})`);
  if (!current || normalizeSqlDefinition(current.definition) !== expectedDefinition) {
    await sequelize.transaction(async (transaction) => {
      const table = queryInterface.queryGenerator.quoteTable(entry.table);
      const name = queryInterface.queryGenerator.quoteIdentifier(spec.name);
      if (current) {
        await sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`, { transaction });
      }
      // ADD NOT VALID takes only the brief catalog lock; validation scans without a long exclusive lock.
      await sequelize.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${spec.expression}) NOT VALID`,
        { transaction }
      );
    });
  }
  const refreshed = await constraintState(sequelize, entry.table, spec.name);
  if (!refreshed.convalidated) {
    await sequelize.query(`
      ALTER TABLE ${queryInterface.queryGenerator.quoteTable(entry.table)}
      VALIDATE CONSTRAINT ${queryInterface.queryGenerator.quoteIdentifier(spec.name)}
    `);
  }
}

async function indexState(sequelize, table, name) {
  const [[row]] = await sequelize.query(`
    SELECT pg_get_indexdef(i.oid) AS definition, ix.indisvalid, ix.indisready,
           n.nspname AS schema_name
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = :table AND i.relname = :name
  `, { replacements: { table, name } });
  return row || null;
}

async function ensureIndex(queryInterface, entry) {
  const sequelize = queryInterface.sequelize;
  const name = `${entry.prefix}_storage_key_unique`;
  const current = await indexState(sequelize, entry.table, name);
  const schemaName = current?.schema_name || (await sequelize.query('SELECT current_schema() AS name'))[0][0].name;
  const expected = normalizeSqlDefinition(
    `CREATE UNIQUE INDEX ${name} ON ${schemaName}.${entry.table} USING btree `
      + `(${entry.provider}, ${entry.key}) WHERE (${entry.key} IS NOT NULL)`
  );
  const exact = current
    && current.indisvalid
    && current.indisready
    && normalizeSqlDefinition(current.definition) === expected;
  if (exact) return;
  const quotedName = queryInterface.queryGenerator.quoteIdentifier(name);
  if (current) await sequelize.query(`DROP INDEX CONCURRENTLY ${quotedName}`);
  // Concurrent creation avoids blocking writes; PostgreSQL still takes brief catalog locks.
  await sequelize.query(`
    CREATE UNIQUE INDEX CONCURRENTLY ${quotedName}
    ON ${queryInterface.queryGenerator.quoteTable(entry.table)} (${entry.provider}, ${entry.key})
    WHERE ${entry.key} IS NOT NULL
  `);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    for (const entry of TABLES) {
      if (!(await tableExists(sequelize, entry.table))) {
        throw new Error(`Required storage table is missing: ${entry.table}`);
      }
    }
    for (const entry of TABLES) await preflightColumns(queryInterface, Sequelize, entry);

    // Each table commits independently, so interruption can restart without replaying one long lock.
    for (const entry of TABLES) await repairColumns(queryInterface, Sequelize, entry);
    for (const entry of TABLES) {
      for (const spec of constraintSpecs(entry)) await ensureConstraint(queryInterface, entry, spec);
    }
    for (const entry of TABLES) await ensureIndex(queryInterface, entry);
  },

  // Storage metadata can already reference persistent objects; rollback must not discard it.
  async down() {},
};
