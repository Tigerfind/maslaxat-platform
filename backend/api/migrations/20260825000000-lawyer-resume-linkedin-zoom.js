'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const addColumn = async (table, name, definition) => {
      const columns = await queryInterface.describeTable(table);
      if (!columns[name]) await queryInterface.addColumn(table, name, definition);
    };
    const tableNames = (await queryInterface.showAllTables())
      .map((table) => (typeof table === 'string' ? table : table.tableName));
    const create = async (name, columns, indexes = []) => {
      if (!tableNames.includes(name)) await queryInterface.createTable(name, columns);
      const existingIndexes = (await queryInterface.showIndex(name)).map((index) => index.name);
      for (const index of indexes) {
        if (!existingIndexes.includes(index.name)) await queryInterface.addIndex(name, index.fields, index);
      }
    };
    const id = { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true };
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    };

    for (const value of ['draft', 'pending_review', 'suspended']) {
      await queryInterface.sequelize.query(`ALTER TYPE enum_lawyer_profiles_verification_status ADD VALUE IF NOT EXISTS '${value}'`);
    }
    await queryInterface.sequelize.query("ALTER TYPE enum_lawyer_documents_type ADD VALUE IF NOT EXISTS 'certificate'");

    await addColumn('lawyer_profiles', 'professional_title', { type: Sequelize.STRING(180) });
    await addColumn('lawyer_profiles', 'region', { type: Sequelize.STRING(120) });
    await addColumn('lawyer_profiles', 'linkedin_url', { type: Sequelize.TEXT });
    await addColumn('lawyer_profiles', 'license_number', { type: Sequelize.STRING(120) });
    await addColumn('lawyer_profiles', 'license_issuer', { type: Sequelize.STRING(255) });
    await addColumn('lawyer_profiles', 'license_issued_at', { type: Sequelize.DATEONLY });
    await addColumn('lawyer_profiles', 'license_expires_at', { type: Sequelize.DATEONLY });
    await addColumn('lawyer_profiles', 'timezone', { type: Sequelize.STRING(64), allowNull: false, defaultValue: 'Asia/Tashkent' });
    await addColumn('lawyer_profiles', 'consultation_formats', { type: Sequelize.ARRAY(Sequelize.STRING), allowNull: false, defaultValue: ['chat', 'audio', 'webrtc'] });
    await addColumn('lawyer_profiles', 'consultation_durations', { type: Sequelize.ARRAY(Sequelize.INTEGER), allowNull: false, defaultValue: [30, 60, 90] });
    await addColumn('lawyer_profiles', 'onboarding_step', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumn('lawyer_profiles', 'verification_submitted_at', { type: Sequelize.DATE });

    await addColumn('consultations', 'scheduled_start_at', { type: Sequelize.DATE });
    await addColumn('consultations', 'scheduled_end_at', { type: Sequelize.DATE });
    await addColumn('consultations', 'schedule_timezone', { type: Sequelize.STRING(64) });
    await addColumn('consultations', 'meeting_provider', { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'webrtc' });
    const consultationIndexes = (await queryInterface.showIndex('consultations')).map((index) => index.name);
    if (!consultationIndexes.includes('consultations_lawyer_scheduled_window_idx')) {
      await queryInterface.addIndex('consultations', ['lawyer_id', 'status', 'scheduled_start_at', 'scheduled_end_at'], { name: 'consultations_lawyer_scheduled_window_idx' });
    }

    await create('lawyer_experiences', {
      id, user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      organization: { type: Sequelize.STRING(255), allowNull: false }, position: { type: Sequelize.STRING(255), allowNull: false },
      start_date: { type: Sequelize.DATEONLY, allowNull: false }, end_date: { type: Sequelize.DATEONLY },
      is_current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }, description: { type: Sequelize.TEXT },
      display_order: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 }, ...timestamps,
    }, [{ name: 'lawyer_experiences_user_order_idx', fields: ['user_id', 'display_order'] }]);

    await create('lawyer_educations', {
      id, user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      university: { type: Sequelize.STRING(255), allowNull: false }, faculty: { type: Sequelize.STRING(255) },
      specialty: { type: Sequelize.STRING(255), allowNull: false }, degree: { type: Sequelize.STRING(120) },
      start_year: { type: Sequelize.INTEGER }, end_year: { type: Sequelize.INTEGER }, country: { type: Sequelize.STRING(120) },
      city: { type: Sequelize.STRING(120) }, display_order: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 }, ...timestamps,
    }, [{ name: 'lawyer_educations_user_order_idx', fields: ['user_id', 'display_order'] }]);

    await create('lawyer_certificates', {
      id, user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      document_id: { type: Sequelize.UUID, references: { model: 'lawyer_documents', key: 'id' }, onDelete: 'SET NULL' },
      title: { type: Sequelize.STRING(255), allowNull: false }, organization: { type: Sequelize.STRING(255) },
      issued_at: { type: Sequelize.DATEONLY }, credential_url: { type: Sequelize.TEXT },
      display_order: { type: Sequelize.SMALLINT, allowNull: false, defaultValue: 0 }, ...timestamps,
    }, [{ name: 'lawyer_certificates_user_order_idx', fields: ['user_id', 'display_order'] }]);

    await create('lawyer_oauth_accounts', {
      id, user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      provider: { type: Sequelize.STRING(32), allowNull: false }, provider_account_id: { type: Sequelize.STRING(255), allowNull: false },
      provider_email: { type: Sequelize.STRING(255) }, last_login_at: { type: Sequelize.DATE }, ...timestamps,
    }, [
      { name: 'lawyer_oauth_provider_subject_unique', unique: true, fields: ['provider', 'provider_account_id'] },
      { name: 'lawyer_oauth_user_provider_unique', unique: true, fields: ['user_id', 'provider'] },
    ]);

    await create('zoom_connections', {
      id, user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      zoom_user_id: { type: Sequelize.STRING(255), allowNull: false }, zoom_account_id: { type: Sequelize.STRING(255) }, zoom_email: { type: Sequelize.STRING(255) },
      access_token_encrypted: { type: Sequelize.TEXT, allowNull: false }, refresh_token_encrypted: { type: Sequelize.TEXT, allowNull: false },
      token_expires_at: { type: Sequelize.DATE, allowNull: false }, scopes: { type: Sequelize.ARRAY(Sequelize.STRING), allowNull: false, defaultValue: [] },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'connected' }, last_error: { type: Sequelize.TEXT },
      connected_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }, disconnected_at: { type: Sequelize.DATE }, ...timestamps,
    }, [{ name: 'zoom_connections_user_unique', unique: true, fields: ['user_id'] }]);

    await create('consultation_meetings', {
      id, consultation_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'consultations', key: 'id' }, onDelete: 'CASCADE' },
      zoom_connection_id: { type: Sequelize.UUID, references: { model: 'zoom_connections', key: 'id' }, onDelete: 'SET NULL' },
      provider: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'zoom' }, external_meeting_id: { type: Sequelize.STRING(255) },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'creating' }, join_url_encrypted: { type: Sequelize.TEXT },
      start_url_encrypted: { type: Sequelize.TEXT }, passcode_encrypted: { type: Sequelize.TEXT }, scheduled_at: { type: Sequelize.DATE },
      duration: { type: Sequelize.INTEGER }, last_error: { type: Sequelize.TEXT }, started_at: { type: Sequelize.DATE }, ended_at: { type: Sequelize.DATE },
      cancelled_at: { type: Sequelize.DATE }, ...timestamps,
    }, [
      { name: 'consultation_meetings_consultation_unique', unique: true, fields: ['consultation_id'] },
      { name: 'consultation_meetings_provider_external_unique', unique: true, fields: ['provider', 'external_meeting_id'] },
    ]);

    await create('lawyer_profile_status_histories', {
      id, lawyer_profile_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'lawyer_profiles', key: 'id' }, onDelete: 'CASCADE' },
      actor_user_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      from_status: { type: Sequelize.STRING(32) }, to_status: { type: Sequelize.STRING(32), allowNull: false },
      reason: { type: Sequelize.TEXT }, metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
    }, [{ name: 'lawyer_profile_status_history_profile_created_idx', fields: ['lawyer_profile_id', 'created_at'] }]);

    await queryInterface.sequelize.query(`
      INSERT INTO lawyer_profile_status_histories (id, lawyer_profile_id, from_status, to_status, metadata, created_at)
      SELECT gen_random_uuid(), id, NULL, verification_status::text, '{"source":"migration"}'::jsonb, NOW()
      FROM lawyer_profiles
      WHERE NOT EXISTS (
        SELECT 1 FROM lawyer_profile_status_histories h WHERE h.lawyer_profile_id = lawyer_profiles.id
      )
    `);
  },

  async down() {
    throw new Error('Forward-only migration: lawyer resume and meeting schema is not reversible');
  },
};
