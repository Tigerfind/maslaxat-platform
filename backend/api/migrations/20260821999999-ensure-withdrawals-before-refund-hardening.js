'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (tables.includes('withdrawals')) return;

    await queryInterface.createTable('withdrawals', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      status: {
        type: Sequelize.ENUM('pending', 'paid', 'failed', 'cancelled'),
        allowNull: true,
        defaultValue: 'pending',
      },
      provider: { type: Sequelize.STRING, allowNull: true, defaultValue: 'manual' },
      note: { type: Sequelize.TEXT, allowNull: true },
      lawyer_id: { type: Sequelize.UUID, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  // The sync-era bridge owns this shared table and its compatibility checks.
  async down() {},
};
