'use strict';

/** Добавляет users.google_id и users.telegram_id (соц-вход). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.google_id) {
      await queryInterface.addColumn('users', 'google_id', { type: Sequelize.STRING, allowNull: true });
    }
    if (!table.telegram_id) {
      await queryInterface.addColumn('users', 'telegram_id', { type: Sequelize.STRING, allowNull: true });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.google_id) await queryInterface.removeColumn('users', 'google_id');
    if (table.telegram_id) await queryInterface.removeColumn('users', 'telegram_id');
  },
};
