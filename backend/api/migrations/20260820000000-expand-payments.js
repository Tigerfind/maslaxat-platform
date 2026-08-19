'use strict';

const PROVIDER_TRANSACTION_INDEX = 'payments_provider_transaction_unique';
const USER_IDEMPOTENCY_INDEX = 'payments_user_idempotency_unique';
const AMOUNT_CHECK = 'payments_amount_tiyin_positive';
const REFUND_CHECK = 'payments_refunded_amount_tiyin_valid';
const CONSULTATION_SUBJECT_CHECK = 'payments_consultation_subject_valid';
const SUBSCRIPTION_SUBJECT_CHECK = 'payments_subscription_subject_valid';

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) await queryInterface.addColumn(tableName, columnName, definition);
}

async function hasIndex(sequelize, name) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name',
    { replacements: { name } }
  );
  return rows.length > 0;
}

async function hasConstraint(sequelize, name) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM pg_constraint WHERE conname = :name',
    { replacements: { name } }
  );
  return rows.length > 0;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;

    await addColumnIfMissing(queryInterface, 'payments', 'purpose', {
      type: Sequelize.ENUM('consultation', 'consultation_extension', 'subscription', 'lawyer_promotion'),
      allowNull: true,
    });
    await addColumnIfMissing(queryInterface, 'payments', 'amount_tiyin', { type: Sequelize.BIGINT, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'refunded_amount_tiyin', { type: Sequelize.BIGINT, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'subscription_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'subscriptions', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
    await addColumnIfMissing(queryInterface, 'payments', 'idempotency_key', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'provider_transaction_id', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'provider_data', { type: Sequelize.JSONB, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'paid_at', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'cancelled_at', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, 'payments', 'refunded_at', { type: Sequelize.DATE, allowNull: true });

    await addColumnIfMissing(queryInterface, 'consultations', 'commission_rate_bps', { type: Sequelize.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, 'consultations', 'gross_amount_tiyin', { type: Sequelize.BIGINT, allowNull: true });
    await addColumnIfMissing(queryInterface, 'consultations', 'lawyer_net_amount_tiyin', { type: Sequelize.BIGINT, allowNull: true });

    await sequelize.query(`
      UPDATE payments
      SET amount_tiyin = ROUND(amount * 100)
      WHERE amount_tiyin IS NULL
    `);
    await sequelize.query(`
      UPDATE payments
      SET refunded_amount_tiyin = CASE WHEN status = 'refunded' THEN amount_tiyin ELSE 0 END
      WHERE refunded_amount_tiyin IS NULL
    `);
    await sequelize.query(`
      UPDATE payments
      SET provider_transaction_id = transaction_id
      WHERE provider_transaction_id IS NULL AND transaction_id IS NOT NULL
    `);
    await sequelize.query(`
      UPDATE payments
      SET provider_data = provider_response
      WHERE provider_data IS NULL AND provider_response IS NOT NULL
    `);
    await sequelize.query(`
      UPDATE payments
      SET purpose = CASE
        WHEN provider_response ? 'extension' THEN 'consultation_extension'::enum_payments_purpose
        ELSE 'consultation'::enum_payments_purpose
      END
      WHERE purpose IS NULL AND consultation_id IS NOT NULL
    `);
    await sequelize.query(`
      UPDATE payments
      SET purpose = 'subscription'::enum_payments_purpose
      WHERE purpose IS NULL
        AND consultation_id IS NULL
        AND provider_response ? 'subscription'
    `);

    const [ambiguousSubscriptions] = await sequelize.query(`
      SELECT p.id
      FROM payments p
      LEFT JOIN subscriptions s ON s.user_id = p.user_id
      WHERE p.purpose = 'subscription' AND p.subscription_id IS NULL
      GROUP BY p.id
      HAVING COUNT(s.id) <> 1
    `);
    if (ambiguousSubscriptions.length > 0) {
      throw new Error(`Cannot backfill payments.subscription_id: ${ambiguousSubscriptions.length} payment(s) do not have exactly one subscription subject`);
    }
    await sequelize.query(`
      UPDATE payments p
      SET subscription_id = s.id
      FROM subscriptions s
      WHERE p.purpose = 'subscription'
        AND p.subscription_id IS NULL
        AND s.user_id = p.user_id
    `);

    const [ambiguous] = await sequelize.query(`
      SELECT id FROM payments
      WHERE purpose IS NULL
         OR amount_tiyin IS NULL
         OR amount_tiyin <= 0
         OR (purpose IN ('consultation', 'consultation_extension') AND consultation_id IS NULL)
         OR (purpose = 'subscription' AND subscription_id IS NULL)
    `);
    if (ambiguous.length > 0) {
      throw new Error(`Cannot expand payments safely: ${ambiguous.length} ambiguous or invalid legacy payment(s)`);
    }

    const [duplicateProviderTransactions] = await sequelize.query(`
      SELECT provider, provider_transaction_id
      FROM payments
      WHERE provider_transaction_id IS NOT NULL
      GROUP BY provider, provider_transaction_id
      HAVING COUNT(*) > 1
    `);
    if (duplicateProviderTransactions.length > 0) {
      throw new Error(`Cannot create ${PROVIDER_TRANSACTION_INDEX}: duplicate provider transaction IDs exist`);
    }

    if (!(await hasIndex(sequelize, PROVIDER_TRANSACTION_INDEX))) {
      await sequelize.query(`
        CREATE UNIQUE INDEX ${PROVIDER_TRANSACTION_INDEX}
        ON payments (provider, provider_transaction_id)
        WHERE provider_transaction_id IS NOT NULL
      `);
    }
    if (!(await hasIndex(sequelize, USER_IDEMPOTENCY_INDEX))) {
      await sequelize.query(`
        CREATE UNIQUE INDEX ${USER_IDEMPOTENCY_INDEX}
        ON payments (user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      `);
    }

    const constraints = [
      [AMOUNT_CHECK, 'amount_tiyin IS NULL OR amount_tiyin > 0'],
      [REFUND_CHECK, 'refunded_amount_tiyin IS NULL OR (refunded_amount_tiyin >= 0 AND refunded_amount_tiyin <= amount_tiyin)'],
      [CONSULTATION_SUBJECT_CHECK, "purpose NOT IN ('consultation', 'consultation_extension') OR (consultation_id IS NOT NULL AND subscription_id IS NULL)"],
      [SUBSCRIPTION_SUBJECT_CHECK, "purpose <> 'subscription' OR (subscription_id IS NOT NULL AND consultation_id IS NULL)"],
    ];
    for (const [name, condition] of constraints) {
      if (!(await hasConstraint(sequelize, name))) {
        await sequelize.query(`ALTER TABLE payments ADD CONSTRAINT ${name} CHECK (${condition})`);
      }
    }

    const enumValues = ['processing', 'cancelled', 'refund_pending', 'partially_refunded'];
    for (const value of enumValues) {
      await sequelize.query(`ALTER TYPE enum_payments_status ADD VALUE IF NOT EXISTS '${value}'`);
    }
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    for (const constraint of [SUBSCRIPTION_SUBJECT_CHECK, CONSULTATION_SUBJECT_CHECK, REFUND_CHECK, AMOUNT_CHECK]) {
      await sequelize.query(`ALTER TABLE payments DROP CONSTRAINT IF EXISTS ${constraint}`);
    }
    await sequelize.query(`DROP INDEX IF EXISTS ${USER_IDEMPOTENCY_INDEX}`);
    await sequelize.query(`DROP INDEX IF EXISTS ${PROVIDER_TRANSACTION_INDEX}`);

    for (const column of ['lawyer_net_amount_tiyin', 'gross_amount_tiyin', 'commission_rate_bps']) {
      const table = await queryInterface.describeTable('consultations');
      if (table[column]) await queryInterface.removeColumn('consultations', column);
    }
    for (const column of [
      'refunded_at', 'cancelled_at', 'paid_at', 'provider_data', 'provider_transaction_id',
      'idempotency_key', 'subscription_id', 'refunded_amount_tiyin', 'amount_tiyin', 'purpose',
    ]) {
      const table = await queryInterface.describeTable('payments');
      if (table[column]) await queryInterface.removeColumn('payments', column);
    }
    await sequelize.query('DROP TYPE IF EXISTS enum_payments_purpose');
  },
};
