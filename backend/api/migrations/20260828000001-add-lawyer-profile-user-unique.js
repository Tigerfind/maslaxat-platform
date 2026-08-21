'use strict';

module.exports = {
  async up(queryInterface) {
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT user_id FROM lawyer_profiles GROUP BY user_id HAVING COUNT(*) > 1
    `);
    if (duplicates.length) throw new Error('Duplicate lawyer profiles found; resolve before adding unique index');
    const indexes = (await queryInterface.showIndex('lawyer_profiles')).map((index) => index.name);
    if (!indexes.includes('lawyer_profiles_user_id_unique')) {
      await queryInterface.addIndex('lawyer_profiles', ['user_id'], { name: 'lawyer_profiles_user_id_unique', unique: true });
    }
  },

  async down() {
    throw new Error('Forward-only migration: lawyer profile uniqueness is not reversible');
  },
};
