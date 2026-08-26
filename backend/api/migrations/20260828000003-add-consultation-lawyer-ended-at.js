'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('consultations');
    if (!table.lawyer_ended_at) {
      await queryInterface.addColumn('consultations', 'lawyer_ended_at', { type: Sequelize.DATE, allowNull: true });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('consultations');
    if (table.lawyer_ended_at) await queryInterface.removeColumn('consultations', 'lawyer_ended_at');
  },
};
