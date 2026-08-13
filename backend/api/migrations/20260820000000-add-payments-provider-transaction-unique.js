'use strict';

module.exports = {
  async up(queryInterface) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT provider, transaction_id, COUNT(*) AS n
      FROM payments
      WHERE transaction_id IS NOT NULL
      GROUP BY provider, transaction_id HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      throw new Error('Duplicate payment provider transaction IDs must be resolved manually');
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_transaction_id_unique
      ON payments (provider, transaction_id)
      WHERE transaction_id IS NOT NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS payments_provider_transaction_id_unique');
  },
};
