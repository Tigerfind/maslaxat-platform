'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM consultations
          WHERE preferred_date IS NOT NULL AND preferred_time IS NOT NULL
            AND btrim(preferred_time::text) !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
        ) THEN
          RAISE EXCEPTION 'Invalid legacy consultation preferred_time values; run preflight cleanup before migration';
        END IF;
      END $$;

      UPDATE lawyer_profiles
      SET verification_status = 'pending_review'
      WHERE verification_status::text = 'pending';

      ALTER TABLE lawyer_profiles ALTER COLUMN verification_status SET DEFAULT 'draft';

      UPDATE consultations
      SET scheduled_start_at = (preferred_date::text || ' ' || preferred_time::text)::timestamp AT TIME ZONE 'Asia/Tashkent',
          scheduled_end_at = ((preferred_date::text || ' ' || preferred_time::text)::timestamp AT TIME ZONE 'Asia/Tashkent')
            + make_interval(mins => CASE WHEN duration IN (30, 60, 90) THEN duration ELSE 60 END),
          schedule_timezone = COALESCE(schedule_timezone, 'Asia/Tashkent')
      WHERE scheduled_start_at IS NULL
        AND scheduled_end_at IS NULL
        AND preferred_date IS NOT NULL
        AND preferred_time IS NOT NULL;

      INSERT INTO lawyer_educations (
        id, user_id, university, faculty, specialty, degree, start_year, end_year, display_order, created_at, updated_at
      )
      SELECT gen_random_uuid(), lp.user_id,
        COALESCE(NULLIF(item->>'university', ''), 'Не указано'), NULLIF(item->>'faculty', ''),
        COALESCE(NULLIF(item->>'specialty', ''), 'Не указано'), NULLIF(item->>'degree', ''),
        CASE WHEN item->>'startYear' ~ '^[0-9]{4}$' THEN (item->>'startYear')::integer END,
        CASE WHEN item->>'endYear' ~ '^[0-9]{4}$' THEN (item->>'endYear')::integer END,
        ordinality - 1, NOW(), NOW()
      FROM lawyer_profiles lp
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(lp.education) = 'array' THEN lp.education ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS legacy(item, ordinality)
      WHERE NOT EXISTS (SELECT 1 FROM lawyer_educations current WHERE current.user_id = lp.user_id);

      INSERT INTO lawyer_certificates (
        id, user_id, title, organization, issued_at, credential_url, display_order, created_at, updated_at
      )
      SELECT gen_random_uuid(), lp.user_id,
        COALESCE(NULLIF(item->>'title', ''), 'Сертификат'), NULLIF(item->>'organization', ''),
        CASE WHEN item->>'issuedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (item->>'issuedAt')::date END,
        CASE WHEN item->>'credentialUrl' ~ '^https://' THEN item->>'credentialUrl' END,
        ordinality - 1, NOW(), NOW()
      FROM lawyer_profiles lp
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(lp.certificates) = 'array' THEN lp.certificates ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS legacy(item, ordinality)
      WHERE NOT EXISTS (SELECT 1 FROM lawyer_certificates current WHERE current.user_id = lp.user_id);
    `);

    const tables = (await queryInterface.showAllTables())
      .map((table) => (typeof table === 'string' ? table : table.tableName));
    if (!tables.includes('zoom_webhook_events')) {
      await queryInterface.createTable('zoom_webhook_events', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        request_id: { type: Sequelize.STRING(255), allowNull: false },
        event: { type: Sequelize.STRING(120), allowNull: false },
        payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'processing' },
        processed_at: { type: Sequelize.DATE },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    const indexes = (await queryInterface.showIndex('zoom_webhook_events')).map((index) => index.name);
    if (!indexes.includes('zoom_webhook_events_request_unique')) {
      await queryInterface.addIndex('zoom_webhook_events', ['request_id'], {
        name: 'zoom_webhook_events_request_unique',
        unique: true,
      });
    }

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultations_schedule_window_check') THEN
          ALTER TABLE consultations ADD CONSTRAINT consultations_schedule_window_check CHECK (
            (scheduled_start_at IS NULL AND scheduled_end_at IS NULL)
            OR (scheduled_start_at IS NOT NULL AND scheduled_end_at IS NOT NULL AND scheduled_end_at > scheduled_start_at)
          );
        END IF;
      END $$;
    `);
  },

  async down() {
    throw new Error('Forward-only migration: Zoom webhook and schedule reconciliation is not reversible');
  },
};
