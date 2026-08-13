'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('legal_documents')) {
      await queryInterface.createTable('legal_documents', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        title: { type: Sequelize.STRING, allowNull: false },
        code: { type: Sequelize.STRING },
        language: { type: Sequelize.STRING(8), allowNull: false, defaultValue: 'ru' },
        source_url: { type: Sequelize.TEXT, allowNull: false },
        version: { type: Sequelize.STRING, allowNull: false },
        effective_from: { type: Sequelize.DATEONLY },
        effective_to: { type: Sequelize.DATEONLY },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        checksum: { type: Sequelize.STRING(64) },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!tables.includes('legal_chunks')) {
      await queryInterface.createTable('legal_chunks', {
        id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
        document_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'legal_documents', key: 'id' },
          onDelete: 'CASCADE',
        },
        ordinal: { type: Sequelize.INTEGER, allowNull: false },
        article_number: { type: Sequelize.STRING },
        heading: { type: Sequelize.TEXT },
        content: { type: Sequelize.TEXT, allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false },
      });
    }

    // Sequelize разделяет acronym AI при underscored:true: AIMessage → a_i_messages.
    const aiColumns = await queryInterface.describeTable('a_i_messages');
    if (!aiColumns.sources) {
      await queryInterface.addColumn('a_i_messages', 'sources', {
        type: Sequelize.JSONB, allowNull: false, defaultValue: [],
      });
    }
    if (!aiColumns.fallback) {
      await queryInterface.addColumn('a_i_messages', 'fallback', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false,
      });
    }

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_source_version_unique
      ON legal_documents (source_url, version)
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS legal_chunks_document_ordinal_unique
      ON legal_chunks (document_id, ordinal)
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS legal_chunks_fts_idx
      ON legal_chunks USING GIN (
        to_tsvector('simple', coalesce(article_number, '') || ' ' || coalesce(heading, '') || ' ' || content)
      )
    `);
  },

  async down(queryInterface) {
    const aiColumns = await queryInterface.describeTable('a_i_messages');
    if (aiColumns.fallback) await queryInterface.removeColumn('a_i_messages', 'fallback');
    if (aiColumns.sources) await queryInterface.removeColumn('a_i_messages', 'sources');
    await queryInterface.dropTable('legal_chunks');
    await queryInterface.dropTable('legal_documents');
  },
};
