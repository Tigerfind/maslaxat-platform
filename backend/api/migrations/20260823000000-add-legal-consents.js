'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable('users');
    if (!users.legal_accepted_at) await queryInterface.addColumn('users', 'legal_accepted_at', { type: Sequelize.DATE });
    if (!users.legal_version) await queryInterface.addColumn('users', 'legal_version', { type: Sequelize.STRING });

    const consultations = await queryInterface.describeTable('consultations');
    if (!consultations.legal_accepted_at) await queryInterface.addColumn('consultations', 'legal_accepted_at', { type: Sequelize.DATE });
    if (!consultations.legal_version) await queryInterface.addColumn('consultations', 'legal_version', { type: Sequelize.STRING });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('consultations', 'legal_version');
    await queryInterface.removeColumn('consultations', 'legal_accepted_at');
    await queryInterface.removeColumn('users', 'legal_version');
    await queryInterface.removeColumn('users', 'legal_accepted_at');
  },
};
