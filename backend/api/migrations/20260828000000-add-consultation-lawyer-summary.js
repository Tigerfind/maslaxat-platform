'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('consultations');
    if (!columns.lawyer_summary) await queryInterface.addColumn('consultations', 'lawyer_summary', { type: Sequelize.TEXT });
  },

  async down() {
    throw new Error('Forward-only migration: consultation summary is not reversible');
  },
};
