'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.phone_verified_at) {
      await queryInterface.addColumn('users', 'phone_verified_at', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE users
      SET phone_verified_at = COALESCE(phone_verified_at, NOW())
      WHERE phone IS NOT NULL AND email LIKE '%@phone.maslaxat.uz'
    `);
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('users');
    if (table.phone_verified_at) await queryInterface.removeColumn('users', 'phone_verified_at');
  },
};
