'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS promos_code_key ON promos (code);
      CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON push_subscriptions (endpoint);
    `);
  },

  async down() {
    throw new Error('Forward-only migration: canonical unique indexes are required');
  },
};
