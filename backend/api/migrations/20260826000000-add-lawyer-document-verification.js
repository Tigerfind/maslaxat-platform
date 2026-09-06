'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('lawyer_documents');
    if (!columns.verified_at) await queryInterface.addColumn('lawyer_documents', 'verified_at', { type: Sequelize.DATE });
    if (!columns.verified_by) await queryInterface.addColumn('lawyer_documents', 'verified_by', {
      type: Sequelize.UUID,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
    });
    const indexes = (await queryInterface.showIndex('lawyer_documents')).map((index) => index.name);
    if (!indexes.includes('lawyer_documents_verified_user_idx')) {
      await queryInterface.addIndex('lawyer_documents', ['user_id', 'verified_at'], { name: 'lawyer_documents_verified_user_idx' });
    }
  },

  async down() {
    throw new Error('Forward-only migration: document verification audit is not reversible');
  },
};
