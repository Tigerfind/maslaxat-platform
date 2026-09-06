'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('consultations');
    if (!columns.accepted_at) await queryInterface.addColumn('consultations', 'accepted_at', { type: Sequelize.DATE });
    const indexes = (await queryInterface.showIndex('consultations')).map((index) => index.name);
    if (!indexes.includes('consultations_lawyer_accepted_at_idx')) {
      await queryInterface.addIndex('consultations', ['lawyer_id', 'accepted_at'], { name: 'consultations_lawyer_accepted_at_idx' });
    }
  },

  async down() {
    throw new Error('Forward-only migration: response-time history is not reversible');
  },
};
