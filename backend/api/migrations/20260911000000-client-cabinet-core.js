'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((table) => typeof table === 'string' ? table : table.tableName);
    const hasTable = (name) => tables.includes(name);

    if (!hasTable('client_cases')) {
      await queryInterface.createTable('client_cases', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        client_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        title: { type: Sequelize.STRING(200), allowNull: false },
        description: { type: Sequelize.TEXT },
        status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'draft' },
        archived_at: { type: Sequelize.DATE },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE client_cases ADD CONSTRAINT client_cases_status_allowed CHECK (status IN ('draft','collecting_documents','lawyer_review','consultation_scheduled','in_progress','waiting_for_client','waiting_for_lawyer','resolved','closed','archived')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

    if (!hasTable('case_deadlines')) {
      await queryInterface.createTable('case_deadlines', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        client_case_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'client_cases', key: 'id' }, onDelete: 'RESTRICT' },
        title: { type: Sequelize.STRING(200), allowNull: false },
        description: { type: Sequelize.TEXT },
        due_at: { type: Sequelize.DATE, allowNull: false },
        timezone: { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'Asia/Tashkent' },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
        priority: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'medium' },
        source: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'manual' },
        completed_at: { type: Sequelize.DATE },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE case_deadlines ADD CONSTRAINT case_deadlines_status_allowed CHECK (status IN ('pending','completed','cancelled')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE case_deadlines ADD CONSTRAINT case_deadlines_priority_allowed CHECK (priority IN ('low','medium','high','critical')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE case_deadlines ADD CONSTRAINT case_deadlines_source_allowed CHECK (source IN ('manual','consultation','document','ai')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

    if (!hasTable('deadline_reminders')) {
      await queryInterface.createTable('deadline_reminders', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        deadline_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'case_deadlines', key: 'id' }, onDelete: 'CASCADE' },
        channel: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'in_app' },
        interval_minutes: { type: Sequelize.INTEGER, allowNull: false },
        remind_at: { type: Sequelize.DATE, allowNull: false },
        state: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'scheduled' },
        attempt_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        next_attempt_at: { type: Sequelize.DATE, allowNull: false },
        lease_owner: { type: Sequelize.STRING(120) },
        lease_expires_at: { type: Sequelize.DATE },
        sent_at: { type: Sequelize.DATE },
        last_error: { type: Sequelize.STRING(255) },
        idempotency_key: { type: Sequelize.STRING(255), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE deadline_reminders ADD CONSTRAINT deadline_reminders_channel_allowed CHECK (channel IN ('in_app','email','push','sms')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE deadline_reminders ADD CONSTRAINT deadline_reminders_state_allowed CHECK (state IN ('scheduled','processing','sent','failed','cancelled')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
    await queryInterface.sequelize.query(`DO $$ BEGIN ALTER TABLE deadline_reminders ADD CONSTRAINT deadline_reminders_interval_positive CHECK (interval_minutes >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

    if (!hasTable('case_audit_events')) {
      await queryInterface.createTable('case_audit_events', {
        id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
        client_case_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'client_cases', key: 'id' }, onDelete: 'CASCADE' },
        actor_user_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        event_type: { type: Sequelize.STRING(80), allowNull: false },
        metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      });
    }
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION reject_case_audit_event_mutation() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'case_audit_events are append-only'; END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS case_audit_events_append_only ON case_audit_events;
      CREATE TRIGGER case_audit_events_append_only BEFORE UPDATE OR DELETE ON case_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_case_audit_event_mutation();
    `);

    for (const table of ['consultations', 'documents']) {
      const columns = await queryInterface.describeTable(table);
      if (!columns.client_case_id) {
        await queryInterface.addColumn(table, 'client_case_id', {
          type: Sequelize.UUID, references: { model: 'client_cases', key: 'id' }, onDelete: 'SET NULL', allowNull: true,
        });
      }
    }
    const documentColumns = await queryInterface.describeTable('documents');
    if (!documentColumns.archived_at) await queryInterface.addColumn('documents', 'archived_at', { type: Sequelize.DATE, allowNull: true });

    const addIndex = async (table, fields, options) => {
      const indexes = (await queryInterface.showIndex(table)).map((index) => index.name);
      if (!indexes.includes(options.name)) await queryInterface.addIndex(table, fields, options);
    };
    await addIndex('client_cases', ['client_id', 'status', 'updated_at'], { name: 'client_cases_client_status_updated_idx' });
    await addIndex('case_deadlines', ['client_case_id', 'due_at'], { name: 'case_deadlines_case_due_idx' });
    await addIndex('case_deadlines', ['status', 'due_at'], { name: 'case_deadlines_status_due_idx' });
    await addIndex('deadline_reminders', ['state', 'next_attempt_at', 'lease_expires_at'], { name: 'deadline_reminders_job_idx' });
    await addIndex('deadline_reminders', ['deadline_id', 'channel', 'remind_at'], { name: 'deadline_reminders_schedule_unique', unique: true });
    await addIndex('deadline_reminders', ['idempotency_key'], { name: 'deadline_reminders_idempotency_unique', unique: true });
    await addIndex('case_audit_events', ['client_case_id', 'created_at'], { name: 'case_audit_events_case_created_idx' });
    await addIndex('consultations', ['client_case_id'], { name: 'consultations_client_case_idx' });
    await addIndex('documents', ['client_case_id'], { name: 'documents_client_case_idx' });
    await addIndex('documents', ['user_id', 'archived_at', 'updated_at'], { name: 'documents_user_archived_updated_idx' });
  },

  async down() {
    throw new Error('Forward-only migration: client cabinet core');
  },
};
