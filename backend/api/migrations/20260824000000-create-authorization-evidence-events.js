'use strict';

const TABLE = 'authorization_evidence_events';
const INDEXES = [
  ['authorization_evidence_events_deployment_time_idx', ['deployment_id', 'observed_at']],
  ['authorization_evidence_events_surface_mode_time_idx', ['surface', 'mode', 'observed_at']],
];

function definitions(Sequelize) {
  return {
    event_id: { type: Sequelize.STRING(160), primaryKey: true, allowNull: false },
    schema_version: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 1 },
    type: { type: Sequelize.STRING(16), allowNull: false },
    observed_at: { type: Sequelize.DATE, allowNull: false },
    commit_sha: { type: Sequelize.CHAR(40), allowNull: false },
    deployment_id: { type: Sequelize.STRING(160), allowNull: false },
    service_id: { type: Sequelize.STRING(160), allowNull: false },
    config_digest: { type: Sequelize.CHAR(64), allowNull: false },
    migration_head: { type: Sequelize.STRING(255), allowNull: false },
    authorization_mode: { type: Sequelize.STRING(24), allowNull: false },
    channel: { type: Sequelize.STRING(16), allowNull: true },
    surface: { type: Sequelize.STRING(160), allowNull: true },
    mode: { type: Sequelize.STRING(16), allowNull: true },
    legacy_allowed: { type: Sequelize.BOOLEAN, allowNull: true },
    capability_allowed: { type: Sequelize.BOOLEAN, allowNull: true },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
    },
  };
}

const CONTRACTS = {
  event_id: { type: /^CHARACTER VARYING\(160\)$/i, allowNull: false, defaultValue: null },
  schema_version: { type: /^SMALLINT$/i, allowNull: false, defaultValue: /^1(?::smallint)?$/i },
  type: { type: /^CHARACTER VARYING\(16\)$/i, allowNull: false, defaultValue: null },
  observed_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
  commit_sha: { type: /^CHARACTER\(40\)$/i, allowNull: false, defaultValue: null },
  deployment_id: { type: /^CHARACTER VARYING\(160\)$/i, allowNull: false, defaultValue: null },
  service_id: { type: /^CHARACTER VARYING\(160\)$/i, allowNull: false, defaultValue: null },
  config_digest: { type: /^CHARACTER\(64\)$/i, allowNull: false, defaultValue: null },
  migration_head: { type: /^CHARACTER VARYING\(255\)$/i, allowNull: false, defaultValue: null },
  authorization_mode: { type: /^CHARACTER VARYING\(24\)$/i, allowNull: false, defaultValue: null },
  channel: { type: /^CHARACTER VARYING\(16\)$/i, allowNull: true, defaultValue: null },
  surface: { type: /^CHARACTER VARYING\(160\)$/i, allowNull: true, defaultValue: null },
  mode: { type: /^CHARACTER VARYING\(16\)$/i, allowNull: true, defaultValue: null },
  legacy_allowed: { type: /^BOOLEAN$/i, allowNull: true, defaultValue: null },
  capability_allowed: { type: /^BOOLEAN$/i, allowNull: true, defaultValue: null },
  created_at: {
    type: /^TIMESTAMP WITH TIME ZONE$/i,
    allowNull: false,
    defaultValue: /^(CURRENT_TIMESTAMP|now\(\))$/i,
  },
};

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/^'(.*)'::[a-z_ ]+$/i, '$1').replace(/[()]/g, (match) => match);
}

function defaultMatches(contract, actualDefault) {
  if (contract.defaultValue instanceof RegExp) return contract.defaultValue.test(actualDefault || '');
  return actualDefault === contract.defaultValue;
}

function validateColumn(name, actual, { checkDefault = true } = {}) {
  const contract = CONTRACTS[name];
  if (!contract.type.test(actual.type)) throw new Error(`Incompatible ${TABLE}.${name} type`);
  if (actual.allowNull !== contract.allowNull) throw new Error(`Incompatible ${TABLE}.${name} nullability`);
  if (!checkDefault) return;
  const actualDefault = normalizeDefault(actual.defaultValue);
  if (!defaultMatches(contract, actualDefault)) {
    throw new Error(`Incompatible ${TABLE}.${name} default`);
  }
}

async function primaryKeyColumns(sequelize, transaction) {
  const [rows] = await sequelize.query(`
    SELECT array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
    FROM pg_constraint constraint_record
    JOIN pg_class source ON source.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY key(attnum, ordinality) ON true
    JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
    WHERE namespace.nspname = current_schema() AND source.relname = :table
      AND constraint_record.contype = 'p'
    GROUP BY constraint_record.oid
  `, { replacements: { table: TABLE }, transaction });
  return rows.map((row) => row.columns);
}

