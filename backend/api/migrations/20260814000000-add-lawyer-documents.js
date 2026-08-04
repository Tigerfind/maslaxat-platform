'use strict';

/**
 * Верификационные документы юриста (диплом, лицензия/ордер, удостоверение).
 * Видны только самому юристу и админу. Таблица lawyer_documents.
 * Идемпотентно: создаём таблицу только если её ещё нет.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => (typeof t === 'string' ? t : t.tableName)).includes('lawyer_documents');
    if (exists) return;

    await queryInterface.createTable('lawyer_documents', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      type: {
        type: Sequelize.ENUM('diploma', 'license', 'id', 'other'),
        defaultValue: 'other',
      },
      name: { type: Sequelize.STRING, allowNull: false },
      path: { type: Sequelize.STRING, allowNull: false },
      mime_type: { type: Sequelize.STRING },
      size: { type: Sequelize.INTEGER },
      user_id: {
        type: Sequelize.UUID,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('lawyer_documents', ['user_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('lawyer_documents');
    // Убираем ENUM-тип, созданный Postgres под колонку.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_lawyer_documents_type"');
  },
};
