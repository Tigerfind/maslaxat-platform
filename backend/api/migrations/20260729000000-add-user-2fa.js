'use strict';

/** Добавляет поля 2FA (TOTP) в users. Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.two_factor_secret) {
      await queryInterface.addColumn('users', 'two_factor_secret', { type: Sequelize.STRING, allowNull: true });
    }
    if (!table.two_factor_enabled) {
      await queryInterface.addColumn('users', 'two_factor_enabled', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
    if (!table.two_factor_backup_codes) {
      await queryInterface.addColumn('users', 'two_factor_backup_codes', { type: Sequelize.JSONB, allowNull: true, defaultValue: [] });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.two_factor_secret) await queryInterface.removeColumn('users', 'two_factor_secret');
    if (table.two_factor_enabled) await queryInterface.removeColumn('users', 'two_factor_enabled');
    if (table.two_factor_backup_codes) await queryInterface.removeColumn('users', 'two_factor_backup_codes');
  },
};
