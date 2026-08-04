'use strict';

/**
 * Рабочие документы по делу (консультации): файлы, видимые обоим участникам —
 * клиенту и юристу. Таблица case_documents. Идемпотентно: создаём только если нет.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('case_documents');
    if (exists) return;

    await queryInterface.createTable('case_documents', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      name: { type: Sequelize.STRING, allowNull: false },
      path: { type: Sequelize.STRING, allowNull: false },
      mime_type: { type: Sequelize.STRING },
      size: { type: Sequelize.INTEGER },
      consultation_id: {
        type: Sequelize.UUID,
        references: { model: 'consultations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      uploader_id: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('case_documents', ['consultation_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('case_documents');
  },
};
