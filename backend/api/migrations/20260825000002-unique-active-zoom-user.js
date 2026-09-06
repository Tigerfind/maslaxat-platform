'use strict';

module.exports = {
  async up(queryInterface) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT zoom_user_id FROM zoom_connections
      WHERE status = 'connected'
      GROUP BY zoom_user_id HAVING COUNT(*) > 1
    `);
    if (duplicates.length) throw new Error('Duplicate active Zoom users found; resolve ownership before migration');
    const indexes = (await queryInterface.showIndex('zoom_connections')).map((index) => index.name);
    if (!indexes.includes('zoom_connections_zoom_user_connected_unique')) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX zoom_connections_zoom_user_connected_unique
        ON zoom_connections (zoom_user_id)
        WHERE status = 'connected'
      `);
    }
  },

  async down() {
    throw new Error('Forward-only migration: active Zoom account ownership is not reversible');
  },
};