async function ensurePrimaryKey(queryInterface, transaction) {
  const sequelize = queryInterface.sequelize;
  const keys = await primaryKeyColumns(sequelize, transaction);
  if (keys.length > 1 || (keys.length === 1 && JSON.stringify(keys[0]) !== JSON.stringify(['event_id']))) {
    throw new Error(`Incompatible ${TABLE} primary key`);
  }
  if (keys.length === 1) return;
  const [[unsafe]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1 FROM ${TABLE} WHERE event_id IS NULL
      UNION ALL
      SELECT 1 FROM ${TABLE} GROUP BY event_id HAVING COUNT(*) > 1
    ) AS exists
  `, { transaction });
  if (unsafe.exists) throw new Error(`Cannot repair ${TABLE} primary key safely`);
  await queryInterface.addConstraint(TABLE, {
    fields: ['event_id'], type: 'primary key', name: 'authorization_evidence_events_pkey', transaction,
  });
}

async function indexContract(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT index.indisunique, index.indisvalid, index.indisready,
           index.indpred IS NULL AS unconditional,
           index.indnkeyatts = index.indnatts AS no_includes,
           access_method.amname AS method,
           array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
    FROM pg_index index
    JOIN pg_class source ON source.oid = index.indrelid
    JOIN pg_class index_class ON index_class.oid = index.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN pg_am access_method ON access_method.oid = index_class.relam
    JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, ordinality)
      ON key.ordinality <= index.indnkeyatts
    JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
    WHERE namespace.nspname = current_schema() AND source.relname = :table
      AND index_class.relname = :name
    GROUP BY index.indexrelid, index.indisunique, index.indisvalid, index.indisready,
      index.indpred, index.indnkeyatts, index.indnatts, access_method.amname
  `, { replacements: { table: TABLE, name }, transaction });
  return rows[0] || null;
}

async function ensureIndexes(queryInterface, transaction) {
  const sequelize = queryInterface.sequelize;
  for (const [name, fields] of INDEXES) {
    const actual = await indexContract(sequelize, name, transaction);
    const exact = actual && !actual.indisunique && actual.indisvalid && actual.indisready
      && actual.unconditional && actual.no_includes && actual.method === 'btree'
      && JSON.stringify(actual.columns) === JSON.stringify(fields);
    if (actual && !exact) {
      await queryInterface.removeIndex(TABLE, name, { transaction });
    }
    if (!exact) await queryInterface.addIndex(TABLE, fields, { name, transaction });
  }
}

async function repairExisting(queryInterface, Sequelize, transaction) {
  const sequelize = queryInterface.sequelize;
  await sequelize.query(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`, { transaction });
  let columns = await queryInterface.describeTable(TABLE, { transaction });
  for (const [name, actual] of Object.entries(columns)) {
    if (!CONTRACTS[name]) throw new Error(`Incompatible ${TABLE}; unexpected column ${name}`);
    validateColumn(name, actual, { checkDefault: false });
  }

  const [[count]] = await sequelize.query(`SELECT COUNT(*)::integer AS count FROM ${TABLE}`, { transaction });
  const defs = definitions(Sequelize);
  for (const name of Object.keys(CONTRACTS)) {
    if (columns[name]) continue;
    const definition = defs[name];
    const hasSafeDefault = Object.prototype.hasOwnProperty.call(definition, 'defaultValue');
    if (count.count > 0 && definition.allowNull === false && !hasSafeDefault) {
      throw new Error(`Cannot repair populated ${TABLE}; required column ${name} is missing`);
    }
    await queryInterface.addColumn(TABLE, name, definition, { transaction });
  }

  columns = await queryInterface.describeTable(TABLE, { transaction });
  for (const [name, actual] of Object.entries(columns)) {
    const actualDefault = normalizeDefault(actual.defaultValue);
    if (!defaultMatches(CONTRACTS[name], actualDefault)) {
      await queryInterface.changeColumn(TABLE, name, defs[name], { transaction });
    }
  }

  columns = await queryInterface.describeTable(TABLE, { transaction });
  for (const [name, contract] of Object.entries(CONTRACTS)) {
    if (!columns[name]) throw new Error(`Incompatible ${TABLE}; missing column ${name}`);
    validateColumn(name, columns[name], contract);
  }
  await ensurePrimaryKey(queryInterface, transaction);
  await ensureIndexes(queryInterface, transaction);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const tables = await queryInterface.showAllTables({ transaction });
      const names = tables.map((table) => typeof table === 'string' ? table : table.tableName || table.table_name);
      if (!names.includes(TABLE)) {
        await queryInterface.createTable(TABLE, definitions(Sequelize), { transaction });
        await ensureIndexes(queryInterface, transaction);
        return;
      }
      await repairExisting(queryInterface, Sequelize, transaction);
    });
  },

  // Evidence is retained through the rollback release. Destructive rollback is intentionally forbidden.
  async down() {},
};
