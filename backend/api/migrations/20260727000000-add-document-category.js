'use strict';

/** Добавляет documents.category (папка/категория документа). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('documents');
    if (!table.category) {
      await queryInterface.addColumn('documents', 'category', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('documents');
    if (table.category) await queryInterface.removeColumn('documents', 'category');
  },
};
