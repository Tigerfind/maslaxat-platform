'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [[invalid]] = await queryInterface.sequelize.query('SELECT COUNT(*)::int AS count FROM consultations WHERE duration IS NULL OR duration NOT IN (30, 60, 90)');
    if (invalid.count) throw new Error(`Cannot enforce consultation duration: invalid rows=${invalid.count}`);
    await queryInterface.changeColumn('consultations', 'duration', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 });
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE consultations ADD CONSTRAINT consultations_duration_allowed CHECK (duration IS NOT NULL AND duration IN (30, 60, 90)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  },
  async down() { throw new Error('Forward-only migration: consultation duration'); },
};
