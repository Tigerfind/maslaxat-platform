'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('zoom_webhook_events');
    if (!columns.attempt_count) await queryInterface.addColumn('zoom_webhook_events', 'attempt_count', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    if (!columns.next_attempt_at) await queryInterface.addColumn('zoom_webhook_events', 'next_attempt_at', { type: Sequelize.DATE });
    if (!columns.last_error) await queryInterface.addColumn('zoom_webhook_events', 'last_error', { type: Sequelize.STRING(255) });
    const indexes = (await queryInterface.showIndex('zoom_webhook_events')).map((index) => index.name);
    if (!indexes.includes('zoom_webhook_events_retry_idx')) await queryInterface.addIndex('zoom_webhook_events', ['status', 'next_attempt_at'], { name: 'zoom_webhook_events_retry_idx' });
  },
  async down() { throw new Error('Forward-only migration: Zoom webhook retries'); },
};
