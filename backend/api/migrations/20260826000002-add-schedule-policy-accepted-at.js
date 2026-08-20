'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('lawyer_profiles');
    if (!columns.schedule_policy_accepted_at) {
      await queryInterface.addColumn('lawyer_profiles', 'schedule_policy_accepted_at', { type: Sequelize.DATE });
    }
  },

  async down() {
    throw new Error('Forward-only migration: schedule policy acceptance is not reversible');
  },
};
