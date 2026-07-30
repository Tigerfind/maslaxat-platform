'use strict';

/**
 * Добавляет support_tickets.response (TEXT) и responded_at (TIMESTAMP) — ответ
 * администратора автору обращения. Раньше в модели было только subject/message/
 * status, и админ не мог ответить пользователю. Идемпотентно (describeTable).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('support_tickets');
    if (!table.response) {
      await queryInterface.addColumn('support_tickets', 'response', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
    if (!table.responded_at) {
      await queryInterface.addColumn('support_tickets', 'responded_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('support_tickets');
    if (table.response) await queryInterface.removeColumn('support_tickets', 'response');
    if (table.responded_at) await queryInterface.removeColumn('support_tickets', 'responded_at');
  },
};
