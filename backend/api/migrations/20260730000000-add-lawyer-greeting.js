'use strict';

/** Добавляет lawyer_profiles.greeting (автоприветствие в чате). Идемпотентно. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('lawyer_profiles');
    if (!table.greeting) {
      await queryInterface.addColumn('lawyer_profiles', 'greeting', { type: Sequelize.TEXT, allowNull: true });
    }
  },
  async down(queryInterface) {
    const table = await queryInterface.describeTable('lawyer_profiles');
    if (table.greeting) await queryInterface.removeColumn('lawyer_profiles', 'greeting');
  },
};
