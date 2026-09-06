'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE consultations
      SET scheduled_start_at = COALESCE(scheduled_start_at, created_at),
          scheduled_end_at = COALESCE(
            scheduled_end_at,
            COALESCE(scheduled_start_at, created_at) + (COALESCE(duration, 60) * interval '1 minute')
          ),
          schedule_timezone = COALESCE(schedule_timezone, 'Asia/Tashkent')
      WHERE type = 'video'
        AND (scheduled_start_at IS NULL OR scheduled_end_at IS NULL OR schedule_timezone IS NULL)
    `);
  },

  async down() {
    throw new Error('Forward-only migration: historical schedule backfill cannot be reversed safely');
  },
};
