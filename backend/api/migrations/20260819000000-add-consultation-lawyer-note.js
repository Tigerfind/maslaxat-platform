'use strict';

/**
 * Приватная заметка юриста по делу: consultations.lawyer_note (TEXT, nullable).
 * Видна только юристу. Идемпотентно.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.lawyer_note) {
      await queryInterface.addColumn('consultations', 'lawyer_note', { type: Sequelize.TEXT, allowNull: true });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.lawyer_note) await queryInterface.removeColumn('consultations', 'lawyer_note');
  },
};
