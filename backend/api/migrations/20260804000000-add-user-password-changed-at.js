'use strict';

/** Добавляет users.password_changed_at (инвалидация старых JWT при сбросе). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.password_changed_at) {
      await queryInterface.addColumn('users', 'password_changed_at', {
        type: Sequelize.DATE, allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.password_changed_at) await queryInterface.removeColumn('users', 'password_changed_at');
  },
};
