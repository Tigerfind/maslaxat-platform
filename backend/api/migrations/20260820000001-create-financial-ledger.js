'use strict';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.map((table) => typeof table === 'string' ? table : table.tableName).includes(tableName);
}

async function ensureColumn(queryInterface, tableName, columnName, definition, transaction) {
  const table = await queryInterface.describeTable(tableName, { transaction });
  if (!table[columnName]) await queryInterface.addColumn(tableName, columnName, definition, { transaction });
}

async function hasConstraint(sequelize, name, transaction) {
  const [rows] = await sequelize.query('SELECT 1 FROM pg_constraint WHERE conname = :name', {
    replacements: { name }, transaction,
  });
  return rows.length > 0;
}

async function hasForeignKey(sequelize, tableName, columnName, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f' AND t.relname = :tableName AND a.attname = :columnName
  `, { replacements: { tableName, columnName }, transaction });
  return rows.length > 0;
}

async function hasIndex(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      if (!(await tableExists(queryInterface, 'platform_settings', transaction))) {
        await queryInterface.createTable('platform_settings', {
          key: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
          value: { type: Sequelize.STRING, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }
      if (!(await tableExists(queryInterface, 'platform_setting_audits', transaction))) {
        await queryInterface.createTable('platform_setting_audits', {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
          key: { type: Sequelize.STRING, allowNull: false },
          old_value: { type: Sequelize.STRING, allowNull: false },
          new_value: { type: Sequelize.STRING, allowNull: false },
          changed_by_user_id: { type: Sequelize.UUID, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }
      if (!(await tableExists(queryInterface, 'financial_transactions', transaction))) {
        await queryInterface.createTable('financial_transactions', {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
          operation_key: { type: Sequelize.STRING, allowNull: false },
          payment_id: { type: Sequelize.UUID, allowNull: true },
          reason: { type: Sequelize.STRING, allowNull: false },
          currency: { type: Sequelize.STRING(3), allowNull: false },
          metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
          posted_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          is_posted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          posting_token: { type: Sequelize.UUID, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }
      if (!(await tableExists(queryInterface, 'financial_entries', transaction))) {
        await queryInterface.createTable('financial_entries', {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
          financial_transaction_id: { type: Sequelize.UUID, allowNull: false },
          posting_token: { type: Sequelize.UUID, allowNull: true },
          account: { type: Sequelize.STRING, allowNull: false },
          direction: { type: Sequelize.ENUM('debit', 'credit'), allowNull: false },
          amount_tiyin: { type: Sequelize.BIGINT, allowNull: false },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }

      await ensureColumn(queryInterface, 'financial_transactions', 'is_posted', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true,
      }, transaction);
      await ensureColumn(queryInterface, 'financial_transactions', 'posting_token', {
        type: Sequelize.UUID, allowNull: true,
      }, transaction);
      await ensureColumn(queryInterface, 'financial_entries', 'posting_token', {
        type: Sequelize.UUID, allowNull: true,
      }, transaction);

      if (!(await hasForeignKey(sequelize, 'platform_setting_audits', 'changed_by_user_id', transaction))) {
        await queryInterface.addConstraint('platform_setting_audits', {
          fields: ['changed_by_user_id'], type: 'foreign key', name: 'platform_setting_audits_changed_by_fk',
          references: { table: 'users', field: 'id' }, onDelete: 'RESTRICT', transaction,
        });
      }
      if (!(await hasForeignKey(sequelize, 'financial_transactions', 'payment_id', transaction))) {
        await queryInterface.addConstraint('financial_transactions', {
          fields: ['payment_id'], type: 'foreign key', name: 'financial_transactions_payment_fk',
          references: { table: 'payments', field: 'id' }, onDelete: 'RESTRICT', transaction,
        });
      }
      if (!(await hasForeignKey(sequelize, 'financial_entries', 'financial_transaction_id', transaction))) {
        await queryInterface.addConstraint('financial_entries', {
          fields: ['financial_transaction_id'], type: 'foreign key', name: 'financial_entries_transaction_fk',
          references: { table: 'financial_transactions', field: 'id' }, onDelete: 'RESTRICT', transaction,
        });
      }
      if (!(await hasConstraint(sequelize, 'financial_entries_amount_positive', transaction))) {
        await sequelize.query(`
          ALTER TABLE financial_entries
          ADD CONSTRAINT financial_entries_amount_positive CHECK (amount_tiyin > 0)
        `, { transaction });
      }
      if (!(await hasIndex(sequelize, 'financial_entries_transaction_idx', transaction))) {
        await queryInterface.addIndex('financial_entries', ['financial_transaction_id'], {
          name: 'financial_entries_transaction_idx', transaction,
        });
      }
      if (!(await hasIndex(sequelize, 'financial_transactions_operation_key_unique', transaction))) {
        await queryInterface.addIndex('financial_transactions', ['operation_key'], {
          name: 'financial_transactions_operation_key_unique', unique: true, transaction,
        });
      }

      await sequelize.query(`
        INSERT INTO platform_settings (key, value, created_at, updated_at)
        VALUES ('commission_rate_bps', '1500', NOW(), NOW())
        ON CONFLICT (key) DO NOTHING
      `, { transaction });
      await sequelize.query(`
        CREATE OR REPLACE FUNCTION reject_posted_financial_mutation() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'financial_transactions'
             AND OLD.is_posted = FALSE AND NEW.is_posted = TRUE
             AND OLD.posting_token IS NOT NULL AND NEW.posting_token IS NULL
             AND (to_jsonb(NEW) - 'is_posted' - 'posting_token' - 'updated_at')
                 = (to_jsonb(OLD) - 'is_posted' - 'posting_token' - 'updated_at') THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'posted financial rows are immutable';
        END;
        $$ LANGUAGE plpgsql
      `, { transaction });
      await sequelize.query(`
        CREATE OR REPLACE FUNCTION assert_financial_transaction_balanced() RETURNS trigger AS $$
        DECLARE target_id uuid;
        DECLARE debit_total numeric;
        DECLARE credit_total numeric;
        DECLARE posted boolean;
        BEGIN
          target_id := CASE
            WHEN TG_TABLE_NAME = 'financial_transactions' THEN NEW.id
            ELSE (to_jsonb(NEW)->>'financial_transaction_id')::uuid
          END;
          SELECT COALESCE(SUM(amount_tiyin) FILTER (WHERE direction = 'debit'), 0),
                 COALESCE(SUM(amount_tiyin) FILTER (WHERE direction = 'credit'), 0)
            INTO debit_total, credit_total
            FROM financial_entries WHERE financial_transaction_id = target_id;
          SELECT is_posted INTO posted FROM financial_transactions WHERE id = target_id;
          IF posted IS NOT TRUE OR debit_total = 0 OR debit_total <> credit_total THEN
            RAISE EXCEPTION 'financial transaction % must be finalized and balanced', target_id;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `, { transaction });
      await sequelize.query(`
        CREATE OR REPLACE FUNCTION assert_financial_entry_insertable() RETURNS trigger AS $$
        BEGIN
          PERFORM 1 FROM financial_transactions
          WHERE id = NEW.financial_transaction_id
            AND is_posted = FALSE
            AND posting_token IS NOT NULL
            AND posting_token = NEW.posting_token;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'posted financial rows are immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `, { transaction });

      for (const table of ['financial_transactions', 'financial_entries']) {
        await sequelize.query(`DROP TRIGGER IF EXISTS ${table}_immutable ON ${table}`, { transaction });
        await sequelize.query(`
          CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
          FOR EACH ROW EXECUTE FUNCTION reject_posted_financial_mutation()
        `, { transaction });
      }
      await sequelize.query('DROP TRIGGER IF EXISTS financial_entries_insertable ON financial_entries', { transaction });
      await sequelize.query(`
        CREATE TRIGGER financial_entries_insertable BEFORE INSERT ON financial_entries
        FOR EACH ROW EXECUTE FUNCTION assert_financial_entry_insertable()
      `, { transaction });
      await sequelize.query('DROP TRIGGER IF EXISTS financial_transactions_balanced ON financial_transactions', { transaction });
      await sequelize.query(`
        CREATE CONSTRAINT TRIGGER financial_transactions_balanced
        AFTER INSERT OR UPDATE OF is_posted ON financial_transactions DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION assert_financial_transaction_balanced()
      `, { transaction });
      await sequelize.query('DROP TRIGGER IF EXISTS financial_entries_balanced ON financial_entries', { transaction });
      await sequelize.query(`
        CREATE CONSTRAINT TRIGGER financial_entries_balanced
        AFTER INSERT ON financial_entries DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION assert_financial_transaction_balanced()
      `, { transaction });
    });
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      await sequelize.query('DROP FUNCTION IF EXISTS assert_financial_entry_insertable() CASCADE', { transaction });
      await sequelize.query('DROP FUNCTION IF EXISTS assert_financial_transaction_balanced() CASCADE', { transaction });
      await sequelize.query('DROP FUNCTION IF EXISTS reject_posted_financial_mutation() CASCADE', { transaction });
      await queryInterface.dropTable('financial_entries', { transaction });
      await queryInterface.dropTable('financial_transactions', { transaction });
      await queryInterface.dropTable('platform_setting_audits', { transaction });
      await queryInterface.dropTable('platform_settings', { transaction });
      await sequelize.query('DROP TYPE IF EXISTS enum_financial_entries_direction', { transaction });
    });
  },
};
