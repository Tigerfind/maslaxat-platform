'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [[invalid]] = await queryInterface.sequelize.query(`
      SELECT
        COUNT(*) FILTER (WHERE duration IS NULL OR duration NOT IN (30, 60, 90))::int AS invalid_duration,
        COUNT(*) FILTER (WHERE type = 'video' AND (scheduled_start_at IS NULL OR scheduled_end_at IS NULL OR schedule_timezone IS NULL))::int AS invalid_video_schedule
      FROM consultations
    `);
    if (invalid.invalid_duration || invalid.invalid_video_schedule) {
      throw new Error(`Cannot enforce consultation scheduling constraints: invalid_duration=${invalid.invalid_duration}, invalid_video_schedule=${invalid.invalid_video_schedule}`);
    }
    await queryInterface.changeColumn('consultations', 'duration', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 });
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE consultations ADD CONSTRAINT consultations_duration_allowed CHECK (duration IS NOT NULL AND duration IN (30, 60, 90)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE consultations ADD CONSTRAINT consultations_video_schedule_required CHECK (type <> 'video' OR (scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL AND schedule_timezone IS NOT NULL)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  },
  async down() { throw new Error('Forward-only migration: scheduling constraints'); },
};
