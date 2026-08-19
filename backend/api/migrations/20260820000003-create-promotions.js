'use strict';

const EXACT_SUBJECT = 'payments_exact_subject';

async function tableExists(queryInterface, tableName, transaction) {
  const tables = await queryInterface.showAllTables({ transaction });
  return tables.map((table) => typeof table === 'string' ? table : table.tableName).includes(tableName);
}

async function hasConstraint(sequelize, name, transaction) {
  const [rows] = await sequelize.query('SELECT 1 FROM pg_constraint WHERE conname = :name', {
    replacements: { name }, transaction,
  });
  return rows.length > 0;
}

async function hasIndex(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

async function addForeignKey(queryInterface, sequelize, table, fields, name, references, transaction) {
  if (!(await hasConstraint(sequelize, name, transaction))) {
    await queryInterface.addConstraint(table, {
      fields, type: 'foreign key', name, references, onUpdate: 'CASCADE', onDelete: 'RESTRICT', transaction,
    });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      const profiles = await queryInterface.describeTable('lawyer_profiles', { transaction });
      if (!profiles.promotion_pilot_enabled) {
        await queryInterface.addColumn('lawyer_profiles', 'promotion_pilot_enabled', {
          type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
        }, { transaction });
      }

      if (!(await tableExists(queryInterface, 'promotion_packages', transaction))) {
        await queryInterface.createTable('promotion_packages', {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
          code: { type: Sequelize.STRING, allowNull: false },
          name: { type: Sequelize.JSONB, allowNull: false },
          placement: { type: Sequelize.STRING, allowNull: false, defaultValue: 'catalog_top' },
          duration_days: { type: Sequelize.INTEGER, allowNull: false },
          price_amount_tiyin: { type: Sequelize.BIGINT, allowNull: false },
          currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'UZS' },
          max_active_slots: { type: Sequelize.INTEGER, allowNull: false },
          sponsored_positions: { type: Sequelize.ARRAY(Sequelize.INTEGER), allowNull: false, defaultValue: [0, 3] },
          is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
          display_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }

      if (!(await tableExists(queryInterface, 'lawyer_promotions', transaction))) {
        await queryInterface.createTable('lawyer_promotions', {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false, defaultValue: Sequelize.literal('gen_random_uuid()') },
          lawyer_id: { type: Sequelize.UUID, allowNull: false },
          package_id: { type: Sequelize.UUID, allowNull: false },
          payment_id: { type: Sequelize.UUID, allowNull: true },
          idempotency_key: { type: Sequelize.STRING, allowNull: false },
          placement: { type: Sequelize.STRING, allowNull: false },
          specialization: { type: Sequelize.STRING, allowNull: false },
          location: { type: Sequelize.STRING, allowNull: true },
          duration_days: { type: Sequelize.INTEGER, allowNull: false },
          price_amount_tiyin: { type: Sequelize.BIGINT, allowNull: false },
          currency: { type: Sequelize.STRING(3), allowNull: false },
          max_active_slots: { type: Sequelize.INTEGER, allowNull: false },
          sponsored_positions: { type: Sequelize.ARRAY(Sequelize.INTEGER), allowNull: false },
          status: {
            type: Sequelize.ENUM('pending_payment', 'queued', 'scheduled', 'active', 'paused', 'expired', 'cancelled', 'refund_pending', 'refunded'),
            allowNull: false, defaultValue: 'pending_payment',
          },
          reservation_expires_at: { type: Sequelize.DATE, allowNull: true },
          paid_at: { type: Sequelize.DATE, allowNull: true },
          starts_at: { type: Sequelize.DATE, allowNull: true },
          active_since: { type: Sequelize.DATE, allowNull: true },
          ends_at: { type: Sequelize.DATE, allowNull: true },
          paused_at: { type: Sequelize.DATE, allowNull: true },
          resume_deadline: { type: Sequelize.DATE, allowNull: true },
          remaining_seconds: { type: Sequelize.INTEGER, allowNull: true },
          cancellation_requested_at: { type: Sequelize.DATE, allowNull: true },
          cancelled_at: { type: Sequelize.DATE, allowNull: true },
          cancellation_reason: { type: Sequelize.STRING, allowNull: true },
          refund_requested_at: { type: Sequelize.DATE, allowNull: true },
          refunded_at: { type: Sequelize.DATE, allowNull: true },
          impressions: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
          profile_views: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
          booking_starts: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
          bookings: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
          updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        }, { transaction });
      }

      const payments = await queryInterface.describeTable('payments', { transaction });
      if (!payments.lawyer_promotion_id) {
        await queryInterface.addColumn('payments', 'lawyer_promotion_id', { type: Sequelize.UUID, allowNull: true }, { transaction });
      }

      await addForeignKey(queryInterface, sequelize, 'lawyer_promotions', ['lawyer_id'], 'lawyer_promotions_lawyer_fk', { table: 'users', field: 'id' }, transaction);
      await addForeignKey(queryInterface, sequelize, 'lawyer_promotions', ['package_id'], 'lawyer_promotions_package_fk', { table: 'promotion_packages', field: 'id' }, transaction);
      await addForeignKey(queryInterface, sequelize, 'lawyer_promotions', ['payment_id'], 'lawyer_promotions_payment_fk', { table: 'payments', field: 'id' }, transaction);
      await addForeignKey(queryInterface, sequelize, 'payments', ['lawyer_promotion_id'], 'payments_lawyer_promotion_fk', { table: 'lawyer_promotions', field: 'id' }, transaction);

      const indexes = [
        ['promotion_packages_code_unique', 'CREATE UNIQUE INDEX promotion_packages_code_unique ON promotion_packages (code)'],
        ['lawyer_promotions_payment_unique', 'CREATE UNIQUE INDEX lawyer_promotions_payment_unique ON lawyer_promotions (payment_id) WHERE payment_id IS NOT NULL'],
        ['payments_lawyer_promotion_unique', 'CREATE UNIQUE INDEX payments_lawyer_promotion_unique ON payments (lawyer_promotion_id) WHERE lawyer_promotion_id IS NOT NULL'],
        ['lawyer_promotions_owner_idempotency_unique', 'CREATE UNIQUE INDEX lawyer_promotions_owner_idempotency_unique ON lawyer_promotions (lawyer_id, idempotency_key)'],
        ['lawyer_promotions_scope_status_idx', 'CREATE INDEX lawyer_promotions_scope_status_idx ON lawyer_promotions (placement, specialization, location, status)'],
        ['lawyer_promotions_fifo_idx', 'CREATE INDEX lawyer_promotions_fifo_idx ON lawyer_promotions (placement, specialization, location, status, paid_at, id)'],
      ];
      for (const [name, sql] of indexes) {
        if (!(await hasIndex(sequelize, name, transaction))) await sequelize.query(sql, { transaction });
      }

      const checks = [
        ['promotion_packages', 'promotion_packages_values_valid', "placement = 'catalog_top' AND duration_days IN (7, 30) AND price_amount_tiyin > 0 AND max_active_slots > 0 AND cardinality(sponsored_positions) BETWEEN 1 AND 2 AND sponsored_positions <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]::integer[] AND (cardinality(sponsored_positions) = 1 OR sponsored_positions[1] <> sponsored_positions[2])"],
        ['lawyer_promotions', 'lawyer_promotions_snapshot_valid', "placement = 'catalog_top' AND duration_days IN (7, 30) AND price_amount_tiyin > 0 AND max_active_slots > 0 AND (remaining_seconds IS NULL OR remaining_seconds >= 0) AND cardinality(sponsored_positions) BETWEEN 1 AND 2 AND sponsored_positions <@ ARRAY[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]::integer[] AND (cardinality(sponsored_positions) = 1 OR sponsored_positions[1] <> sponsored_positions[2])"],
      ];
      for (const [table, name, condition] of checks) {
        if (await hasConstraint(sequelize, name, transaction)) {
          await sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`, { transaction });
        }
        await sequelize.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${condition})`, { transaction });
      }
      // A previous expand migration may have installed this name with the pre-promotion definition.
      if (await hasConstraint(sequelize, EXACT_SUBJECT, transaction)) {
        await sequelize.query(`ALTER TABLE payments DROP CONSTRAINT ${EXACT_SUBJECT}`, { transaction });
      }
      await sequelize.query(`
        ALTER TABLE payments ADD CONSTRAINT ${EXACT_SUBJECT} CHECK (
          (purpose = 'consultation' AND consultation_id IS NOT NULL AND subscription_id IS NULL AND lawyer_promotion_id IS NULL)
          OR (purpose = 'consultation_extension' AND consultation_id IS NOT NULL AND subscription_id IS NULL AND lawyer_promotion_id IS NULL)
          OR (purpose = 'subscription' AND consultation_id IS NULL AND subscription_id IS NOT NULL AND lawyer_promotion_id IS NULL)
          OR (purpose = 'lawyer_promotion' AND consultation_id IS NULL AND subscription_id IS NULL AND lawyer_promotion_id IS NOT NULL)
        )
      `, { transaction });
    });
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      await sequelize.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${EXACT_SUBJECT}`, { transaction });
      await sequelize.query('ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_lawyer_promotion_fk', { transaction });
      const payments = await queryInterface.describeTable('payments', { transaction });
      if (payments.lawyer_promotion_id) await queryInterface.removeColumn('payments', 'lawyer_promotion_id', { transaction });
      await queryInterface.dropTable('lawyer_promotions', { transaction });
      await queryInterface.dropTable('promotion_packages', { transaction });
      const profiles = await queryInterface.describeTable('lawyer_profiles', { transaction });
      if (profiles.promotion_pilot_enabled) await queryInterface.removeColumn('lawyer_profiles', 'promotion_pilot_enabled', { transaction });
      await sequelize.query('DROP TYPE IF EXISTS enum_lawyer_promotions_status', { transaction });
    });
  },
};
