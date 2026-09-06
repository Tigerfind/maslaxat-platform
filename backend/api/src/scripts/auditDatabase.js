require('dotenv').config();
const sequelize = require('../config/database');
sequelize.options.logging = false;

const EXPECTED_TABLES = [
  'a_i_conversations', 'a_i_messages', 'case_documents', 'consultations', 'documents',
  'favorite_lawyers', 'financial_events', 'lawyer_documents', 'lawyer_profiles',
  'lawyer_experiences', 'lawyer_educations', 'lawyer_certificates', 'lawyer_oauth_accounts',
  'legal_chunks', 'legal_documents', 'messages', 'notifications', 'payments',
  'phone_otps', 'promos', 'push_subscriptions', 'reviews', 'specializations',
  'subscriptions', 'support_tickets', 'users', 'withdrawals', 'zoom_connections',
  'consultation_meetings', 'zoom_webhook_events', 'lawyer_profile_status_histories',
];

const REQUIRED_INDEXES = [
  { name: 'consultations_loyalty_free_unique', table: 'consultations', unique: true, fields: ['client_id'], partial: true },
  { name: 'reviews_consultation_id_unique', table: 'reviews', unique: true, fields: ['consultation_id'] },
  { name: 'payments_provider_transaction_id_unique', table: 'payments', unique: true, fields: ['provider', 'transaction_id'], partial: true },
  { name: 'users_phone_unique', table: 'users', unique: true, fields: ['phone'], partial: true },
  { name: 'users_email_key', table: 'users', unique: true, fields: ['email'] },
  { name: 'specializations_name_key', table: 'specializations', unique: true, fields: ['name'] },
  { name: 'phone_otps_phone_key', table: 'phone_otps', unique: true, fields: ['phone'] },
  { name: 'promos_code_key', table: 'promos', unique: true, fields: ['code'] },
  { name: 'push_subscriptions_endpoint_key', table: 'push_subscriptions', unique: true, fields: ['endpoint'] },
  { name: 'withdrawals_lawyer_idempotency_unique', table: 'withdrawals', unique: true, fields: ['lawyer_id', 'idempotency_key'], partial: true },
  { name: 'withdrawals_provider_transaction_unique', table: 'withdrawals', unique: true, fields: ['provider', 'provider_transaction_id'], partial: true },
  { name: 'financial_events_idempotency_unique', table: 'financial_events', unique: true, fields: ['idempotency_key'] },
  { name: 'legal_documents_source_version_unique', table: 'legal_documents', unique: true, fields: ['source_url', 'version'] },
  { name: 'legal_chunks_document_ordinal_unique', table: 'legal_chunks', unique: true, fields: ['document_id', 'ordinal'] },
  { name: 'legal_chunks_fts_idx', table: 'legal_chunks', unique: false, fields: [], method: 'gin', expression: true },
  { name: 'lawyer_oauth_provider_subject_unique', table: 'lawyer_oauth_accounts', unique: true, fields: ['provider', 'provider_account_id'] },
  { name: 'lawyer_oauth_user_provider_unique', table: 'lawyer_oauth_accounts', unique: true, fields: ['user_id', 'provider'] },
  { name: 'zoom_connections_user_unique', table: 'zoom_connections', unique: true, fields: ['user_id'] },
  { name: 'zoom_connections_zoom_user_connected_unique', table: 'zoom_connections', unique: true, fields: ['zoom_user_id'], partial: true },
  { name: 'consultation_meetings_consultation_unique', table: 'consultation_meetings', unique: true, fields: ['consultation_id'] },
  { name: 'consultation_meetings_provider_external_unique', table: 'consultation_meetings', unique: true, fields: ['provider', 'external_meeting_id'] },
  { name: 'zoom_webhook_events_request_unique', table: 'zoom_webhook_events', unique: true, fields: ['request_id'] },
  { name: 'consultations_lawyer_scheduled_window_idx', table: 'consultations', unique: false, fields: ['lawyer_id', 'status', 'scheduled_start_at', 'scheduled_end_at'] },
  { name: 'lawyer_documents_verified_user_idx', table: 'lawyer_documents', unique: false, fields: ['user_id', 'verified_at'] },
  { name: 'consultations_lawyer_accepted_at_idx', table: 'consultations', unique: false, fields: ['lawyer_id', 'accepted_at'] },
  { name: 'consultations_payment_expiry_idx', table: 'consultations', unique: false, fields: ['created_at'], partial: true },
];

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    schema: {},
    data: {},
    drift: [],
    unsafeData: [],
  };

  await sequelize.transaction(async (transaction) => {
    await sequelize.query('SET TRANSACTION READ ONLY', { transaction });
    const select = async (sql, replacements) => {
      const [rows] = await sequelize.query(sql, { replacements, transaction });
      return rows;
    };

    const tableRows = await select(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tables = tableRows.map((row) => row.tablename).filter((name) => name !== 'SequelizeMeta');
    report.schema.tables = tables;
    report.schema.missingTables = EXPECTED_TABLES.filter((name) => !tables.includes(name));
    report.schema.extraTables = tables.filter((name) => !EXPECTED_TABLES.includes(name));
    if (report.schema.missingTables.length || report.schema.extraTables.length) report.drift.push('table_set');

    const metaRows = await select(`SELECT to_regclass('public."SequelizeMeta"') AS relation`);
    report.schema.sequelizeMetaExists = Boolean(metaRows[0]?.relation);
    report.schema.migrations = report.schema.sequelizeMetaExists
      ? (await select('SELECT name FROM "public"."SequelizeMeta" ORDER BY name')).map((row) => row.name)
      : [];
    if (!report.schema.sequelizeMetaExists) report.drift.push('sequelize_meta_missing');

    const columns = await select(`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    report.schema.columnCount = columns.length;
    const columnSet = new Set(columns.map((column) => `${column.table_name}.${column.column_name}`));
    const legacyColumns = ['consultations.rating', 'consultations.review', 'consultations.video_room_url'];
    report.schema.legacyColumns = legacyColumns.filter((column) => columnSet.has(column));
    if (report.schema.legacyColumns.length) report.drift.push('legacy_columns');

    const indexes = await select(`
      SELECT ci.relname AS indexname, t.relname AS tablename, i.indisunique,
        i.indisvalid, i.indisready, am.amname,
        COALESCE(pg_get_expr(i.indpred, i.indrelid), '') AS predicate,
        COALESCE(pg_get_expr(i.indexprs, i.indrelid), '') AS expression,
        ARRAY(
          SELECT a.attname
          FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
          WHERE key.position <= i.indnkeyatts AND key.attnum > 0
          ORDER BY key.position
        ) AS columns,
        pg_get_indexdef(ci.oid) AS indexdef
      FROM pg_index i
      JOIN pg_class ci ON ci.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_am am ON am.oid = ci.relam
      WHERE ns.nspname = 'public'
      ORDER BY ci.relname
    `);
    const indexNames = indexes.map((index) => index.indexname);
    report.schema.indexCount = indexNames.length;
    report.schema.missingIndexes = [];
    report.schema.invalidIndexes = [];
    for (const required of REQUIRED_INDEXES) {
      const index = indexes.find((candidate) => candidate.indexname === required.name);
      if (!index) {
        report.schema.missingIndexes.push(required.name);
        continue;
      }
      const actualFields = Array.isArray(index.columns)
        ? index.columns
        : String(index.columns || '{}').slice(1, -1).split(',').filter(Boolean);
      const valid = index.tablename === required.table
        && index.indisvalid && index.indisready
        && index.indisunique === required.unique
        && JSON.stringify(actualFields) === JSON.stringify(required.fields)
        && index.amname === (required.method || 'btree')
        && Boolean(index.predicate) === Boolean(required.partial)
        && Boolean(index.expression) === Boolean(required.expression);
      if (!valid) report.schema.invalidIndexes.push(required.name);
    }
    const generatedIndexCounts = new Map();
    indexNames.forEach((name) => {
      const match = name.match(/^(.*_(?:key|idx))\d+$/);
      if (match) generatedIndexCounts.set(match[1], (generatedIndexCounts.get(match[1]) || 0) + 1);
    });
    report.schema.duplicateGeneratedIndexGroups = [...generatedIndexCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([prefix, count]) => ({ prefix, count }));
    if (report.schema.duplicateGeneratedIndexGroups.length) report.drift.push('duplicate_generated_indexes');
    if (report.schema.missingIndexes.length || report.schema.invalidIndexes.length) report.drift.push('required_indexes');

    const duplicateIndexSets = await select(`
      SELECT t.relname AS table_name, i.indisunique, i.indkey::text AS keys,
        COALESCE(pg_get_expr(i.indpred, i.indrelid), '') AS predicate,
        COALESCE(pg_get_expr(i.indexprs, i.indrelid), '') AS expression,
        i.indclass::text AS opclasses, i.indcollation::text AS collations,
        i.indnullsnotdistinct, i.indisvalid, i.indisready, am.amname,
        ARRAY_AGG(ci.relname ORDER BY ci.relname) AS names
      FROM pg_index i
      JOIN pg_class ci ON ci.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = t.relnamespace
      JOIN pg_am am ON am.oid = ci.relam
      WHERE ns.nspname = 'public' AND NOT i.indisprimary
      GROUP BY t.relname, i.indisunique, i.indkey::text,
        COALESCE(pg_get_expr(i.indpred, i.indrelid), ''),
        COALESCE(pg_get_expr(i.indexprs, i.indrelid), ''),
        i.indclass::text, i.indcollation::text, i.indnullsnotdistinct,
        i.indisvalid, i.indisready, am.amname
      HAVING COUNT(*) > 1
    `);
    report.schema.duplicateIndexSets = duplicateIndexSets;
    if (duplicateIndexSets.length) report.drift.push('structural_duplicate_indexes');

    const countRows = async (key, sql) => {
      const rows = await select(sql);
      const count = Number(rows[0]?.count || 0);
      report.data[key] = count;
      if (count > 0) report.unsafeData.push(key);
    };

    if (columnSet.has('reviews.consultation_id')) {
      await countRows('duplicateReviewConsultations', `
        SELECT COUNT(*) FROM (
          SELECT consultation_id FROM reviews WHERE consultation_id IS NOT NULL
          GROUP BY consultation_id HAVING COUNT(*) > 1
        ) duplicates
      `);
    }
    if (columnSet.has('users.phone')) {
      await countRows('duplicatePhones', `
        SELECT COUNT(*) FROM (
          SELECT phone FROM users WHERE phone IS NOT NULL
          GROUP BY phone HAVING COUNT(*) > 1
        ) duplicates
      `);
    }
    if (columnSet.has('payments.transaction_id')) {
      await countRows('duplicatePaymentTransactions', `
        SELECT COUNT(*) FROM (
          SELECT provider, transaction_id FROM payments WHERE transaction_id IS NOT NULL
          GROUP BY provider, transaction_id HAVING COUNT(*) > 1
        ) duplicates
      `);
    }
    if (columnSet.has('lawyer_profiles.user_id')) {
      await countRows('duplicateLawyerProfiles', `
        SELECT COUNT(*) FROM (
          SELECT user_id FROM lawyer_profiles GROUP BY user_id HAVING COUNT(*) > 1
        ) duplicates
      `);
    }
    if (columnSet.has('subscriptions.user_id')) {
      await countRows('duplicateSubscriptions', `
        SELECT COUNT(*) FROM (
          SELECT user_id FROM subscriptions GROUP BY user_id HAVING COUNT(*) > 1
        ) duplicates
      `);
    }
    if (columnSet.has('withdrawals.amount')) {
      await countRows('nonPositiveWithdrawals', 'SELECT COUNT(*) FROM withdrawals WHERE amount <= 0');
    }
    if (columnSet.has('consultations.problems') && columnSet.has('consultations.question')) {
      await countRows('missingConsultationProblems', `
        SELECT COUNT(*) FROM consultations
        WHERE COALESCE(question, '') <> '' AND (
          problems IS NULL
          OR jsonb_typeof(problems) <> 'array'
          OR problems = '[]'::jsonb
          OR problems = '[null]'::jsonb
          OR problems = '[""]'::jsonb
        )
      `);
    }
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.unsafeData.length) process.exitCode = 3;
  else if (report.drift.length) process.exitCode = 2;
}

main()
  .catch((error) => {
    process.stderr.write(`Database audit failed: ${error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
