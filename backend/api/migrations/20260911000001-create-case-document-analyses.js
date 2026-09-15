'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables())
      .map((table) => (typeof table === 'string' ? table : table.tableName));
    if (!tables.includes('case_document_analyses')) {
      await queryInterface.createTable('case_document_analyses', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        case_document_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'case_documents', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        consultation_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'consultations', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        requested_by_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'processing' },
        result: { type: Sequelize.JSONB },
        model: { type: Sequelize.STRING(100), allowNull: false },
        prompt_version: { type: Sequelize.STRING(40), allowNull: false },
        completed_at: { type: Sequelize.DATE },
        last_error: { type: Sequelize.STRING(1000) },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        ALTER TABLE case_document_analyses ADD CONSTRAINT case_document_analyses_status_allowed
        CHECK (status IN ('processing','completed','failed'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    const indexes = (await queryInterface.showIndex('case_document_analyses')).map((index) => index.name);
    if (!indexes.includes('case_document_analyses_document_prompt_unique')) {
      await queryInterface.addIndex('case_document_analyses', ['case_document_id', 'prompt_version'], {
        name: 'case_document_analyses_document_prompt_unique', unique: true,
      });
    }
    if (!indexes.includes('case_document_analyses_consultation_updated_idx')) {
      await queryInterface.addIndex('case_document_analyses', ['consultation_id', 'updated_at'], {
        name: 'case_document_analyses_consultation_updated_idx',
      });
    }
    if (!indexes.includes('case_document_analyses_requester_status_idx')) {
      await queryInterface.addIndex('case_document_analyses', ['requested_by_id', 'status'], {
        name: 'case_document_analyses_requester_status_idx',
      });
    }
  },

  async down() {
    throw new Error('Forward-only migration: case document analyses');
  },
};
