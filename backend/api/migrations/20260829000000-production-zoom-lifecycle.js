'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const add = async (table, name, definition) => {
      const columns = await queryInterface.describeTable(table);
      if (!columns[name]) await queryInterface.addColumn(table, name, definition);
    };

    await add('consultations', 'lifecycle_status', { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'confirmed' });
    await add('consultations', 'lawyer_first_joined_at', { type: Sequelize.DATE });
    await add('consultations', 'client_first_joined_at', { type: Sequelize.DATE });
    await add('consultations', 'conversation_started_at', { type: Sequelize.DATE });
    await add('consultations', 'final_left_at', { type: Sequelize.DATE });
    await add('consultations', 'grace_ends_at', { type: Sequelize.DATE });
    await add('consultations', 'no_show_checked_at', { type: Sequelize.DATE });
    await add('consultations', 'reminder_24_sent', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await add('consultations', 'reminder_10_sent', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });

    await add('consultation_meetings', 'meeting_uuid', { type: Sequelize.STRING(255) });
    await add('consultation_meetings', 'desired_state', { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'ready' });
    await add('consultation_meetings', 'pending_operation', { type: Sequelize.STRING(32) });
    await add('consultation_meetings', 'operation_version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('consultation_meetings', 'attempt_count', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('consultation_meetings', 'next_attempt_at', { type: Sequelize.DATE });
    await add('consultation_meetings', 'last_attempt_at', { type: Sequelize.DATE });
    await add('consultation_meetings', 'lease_owner', { type: Sequelize.STRING(120) });
    await add('consultation_meetings', 'lease_expires_at', { type: Sequelize.DATE });
    await add('consultation_meetings', 'idempotency_key', { type: Sequelize.STRING(255) });
    await add('consultation_meetings', 'last_http_status', { type: Sequelize.INTEGER });
    await add('consultation_meetings', 'provider_request_id', { type: Sequelize.STRING(255) });
    await add('consultation_meetings', 'last_safe_error', { type: Sequelize.STRING(255) });
    await add('zoom_webhook_events', 'attempt_count', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('zoom_webhook_events', 'next_attempt_at', { type: Sequelize.DATE });
    await add('zoom_webhook_events', 'last_error', { type: Sequelize.STRING(255) });

    const tables = (await queryInterface.showAllTables()).map((table) => typeof table === 'string' ? table : table.tableName);
    if (!tables.includes('meeting_events')) {
      await queryInterface.createTable('meeting_events', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        consultation_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'consultations', key: 'id' }, onDelete: 'CASCADE' },
        meeting_id: { type: Sequelize.UUID, references: { model: 'consultation_meetings', key: 'id' }, onDelete: 'SET NULL' },
        provider_event_id: { type: Sequelize.STRING(255) },
        event_type: { type: Sequelize.STRING(80), allowNull: false },
        participant_role: { type: Sequelize.STRING(16) },
        occurred_at: { type: Sequelize.DATE, allowNull: false },
        correlation_id: { type: Sequelize.STRING(64), allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    const eventIndexes = (await queryInterface.showIndex('meeting_events')).map((index) => index.name);
    if (!eventIndexes.includes('meeting_events_provider_event_unique')) {
      await queryInterface.addIndex('meeting_events', ['provider_event_id'], { name: 'meeting_events_provider_event_unique', unique: true, where: { provider_event_id: { [Sequelize.Op.ne]: null } } });
    }
    if (!eventIndexes.includes('meeting_events_consultation_occurred_idx')) {
      await queryInterface.addIndex('meeting_events', ['consultation_id', 'occurred_at'], { name: 'meeting_events_consultation_occurred_idx' });
    }
    const meetingIndexes = (await queryInterface.showIndex('consultation_meetings')).map((index) => index.name);
    if (!meetingIndexes.includes('consultation_meetings_retry_idx')) {
      await queryInterface.addIndex('consultation_meetings', ['pending_operation', 'next_attempt_at'], { name: 'consultation_meetings_retry_idx' });
    }
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
    await queryInterface.sequelize.query(`
      UPDATE consultations SET lifecycle_status = CASE
        WHEN status = 'payment_pending' THEN 'pending_payment'
        WHEN status = 'completed' THEN 'completed'
        WHEN status IN ('cancelled','rejected') THEN 'cancelled'
        WHEN status = 'in_progress' THEN 'in_progress'
        ELSE 'confirmed' END
    `);
  },
  async down() { throw new Error('Forward-only migration: production Zoom lifecycle'); },
};
