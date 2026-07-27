'use strict';

/** Добавляет consultations.actual_duration (сек, фактическая длительность звонка). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.actual_duration) {
      await queryInterface.addColumn('consultations', 'actual_duration', {
        type: Sequelize.INTEGER, allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.actual_duration) await queryInterface.removeColumn('consultations', 'actual_duration');
  },
};
