'use strict';

const NOTIFICATION_INDEX = 'notifications_dedupe_key_unique';
const ACTIVE_PAYMENT_INDEX = 'payments_consultation_active_unique';

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
      const notifications = await queryInterface.describeTable('notifications', { transaction });
      if (!notifications.dedupe_key) {
        await queryInterface.addColumn('notifications', 'dedupe_key', {
          type: Sequelize.STRING,
          allowNull: true,
        }, { transaction });
      }
      if (!(await hasIndex(sequelize, NOTIFICATION_INDEX, transaction))) {
        await queryInterface.addIndex('notifications', ['dedupe_key'], {
          name: NOTIFICATION_INDEX,
          unique: true,
          where: { dedupe_key: { [Sequelize.Op.ne]: null } },
          transaction,
        });
      }

      const [duplicates] = await sequelize.query(`
        SELECT consultation_id, array_agg(id ORDER BY created_at) AS payment_ids
        FROM payments
        WHERE consultation_id IS NOT NULL
          AND purpose = 'consultation'
          AND status IN ('pending', 'processing', 'paid', 'refund_pending', 'partially_refunded')
        GROUP BY consultation_id
        HAVING COUNT(*) > 1
      `, { transaction });
      if (duplicates.length > 0) {
        throw new Error(`Active consultation payment duplicates require operator repair: ${JSON.stringify(duplicates)}`);
      }
      if (!(await hasIndex(sequelize, ACTIVE_PAYMENT_INDEX, transaction))) {
        await sequelize.query(`
          CREATE UNIQUE INDEX ${ACTIVE_PAYMENT_INDEX}
          ON payments (consultation_id)
          WHERE consultation_id IS NOT NULL
            AND purpose = 'consultation'
            AND status IN ('pending', 'processing', 'paid', 'refund_pending', 'partially_refunded')
        `, { transaction });
      }
    });
  },

  async down(queryInterface) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      if (await hasIndex(sequelize, ACTIVE_PAYMENT_INDEX, transaction)) {
        await queryInterface.removeIndex('payments', ACTIVE_PAYMENT_INDEX, { transaction });
      }
      if (await hasIndex(sequelize, NOTIFICATION_INDEX, transaction)) {
        await queryInterface.removeIndex('notifications', NOTIFICATION_INDEX, { transaction });
      }
      const notifications = await queryInterface.describeTable('notifications', { transaction });
      if (notifications.dedupe_key) {
        await queryInterface.removeColumn('notifications', 'dedupe_key', { transaction });
      }
    });
  },
};
