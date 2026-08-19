'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const [[row]] = await queryInterface.sequelize.query(`
    SELECT to_regclass(format('%I.%I', current_schema(), :tableName)) IS NOT NULL AS exists
  `, { replacements: { tableName }, transaction });
  return row.exists;
}

async function hasIndex(sequelize, tableName, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = :tableName
      AND i.relname = :name
  `, { replacements: { tableName, name }, transaction });
  return rows.length > 0;
}

async function getIndexState(sequelize, tableName, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT pg_get_indexdef(i.oid) AS definition, ix.indisvalid, ix.indisready,
           n.nspname AS schema_name
    FROM pg_catalog.pg_class i
    JOIN pg_catalog.pg_index ix ON ix.indexrelid = i.oid
    JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = :tableName
      AND i.relname = :name
  `, { replacements: { tableName, name }, transaction });
  return rows[0] || null;
}

async function hasConstraint(sequelize, tableName, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname = :tableName
      AND c.conname = :name
  `, { replacements: { tableName, name }, transaction });
  return rows.length > 0;
}

async function getConstraintDefinition(sequelize, tableName, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = :tableName AND c.conname = :name
  `, { replacements: { tableName, name }, transaction });
  return rows[0]?.definition || null;
}

async function hasPrimaryKey(sequelize, tableName, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'p'
      AND n.nspname = current_schema()
      AND t.relname = :tableName
  `, { replacements: { tableName }, transaction });
  return rows.length > 0;
}

function columns(Sequelize) {
  return {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.literal('gen_random_uuid()'),
    },
    storage_key: { type: Sequelize.STRING(1024), allowNull: false },
    provider: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'r2' },
    attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    last_error: { type: Sequelize.STRING(255), allowNull: true },
    status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
    next_attempt_at: { type: Sequelize.DATE, allowNull: true, defaultValue: Sequelize.fn('NOW') },
    lease_token: { type: Sequelize.UUID, allowNull: true },
    lease_expires_at: { type: Sequelize.DATE, allowNull: true },
    requires_ownership_proof: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    ownership_token: { type: Sequelize.UUID, allowNull: true },
    ownership_metadata: { type: Sequelize.JSONB, allowNull: true },
    prevents_key_reuse: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
  };
}

