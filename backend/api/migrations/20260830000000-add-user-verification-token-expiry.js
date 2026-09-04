'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.verification_token_expiry) {
      await queryInterface.addColumn('users', 'verification_token_expiry', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    await queryInterface.sequelize.query(`
      UPDATE users
      SET verification_token_expiry = NOW() + INTERVAL '24 hours'
      WHERE verification_token IS NOT NULL AND verification_token_expiry IS NULL
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.verification_token_expiry) {
      await queryInterface.removeColumn('users', 'verification_token_expiry');
    }
  },
};
