'use strict';

async function tableExists(sequelize, table, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT to_regclass(format('%I.%I', current_schema(), :table)) IS NOT NULL AS exists
  `, { replacements: { table }, transaction });
  return row.exists;
}

async function hasUniqueColumnIndex(sequelize, table, column, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality)
         ON key.ordinality <= i.indnkeyatts
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
      WHERE n.nspname = current_schema() AND t.relname = :table
        AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL
        AND i.indnkeyatts = 1 AND a.attname = :column
    ) AS exists
  `, { replacements: { table, column }, transaction });
  return row.exists;
}

function requireColumns(table, columns, required) {
  const missing = required.filter((column) => !columns[column]);
  if (missing.length) throw new Error(`Incompatible sync-era ${table}; missing column(s): ${missing.join(', ')}`);
}

function normalizedDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function validateColumns(table, columns, contracts) {
  requireColumns(table, columns, Object.keys(contracts));
  for (const [column, contract] of Object.entries(contracts)) {
    const actual = columns[column];
    if (!contract.type.test(actual.type)) {
      throw new Error(`Incompatible sync-era ${table}.${column} type: ${actual.type}`);
    }
    if (contract.allowNull !== undefined && actual.allowNull !== contract.allowNull) {
      throw new Error(`Incompatible sync-era ${table}.${column} nullability`);
    }
    if (Object.prototype.hasOwnProperty.call(contract, 'defaultValue')
      && normalizedDefault(actual.defaultValue) !== normalizedDefault(contract.defaultValue)) {
      throw new Error(`Incompatible sync-era ${table}.${column} default`);
    }
    if (contract.primaryKey !== undefined && actual.primaryKey !== contract.primaryKey) {
      throw new Error(`Incompatible sync-era ${table}.${column} primary key`);
    }
    if (contract.special && JSON.stringify(actual.special || []) !== JSON.stringify(contract.special)) {
      throw new Error(`Incompatible sync-era ${table}.${column} enum values`);
    }
  }
}