function normalizeSqlDefinition(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/::(?:character varying|text|bpchar|integer|boolean)(?:\[\])?/g, '')
    .replace(/\bcheck\b/g, '')
    .replace(/["\s()]/g, '');
}

async function ensureConstraint(sequelize, queryInterface, tableName, name, expression, transaction) {
  const current = await getConstraintDefinition(sequelize, tableName, name, transaction);
  const expected = normalizeSqlDefinition(`CHECK (${expression})`);
  if (current && normalizeSqlDefinition(current) !== expected) {
    await queryInterface.removeConstraint(tableName, name, { transaction });
  }
  if (!current || normalizeSqlDefinition(current) !== expected) {
    await sequelize.query(`
      ALTER TABLE ${queryInterface.queryGenerator.quoteTable(tableName)}
      ADD CONSTRAINT ${queryInterface.queryGenerator.quoteIdentifier(name)} CHECK (${expression})
    `, { transaction });
  }
}

function normalizedIndexDefinition({ name, schemaName, tableName, unique = false, fields, where }) {
  return normalizeSqlDefinition(
    `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${schemaName}.${tableName} USING btree `
      + `(${fields.join(', ')})${where ? ` WHERE (${where})` : ''}`
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      const definitions = columns(Sequelize);
      const exists = await tableExists(queryInterface, 'object_cleanup_tasks', transaction);

      if (!exists) {
        await queryInterface.createTable('object_cleanup_tasks', definitions, { transaction });
      } else {
        const existing = await queryInterface.describeTable('object_cleanup_tasks', { transaction });
        const missing = Object.keys(definitions).filter((name) => !existing[name]);
        if (missing.length) {
          const [[row]] = await sequelize.query(
            'SELECT COUNT(*)::integer AS count FROM object_cleanup_tasks',
            { transaction }
          );
          const safeUpgradeColumns = new Set([
            'next_attempt_at', 'lease_token', 'lease_expires_at',
            'requires_ownership_proof', 'ownership_token', 'ownership_metadata',
            'prevents_key_reuse',
          ]);
          const safePopulatedUpgrade = missing.every((name) => safeUpgradeColumns.has(name));
          if (row.count > 0 && !safePopulatedUpgrade) {
            throw new Error(
              `Cannot repair populated object_cleanup_tasks (${row.count} row(s)); missing columns: ${missing.join(', ')}`
            );
          }
          if (row.count > 0) {
            for (const name of missing) {
              await queryInterface.addColumn('object_cleanup_tasks', name, definitions[name], { transaction });
            }
          } else {
            await queryInterface.dropTable('object_cleanup_tasks', { transaction });
            await queryInterface.createTable('object_cleanup_tasks', definitions, { transaction });
          }
        }
      }

      if (!(await hasPrimaryKey(sequelize, 'object_cleanup_tasks', transaction))) {
        await queryInterface.addConstraint('object_cleanup_tasks', {
          fields: ['id'], type: 'primary key', name: 'object_cleanup_tasks_pkey', transaction,
        });
      }
      await ensureConstraint(
        sequelize, queryInterface, 'object_cleanup_tasks', 'object_cleanup_tasks_status_valid',
        "status = ANY (ARRAY['reserved', 'pending', 'processing', 'completed', 'failed', 'manual_review'])", transaction
      );
      await sequelize.query(`
        UPDATE object_cleanup_tasks
        SET requires_ownership_proof = true,
            ownership_token = COALESCE(ownership_token, id)
        WHERE (ownership_token IS NOT NULL OR ownership_metadata IS NOT NULL)
          AND (requires_ownership_proof = false OR ownership_token IS NULL)
      `, { transaction });
      await sequelize.query(`
        UPDATE object_cleanup_tasks
        SET status = 'manual_review',
            last_error = 'OWNERSHIP_PROOF_MISSING',
            next_attempt_at = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            prevents_key_reuse = true
        WHERE status = ANY (ARRAY['reserved', 'pending', 'processing'])
          AND (requires_ownership_proof = false OR ownership_token IS NULL
            OR (provider = 'local' AND (
              ownership_metadata IS NULL
              OR ownership_metadata->>'expectedPath' IS DISTINCT FROM storage_key
              OR COALESCE(ownership_metadata->>'sha256', '') !~ '^[0-9a-f]{64}$'
              OR COALESCE(ownership_metadata->>'size', '') !~ '^[0-9]+$'
            )))
      `, { transaction });
      await sequelize.query(`
        UPDATE object_cleanup_tasks
        SET prevents_key_reuse = true
        WHERE status = ANY (ARRAY['reserved', 'pending', 'processing'])
      `, { transaction });
      await ensureConstraint(
        sequelize, queryInterface, 'object_cleanup_tasks', 'object_cleanup_tasks_attempts_nonnegative',
        'attempts >= 0', transaction
      );
      await ensureConstraint(
        sequelize, queryInterface, 'object_cleanup_tasks', 'object_cleanup_tasks_provider_valid',
        "provider = ANY (ARRAY['r2', 'local'])", transaction
      );
      await ensureConstraint(
        sequelize, queryInterface, 'object_cleanup_tasks', 'object_cleanup_tasks_ownership_valid',
        `((requires_ownership_proof = false AND ownership_token IS NULL AND ownership_metadata IS NULL)
          OR (requires_ownership_proof = true AND ownership_token IS NOT NULL))`,
        transaction
      );

      const activeIndex = await getIndexState(
        sequelize, 'object_cleanup_tasks', 'object_cleanup_tasks_active_key_unique', transaction
      );
      const activeExpected = activeIndex && normalizedIndexDefinition({
        name: 'object_cleanup_tasks_active_key_unique',
        schemaName: activeIndex.schema_name,
        tableName: 'object_cleanup_tasks',
        unique: true,
        fields: ['provider', 'storage_key'],
        where: "status = ANY (ARRAY['reserved', 'pending', 'processing'])",
      });
      const activeExact = activeIndex && activeIndex.indisvalid && activeIndex.indisready
        && normalizeSqlDefinition(activeIndex.definition) === activeExpected;
      if (activeIndex && !activeExact) {
        await queryInterface.removeIndex(
          'object_cleanup_tasks', 'object_cleanup_tasks_active_key_unique', { transaction }
        );
      }
      if (!activeExact) {
        await sequelize.query(`
          CREATE UNIQUE INDEX object_cleanup_tasks_active_key_unique
          ON object_cleanup_tasks (provider, storage_key)
          WHERE status = ANY (ARRAY['reserved', 'pending', 'processing'])
        `, { transaction });
      }
      const dueIndex = await getIndexState(
        sequelize, 'object_cleanup_tasks', 'object_cleanup_tasks_due_idx', transaction
      );
      const dueExpected = dueIndex && normalizedIndexDefinition({
        name: 'object_cleanup_tasks_due_idx',
        schemaName: dueIndex.schema_name,
        tableName: 'object_cleanup_tasks',
        fields: ['status', 'next_attempt_at', 'lease_expires_at', 'created_at'],
      });
      const dueExact = dueIndex && dueIndex.indisvalid && dueIndex.indisready
        && normalizeSqlDefinition(dueIndex.definition) === dueExpected;
      if (dueIndex && !dueExact) {
        await queryInterface.removeIndex(
          'object_cleanup_tasks', 'object_cleanup_tasks_due_idx', { transaction }
        );
      }
      if (!dueExact) {
        await queryInterface.addIndex('object_cleanup_tasks', [
          'status', 'next_attempt_at', 'lease_expires_at', 'created_at',
        ], {
          name: 'object_cleanup_tasks_due_idx', transaction,
        });
      }
      const tombstoneIndex = await getIndexState(
        sequelize, 'object_cleanup_tasks', 'object_cleanup_tasks_tombstone_unique', transaction
      );
      const tombstoneExpected = tombstoneIndex && normalizedIndexDefinition({
        name: 'object_cleanup_tasks_tombstone_unique',
        schemaName: tombstoneIndex.schema_name,
        tableName: 'object_cleanup_tasks',
        unique: true,
        fields: ['provider', 'storage_key'],
        where: 'prevents_key_reuse = true',
      });
      const tombstoneExact = tombstoneIndex && tombstoneIndex.indisvalid && tombstoneIndex.indisready
        && normalizeSqlDefinition(tombstoneIndex.definition) === tombstoneExpected;
      if (tombstoneIndex && !tombstoneExact) {
        await queryInterface.removeIndex(
          'object_cleanup_tasks', 'object_cleanup_tasks_tombstone_unique', { transaction }
        );
      }
      if (!tombstoneExact) {
        await sequelize.query(`
          CREATE UNIQUE INDEX object_cleanup_tasks_tombstone_unique
          ON object_cleanup_tasks (provider, storage_key)
          WHERE prevents_key_reuse = true
        `, { transaction });
      }
    });
  },

  // Cleanup work is durable operational state; rollback must not delete it.
  async down() {},
};
