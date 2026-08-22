'use strict';

module.exports = {
  async up(queryInterface) {
    const indexes = (await queryInterface.showIndex('consultations')).map((index) => index.name);
    if (!indexes.includes('consultations_payment_expiry_idx')) {
      await queryInterface.sequelize.query(`
        CREATE INDEX consultations_payment_expiry_idx
        ON consultations (created_at)
        WHERE status = 'payment_pending'
      `);
    }
  },
  async down() {
    throw new Error('Forward-only migration: reservation expiry index is not reversible');
  },
};
