'use strict';

/** Добавляет reviews.is_hidden (модерация отзывов). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('reviews');
    if (!table.is_hidden) {
      await queryInterface.addColumn('reviews', 'is_hidden', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('reviews');
    if (table.is_hidden) await queryInterface.removeColumn('reviews', 'is_hidden');
  },
};
