'use strict';

/**
 * Добавляет consultations.specialization (VARCHAR, nullable) — категория права всей
 * записи (id из справочника: civil/family/…). Идемпотентно: проверяем наличие колонки.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.specialization) {
      await queryInterface.addColumn('consultations', 'specialization', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.specialization) {
      await queryInterface.removeColumn('consultations', 'specialization');
    }
  },
};
