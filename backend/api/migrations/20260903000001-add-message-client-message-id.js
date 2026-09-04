'use strict';

const INDEX_NAME = 'messages_consultation_sender_client_message_unique';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('messages');
    if (!columns.client_message_id) {
      await queryInterface.addColumn('messages', 'client_message_id', {
        type: Sequelize.STRING(128),
        allowNull: true,
      });
    }
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME}
      ON messages (consultation_id, sender_id, client_message_id)
      WHERE client_message_id IS NOT NULL
    `);
  },

  async down() {
    throw new Error('Forward-only migration: add message client_message_id idempotency key');
  },
};
