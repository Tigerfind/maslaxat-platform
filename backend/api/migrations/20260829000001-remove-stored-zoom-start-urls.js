'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('UPDATE consultation_meetings SET start_url_encrypted = NULL WHERE start_url_encrypted IS NOT NULL');
  },
  async down() { throw new Error('Forward-only migration: removed Zoom host URLs cannot be restored'); },
};
