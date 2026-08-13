'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_payments_refund_status AS ENUM ('none', 'requested', 'completed', 'failed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      ALTER TYPE enum_withdrawals_status ADD VALUE IF NOT EXISTS 'processing';
      ALTER TABLE payments
        ADD COLUMN IF NOT EXISTS refund_status enum_payments_refund_status NOT NULL DEFAULT 'none';
    `);

    const paymentColumns = await queryInterface.describeTable('payments');
    const paymentAdditions = {
      refund_requested_at: { type: Sequelize.DATE },
      refunded_at: { type: Sequelize.DATE },
      refund_reason: { type: Sequelize.TEXT },
      refund_requested_by: { type: Sequelize.UUID },
    };
    for (const [name, definition] of Object.entries(paymentAdditions)) {
      if (!paymentColumns[name]) await queryInterface.addColumn('payments', name, definition);
    }

    const withdrawalColumns = await queryInterface.describeTable('withdrawals');
    const withdrawalAdditions = {
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'UZS' },
      idempotency_key: { type: Sequelize.STRING },
      provider_transaction_id: { type: Sequelize.STRING },
      provider_reference: { type: Sequelize.STRING },
      destination_snapshot: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      processing_at: { type: Sequelize.DATE },
      processed_at: { type: Sequelize.DATE },
      processed_by: { type: Sequelize.UUID },
      failure_code: { type: Sequelize.STRING },
      failure_message: { type: Sequelize.TEXT },
    };
    for (const [name, definition] of Object.entries(withdrawalAdditions)) {
      if (!withdrawalColumns[name]) await queryInterface.addColumn('withdrawals', name, definition);
    }

    const tables = await queryInterface.showAllTables();
    if (!tables.includes('financial_events')) {
      await queryInterface.createTable('financial_events', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        consultation_id: { type: Sequelize.UUID },
        payment_id: { type: Sequelize.UUID },
        withdrawal_id: { type: Sequelize.UUID },
        actor_user_id: { type: Sequelize.UUID },
        source: { type: Sequelize.STRING, allowNull: false },
        type: { type: Sequelize.STRING, allowNull: false },
        amount: { type: Sequelize.DECIMAL(12, 2) },
        idempotency_key: { type: Sequelize.STRING, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_lawyer_idempotency_unique
      ON withdrawals (lawyer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_provider_transaction_unique
      ON withdrawals (provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS financial_events_idempotency_unique
      ON financial_events (idempotency_key);
      ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_amount_positive;
      ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_amount_positive CHECK (amount > 0);
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('financial_events');
    for (const column of ['failure_message', 'failure_code', 'processed_by', 'processed_at', 'processing_at', 'destination_snapshot', 'provider_reference', 'provider_transaction_id', 'idempotency_key', 'currency']) {
      await queryInterface.removeColumn('withdrawals', column);
    }
    for (const column of ['refund_requested_by', 'refund_reason', 'refunded_at', 'refund_requested_at', 'refund_status']) {
      await queryInterface.removeColumn('payments', column);
    }
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS enum_payments_refund_status');
  },
};
