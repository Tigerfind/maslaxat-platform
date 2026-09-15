'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = await queryInterface.describeTable('lawyer_profiles');
    if (!columns.duration_prices) {
      await queryInterface.addColumn('lawyer_profiles', 'duration_prices', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      });
    }
    await queryInterface.sequelize.query(`
      UPDATE lawyer_profiles
      SET duration_prices = jsonb_strip_nulls(jsonb_build_object(
        '30', CASE WHEN consultation_durations @> ARRAY[30]::integer[] THEN ROUND(price * 0.5) ELSE NULL END,
        '60', CASE WHEN consultation_durations @> ARRAY[60]::integer[] THEN price ELSE NULL END,
        '90', CASE WHEN consultation_durations @> ARRAY[90]::integer[] THEN ROUND(price * 1.5) ELSE NULL END
      ))
      WHERE duration_prices = '{}'::jsonb
    `);
  },

  async down() {
    throw new Error('Forward-only migration: add lawyer duration prices');
  },
};
