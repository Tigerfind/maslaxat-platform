'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('users');
    if (!columns.verification_attempts) {
      await queryInterface.addColumn('users', 'verification_attempts', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
    if (!columns.verification_sent_at) {
      await queryInterface.addColumn('users', 'verification_sent_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down() {
    throw new Error('Forward-only migration: add email verification OTP state');
  },
};