async function assertEnumType(sequelize, table, column, expectedType, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column
  `, { replacements: { table, column }, transaction });
  if (row?.udt_name !== expectedType) {
    throw new Error(`Incompatible sync-era ${table}.${column} enum type`);
  }
}

async function assertNumericShape(sequelize, table, column, precision, scale, transaction) {
  const [[row]] = await sequelize.query(`
    SELECT numeric_precision, numeric_scale FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column
  `, { replacements: { table, column }, transaction });
  if (Number(row?.numeric_precision) !== precision || Number(row?.numeric_scale) !== scale) {
    throw new Error(`Incompatible sync-era ${table}.${column} numeric shape`);
  }
}

async function createPromos(queryInterface, Sequelize, transaction) {
  await queryInterface.createTable('promos', {
    id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
    code: { type: Sequelize.STRING, allowNull: false },
    discount_percent: { type: Sequelize.INTEGER, allowNull: false },
    is_active: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: true },
    expires_at: { type: Sequelize.DATE, allowNull: true },
    usage_limit: { type: Sequelize.INTEGER, allowNull: true },
    used_count: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
    min_amount: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
    created_at: { type: Sequelize.DATE, allowNull: false },
    updated_at: { type: Sequelize.DATE, allowNull: false },
  }, { transaction });
}

async function ensurePromos(queryInterface, Sequelize, transaction) {
  const sequelize = queryInterface.sequelize;
  if (!(await tableExists(sequelize, 'promos', transaction))) {
    await createPromos(queryInterface, Sequelize, transaction);
  } else {
    const columns = await queryInterface.describeTable('promos', { transaction });
    validateColumns('promos', columns, {
      id: { type: /^UUID$/i, allowNull: false, defaultValue: null, primaryKey: true },
      code: { type: /^CHARACTER VARYING\(255\)$/i, allowNull: false, defaultValue: null },
      discount_percent: { type: /^INTEGER$/i, allowNull: false, defaultValue: null },
      is_active: { type: /^BOOLEAN$/i, allowNull: true, defaultValue: true },
      expires_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: true, defaultValue: null },
      usage_limit: { type: /^INTEGER$/i, allowNull: true, defaultValue: null },
      used_count: { type: /^INTEGER$/i, allowNull: true, defaultValue: '0' },
      min_amount: { type: /^INTEGER$/i, allowNull: true, defaultValue: '0' },
      created_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
      updated_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
    });
  }

  const [duplicates] = await sequelize.query(`
    SELECT code FROM promos GROUP BY code HAVING COUNT(*) > 1
  `, { transaction });
  if (duplicates.length) throw new Error(`Cannot bridge promos: ${duplicates.length} duplicate code(s)`);
  if (!(await hasUniqueColumnIndex(sequelize, 'promos', 'code', transaction))) {
    await queryInterface.addIndex('promos', ['code'], {
      name: 'promos_code_unique', unique: true, transaction,
    });
  }
}

async function createWithdrawals(queryInterface, Sequelize, transaction) {
  await queryInterface.createTable('withdrawals', {
    id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
    amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
    status: {
      type: Sequelize.ENUM('pending', 'paid', 'failed', 'cancelled'),
      allowNull: true,
      defaultValue: 'pending',
    },
    provider: { type: Sequelize.STRING, allowNull: true, defaultValue: 'manual' },
    note: { type: Sequelize.TEXT, allowNull: true },
    lawyer_id: { type: Sequelize.UUID, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false },
    updated_at: { type: Sequelize.DATE, allowNull: false },
  }, { transaction });
}

async function foreignKeysFor(sequelize, table, column, transaction) {
  const [rows] = await sequelize.query(`
    SELECT c.conname, target.relname AS target_table, target_column.attname AS target_column,
           c.confupdtype AS on_update, c.confdeltype AS on_delete
    FROM pg_constraint c
    JOIN pg_class source ON source.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = source.relnamespace
    JOIN pg_attribute source_column
      ON source_column.attrelid = source.oid AND source_column.attnum = ANY(c.conkey)
    JOIN pg_class target ON target.oid = c.confrelid
    JOIN pg_attribute target_column
      ON target_column.attrelid = target.oid AND target_column.attnum = ANY(c.confkey)
    WHERE n.nspname = current_schema() AND c.contype = 'f'
      AND source.relname = :table AND source_column.attname = :column
  `, { replacements: { table, column }, transaction });
  return rows;
}

async function ensureWithdrawals(queryInterface, Sequelize, transaction) {
  const sequelize = queryInterface.sequelize;
  if (!(await tableExists(sequelize, 'withdrawals', transaction))) {
    await createWithdrawals(queryInterface, Sequelize, transaction);
  } else {
    const columns = await queryInterface.describeTable('withdrawals', { transaction });
    validateColumns('withdrawals', columns, {
      id: { type: /^UUID$/i, allowNull: false, defaultValue: null, primaryKey: true },
      amount: { type: /^NUMERIC$/i, allowNull: false, defaultValue: null },
      status: {
        type: /^USER-DEFINED$/i,
        allowNull: true,
        defaultValue: 'pending',
        special: ['pending', 'paid', 'failed', 'cancelled'],
      },
      provider: { type: /^CHARACTER VARYING\(255\)$/i, allowNull: true, defaultValue: 'manual' },
      note: { type: /^TEXT$/i, allowNull: true, defaultValue: null },
      lawyer_id: { type: /^UUID$/i, allowNull: true, defaultValue: null },
      created_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
      updated_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
    });
    await assertEnumType(sequelize, 'withdrawals', 'status', 'enum_withdrawals_status', transaction);
    await assertNumericShape(sequelize, 'withdrawals', 'amount', 12, 2, transaction);
  }

  const [orphans] = await sequelize.query(`
    SELECT w.id FROM withdrawals w
    LEFT JOIN users u ON u.id = w.lawyer_id
    WHERE w.lawyer_id IS NOT NULL AND u.id IS NULL
    LIMIT 1
  `, { transaction });
  if (orphans.length) throw new Error('Cannot bridge withdrawals: orphaned lawyer_id');
  const keys = await foreignKeysFor(sequelize, 'withdrawals', 'lawyer_id', transaction);
  if (keys.length > 1 || keys.some((key) => key.target_table !== 'users'
    || key.target_column !== 'id' || key.on_update !== 'c' || key.on_delete !== 'n')) {
    throw new Error('Incompatible sync-era withdrawals lawyer foreign key');
  }
  if (keys.length === 0) {
    await queryInterface.addConstraint('withdrawals', {
      fields: ['lawyer_id'],
      type: 'foreign key',
      name: 'withdrawals_lawyer_id_fkey',
      references: { table: 'users', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
      transaction,
    });
  }
}

async function createPushSubscriptions(queryInterface, Sequelize, transaction) {
  await queryInterface.createTable('push_subscriptions', {
    id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
    user_id: { type: Sequelize.UUID, allowNull: false },
    endpoint: { type: Sequelize.TEXT, allowNull: false },
    keys: { type: Sequelize.JSONB, allowNull: false },
    created_at: { type: Sequelize.DATE, allowNull: false },
    updated_at: { type: Sequelize.DATE, allowNull: false },
  }, { transaction });
}

async function repairPushColumns(queryInterface, Sequelize, transaction) {
  const sequelize = queryInterface.sequelize;
  if (!(await tableExists(sequelize, 'push_subscriptions', transaction))) {
    await createPushSubscriptions(queryInterface, Sequelize, transaction);
  }
  await sequelize.query('LOCK TABLE push_subscriptions IN ACCESS EXCLUSIVE MODE', { transaction });
  let columns = await queryInterface.describeTable('push_subscriptions', { transaction });
  validateColumns('push_subscriptions', columns, {
    id: { type: /^UUID$/i, allowNull: false, defaultValue: null, primaryKey: true },
    endpoint: { type: /^TEXT$/i, allowNull: false, defaultValue: null },
    keys: { type: /^JSONB$/i, allowNull: false, defaultValue: null },
  });

  const pairs = [
    ['user_id', 'userId'],
    ['created_at', 'createdAt'],
    ['updated_at', 'updatedAt'],
  ];
  for (const [snake, camel] of pairs) {
    if (!columns[snake] && !columns[camel]) {
      throw new Error(`Incompatible push_subscriptions; missing ${snake}/${camel}`);
    }
    const expectedType = snake === 'user_id' ? /^UUID$/i : /^TIMESTAMP WITH TIME ZONE$/i;
    for (const present of [snake, camel].filter((column) => columns[column])) {
      if (!expectedType.test(columns[present].type)) {
        throw new Error(`Incompatible push_subscriptions.${present} type: ${columns[present].type}`);
      }
      if (!columns[snake] && columns[present].allowNull) {
        throw new Error(`Incompatible push_subscriptions.${present} nullability`);
      }
    }
  }

  for (const [snake, camel] of pairs) {
    if (columns[snake] && columns[camel]) {
      const quotedSnake = queryInterface.queryGenerator.quoteIdentifier(snake);
      const quotedCamel = queryInterface.queryGenerator.quoteIdentifier(camel);
      const [[conflict]] = await sequelize.query(`
        SELECT EXISTS (
          SELECT 1 FROM push_subscriptions
          WHERE ${quotedSnake} IS NOT NULL AND ${quotedCamel} IS NOT NULL
            AND ${quotedSnake} IS DISTINCT FROM ${quotedCamel}
        ) AS exists
      `, { transaction });
      if (conflict.exists) throw new Error(`Push subscription column conflict: ${snake}/${camel}`);
    }
  }

  for (const [snake, camel] of pairs) {
    if (!columns[snake]) {
      await queryInterface.renameColumn('push_subscriptions', camel, snake, { transaction });
    } else if (columns[camel]) {
      const quotedSnake = queryInterface.queryGenerator.quoteIdentifier(snake);
      const quotedCamel = queryInterface.queryGenerator.quoteIdentifier(camel);
      await sequelize.query(`
        UPDATE push_subscriptions SET ${quotedSnake} = COALESCE(${quotedSnake}, ${quotedCamel})
      `, { transaction });
      await queryInterface.removeColumn('push_subscriptions', camel, { transaction });
    }
    columns = await queryInterface.describeTable('push_subscriptions', { transaction });
  }

  const [orphans] = await sequelize.query(`
    SELECT p.id FROM push_subscriptions p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE u.id IS NULL LIMIT 1
  `, { transaction });
  if (orphans.length) throw new Error('Cannot bridge push subscriptions: orphaned user_id');
  await sequelize.query(`
    ALTER TABLE push_subscriptions
      ALTER COLUMN user_id SET NOT NULL,
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET NOT NULL
  `, { transaction });

  columns = await queryInterface.describeTable('push_subscriptions', { transaction });
  validateColumns('push_subscriptions', columns, {
    id: { type: /^UUID$/i, allowNull: false, defaultValue: null, primaryKey: true },
    user_id: { type: /^UUID$/i, allowNull: false, defaultValue: null },
    endpoint: { type: /^TEXT$/i, allowNull: false, defaultValue: null },
    keys: { type: /^JSONB$/i, allowNull: false, defaultValue: null },
    created_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
    updated_at: { type: /^TIMESTAMP WITH TIME ZONE$/i, allowNull: false, defaultValue: null },
  });

  const keys = await foreignKeysFor(sequelize, 'push_subscriptions', 'user_id', transaction);
  if (keys.length > 1 || keys.some((key) => key.target_table !== 'users'
    || key.target_column !== 'id' || key.on_update !== 'c' || key.on_delete !== 'c')) {
    throw new Error('Incompatible push_subscriptions user foreign key');
  }
  if (keys.length === 0) {
    await queryInterface.addConstraint('push_subscriptions', {
      fields: ['user_id'], type: 'foreign key', name: 'push_subscriptions_user_id_fkey',
      references: { table: 'users', field: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE', transaction,
    });
  }

  const [duplicates] = await sequelize.query(`
    SELECT endpoint FROM push_subscriptions GROUP BY endpoint HAVING COUNT(*) > 1
  `, { transaction });
  if (duplicates.length) throw new Error('Cannot bridge push subscriptions: duplicate endpoint');
  if (!(await hasUniqueColumnIndex(sequelize, 'push_subscriptions', 'endpoint', transaction))) {
    await queryInterface.addIndex('push_subscriptions', ['endpoint'], {
      name: 'push_subscriptions_endpoint_unique', unique: true, transaction,
    });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await ensurePromos(queryInterface, Sequelize, transaction);
      await ensureWithdrawals(queryInterface, Sequelize, transaction);
      await repairPushColumns(queryInterface, Sequelize, transaction);
    });
  },

  async down() {
    // Monotonic bridge: sync-era data and repaired column names are not safely reversible.
  },
};
