'use strict';

async function hasConstraint(sequelize, name, transaction) {
  const [rows] = await sequelize.query('SELECT 1 FROM pg_constraint WHERE conname = :name', {
    replacements: { name }, transaction,
  });
  return rows.length > 0;
}

async function hasIndex(sequelize, name, transaction) {
  const [rows] = await sequelize.query(`
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name
  `, { replacements: { name }, transaction });
  return rows.length > 0;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      const audits = await queryInterface.describeTable('platform_setting_audits', { transaction });
      if (audits.old_value.type !== 'TEXT') {
        await queryInterface.changeColumn('platform_setting_audits', 'old_value', {
          type: Sequelize.TEXT, allowNull: false,
        }, { transaction });
      }
      if (audits.new_value.type !== 'TEXT') {
        await queryInterface.changeColumn('platform_setting_audits', 'new_value', {
          type: Sequelize.TEXT, allowNull: false,
        }, { transaction });
      }

      const payments = await queryInterface.describeTable('payments', { transaction });
      if (!/320/.test(payments.idempotency_key.type)) {
        await queryInterface.changeColumn('payments', 'idempotency_key', {
          type: Sequelize.STRING(320), allowNull: true,
        }, { transaction });
      }

      const packages = await queryInterface.describeTable('promotion_packages', { transaction });
      if (!/false/i.test(String(packages.is_active.defaultValue))) {
        await queryInterface.changeColumn('promotion_packages', 'is_active', {
          type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
        }, { transaction });
      }

      const documents = await queryInterface.describeTable('lawyer_documents', { transaction });
      if (!documents.verification_status) {
        await queryInterface.addColumn('lawyer_documents', 'verification_status', {
          type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending',
        }, { transaction });
      }
      if (!documents.approved_by_user_id) {
        await queryInterface.addColumn('lawyer_documents', 'approved_by_user_id', {
          type: Sequelize.UUID, allowNull: true,
        }, { transaction });
      }
      if (!documents.approved_at) {
        await queryInterface.addColumn('lawyer_documents', 'approved_at', {
          type: Sequelize.DATE, allowNull: true,
        }, { transaction });
      }
      if (!(await hasConstraint(sequelize, 'lawyer_documents_verification_status_valid', transaction))) {
        await sequelize.query(`
          ALTER TABLE lawyer_documents
          ADD CONSTRAINT lawyer_documents_verification_status_valid
          CHECK (verification_status IN ('pending', 'approved', 'rejected'))
        `, { transaction });
      }
      if (!(await hasConstraint(sequelize, 'lawyer_documents_approved_by_fk', transaction))) {
        await queryInterface.addConstraint('lawyer_documents', {
          fields: ['approved_by_user_id'],
          type: 'foreign key',
          name: 'lawyer_documents_approved_by_fk',
          references: { table: 'users', field: 'id' },
          onDelete: 'RESTRICT',
          transaction,
        });
      }
      if (!(await hasIndex(sequelize, 'lawyer_documents_promotion_approval_idx', transaction))) {
        await queryInterface.addIndex('lawyer_documents', ['user_id', 'type', 'verification_status'], {
          name: 'lawyer_documents_promotion_approval_idx', transaction,
        });
      }
    });
  },

  async down(queryInterface, Sequelize) {
    const sequelize = queryInterface.sequelize;
    return sequelize.transaction(async (transaction) => {
      if (await hasIndex(sequelize, 'lawyer_documents_promotion_approval_idx', transaction)) {
        await queryInterface.removeIndex('lawyer_documents', 'lawyer_documents_promotion_approval_idx', { transaction });
      }
      await sequelize.query('ALTER TABLE lawyer_documents DROP CONSTRAINT IF EXISTS lawyer_documents_approved_by_fk', { transaction });
      await sequelize.query('ALTER TABLE lawyer_documents DROP CONSTRAINT IF EXISTS lawyer_documents_verification_status_valid', { transaction });
      const documents = await queryInterface.describeTable('lawyer_documents', { transaction });
      if (documents.approved_at) await queryInterface.removeColumn('lawyer_documents', 'approved_at', { transaction });
      if (documents.approved_by_user_id) await queryInterface.removeColumn('lawyer_documents', 'approved_by_user_id', { transaction });
      if (documents.verification_status) await queryInterface.removeColumn('lawyer_documents', 'verification_status', { transaction });
      const packages = await queryInterface.describeTable('promotion_packages', { transaction });
      if (!/true/i.test(String(packages.is_active.defaultValue))) {
        await queryInterface.changeColumn('promotion_packages', 'is_active', {
          type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true,
        }, { transaction });
      }
      // TEXT audits and widened idempotency keys are intentionally irreversible-safe:
      // narrowing can fail or destroy data written after this migration.
    });
  },
};
