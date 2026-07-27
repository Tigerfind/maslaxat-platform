'use strict';

/** Добавляет consultations.free_source ('loyalty'|'subscription'|null). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.free_source) {
      await queryInterface.addColumn('consultations', 'free_source', {
        type: Sequelize.STRING, allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.free_source) await queryInterface.removeColumn('consultations', 'free_source');
  },
};
