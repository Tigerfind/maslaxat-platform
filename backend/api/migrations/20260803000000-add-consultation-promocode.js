'use strict';

/** Добавляет consultations.promo_code (для возврата usedCount при отмене). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.promo_code) {
      await queryInterface.addColumn('consultations', 'promo_code', {
        type: Sequelize.STRING, allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.promo_code) await queryInterface.removeColumn('consultations', 'promo_code');
  },
};
