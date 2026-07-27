'use strict';

/** Добавляет consultations.duration (минуты, влияет на цену). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.duration) {
      await queryInterface.addColumn('consultations', 'duration', {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 60,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.duration) await queryInterface.removeColumn('consultations', 'duration');
  },
};
