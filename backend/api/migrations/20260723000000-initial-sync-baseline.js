'use strict';

const FOUNDATIONAL_TABLES = [
  'users',
  'lawyer_profiles',
  'consultations',
  'ai_conversations',
  'ai_messages',
  'documents',
  'reviews',
  'notifications',
  'specializations',
  'messages',
  'favorite_lawyers',
  'subscriptions',
  'payments',
  'support_tickets',
];

const ADOPTION_COLUMNS = {
  users: ['id', 'email', 'password', 'name', 'phone', 'address', 'settings', 'role', 'avatar',
    'is_verified', 'is_active', 'reset_token', 'reset_token_expiry', 'verification_token', 'created_at', 'updated_at'],
  lawyer_profiles: ['id', 'user_id', 'specialization', 'description', 'experience', 'price', 'rating',
    'reviews_count', 'completed_cases', 'location', 'languages', 'education', 'certificates', 'schedule',
    'is_available', 'balance', 'pending_balance', 'created_at', 'updated_at'],
  consultations: ['id', 'client_id', 'lawyer_id', 'type', 'status', 'question', 'description',
    'preferred_date', 'preferred_time', 'price', 'is_free', 'notes', 'reminder_sent', 'created_at', 'updated_at'],
  ai_conversations: ['id', 'user_id', 'title', 'category', 'created_at', 'updated_at'],
  ai_messages: ['id', 'conversation_id', 'text', 'is_user', 'category', 'created_at', 'updated_at'],
  documents: ['id', 'user_id', 'name', 'type', 'size', 'path', 'status', 'ai_analysis', 'created_at', 'updated_at'],
  reviews: ['id', 'client_id', 'lawyer_id', 'consultation_id', 'rating', 'text', 'reply_text',
    'replied_at', 'helpful_count', 'created_at', 'updated_at'],
  notifications: ['id', 'user_id', 'type', 'title', 'message', 'is_read', 'metadata', 'created_at', 'updated_at'],
  specializations: ['id', 'name', 'name_uz', 'name_en', 'icon', 'is_active', 'lawyer_count', 'created_at', 'updated_at'],
  messages: ['id', 'consultation_id', 'sender_id', 'text', 'is_read', 'created_at', 'updated_at'],
  favorite_lawyers: ['id', 'client_id', 'lawyer_id', 'created_at', 'updated_at'],
  subscriptions: ['id', 'user_id', 'plan', 'expires_at', 'price', 'created_at', 'updated_at'],
  payments: ['id', 'user_id', 'consultation_id', 'amount', 'currency', 'provider', 'status',
    'transaction_id', 'provider_response', 'created_at', 'updated_at'],
  support_tickets: ['id', 'user_id', 'subject', 'message', 'status', 'created_at', 'updated_at'],
};

const ADOPTION_TYPES = {
  users: { id: /^UUID$/i, email: /CHARACTER VARYING|TEXT/i, password: /CHARACTER VARYING|TEXT/i,
    name: /CHARACTER VARYING|TEXT/i, phone: /CHARACTER VARYING|TEXT/i, address: /CHARACTER VARYING|TEXT/i,
    settings: /^JSONB$/i, avatar: /CHARACTER VARYING|TEXT/i, is_verified: /^BOOLEAN$/i,
    is_active: /^BOOLEAN$/i, reset_token: /CHARACTER VARYING|TEXT/i,
    reset_token_expiry: /^TIMESTAMP WITH TIME ZONE$/i, verification_token: /CHARACTER VARYING|TEXT/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  lawyer_profiles: { id: /^UUID$/i, user_id: /^UUID$/i, specialization: /CHARACTER VARYING|TEXT/i,
    description: /^TEXT$/i, experience: /^INTEGER$/i, price: /^INTEGER$/i, rating: /^DOUBLE PRECISION$/i,
    reviews_count: /^INTEGER$/i, completed_cases: /^INTEGER$/i, location: /CHARACTER VARYING|TEXT/i,
    languages: /^ARRAY$/i, education: /^JSONB$/i, certificates: /^JSONB$/i, schedule: /^JSONB$/i,
    is_available: /^BOOLEAN$/i, balance: /DECIMAL|NUMERIC/i, pending_balance: /DECIMAL|NUMERIC/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  consultations: { id: /^UUID$/i, client_id: /^UUID$/i, lawyer_id: /^UUID$/i, question: /^TEXT$/i,
    description: /^TEXT$/i, preferred_date: /^DATE$/i, preferred_time: /CHARACTER VARYING|TEXT/i,
    price: /^INTEGER$/i, is_free: /^BOOLEAN$/i, notes: /^TEXT$/i, reminder_sent: /^BOOLEAN$/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  ai_conversations: { id: /^UUID$/i, user_id: /^UUID$/i, title: /CHARACTER VARYING|TEXT/i,
    category: /CHARACTER VARYING|TEXT/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  ai_messages: { id: /^UUID$/i, conversation_id: /^UUID$/i, text: /^TEXT$/i, is_user: /^BOOLEAN$/i,
    category: /CHARACTER VARYING|TEXT/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  documents: { id: /^UUID$/i, user_id: /^UUID$/i, name: /CHARACTER VARYING|TEXT/i,
    type: /CHARACTER VARYING|TEXT/i, size: /^INTEGER$/i, path: /CHARACTER VARYING|TEXT/i,
    ai_analysis: /^JSONB$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  reviews: { id: /^UUID$/i, client_id: /^UUID$/i, lawyer_id: /^UUID$/i, consultation_id: /^UUID$/i,
    rating: /^INTEGER$/i, text: /^TEXT$/i, reply_text: /^TEXT$/i,
    replied_at: /^TIMESTAMP WITH TIME ZONE$/i, helpful_count: /^INTEGER$/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  notifications: { id: /^UUID$/i, user_id: /^UUID$/i, type: /CHARACTER VARYING|TEXT/i,
    title: /CHARACTER VARYING|TEXT/i, message: /^TEXT$/i, is_read: /^BOOLEAN$/i, metadata: /^JSONB$/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  specializations: { id: /^UUID$/i, name: /CHARACTER VARYING|TEXT/i, name_uz: /CHARACTER VARYING|TEXT/i,
    name_en: /CHARACTER VARYING|TEXT/i, icon: /CHARACTER VARYING|TEXT/i, is_active: /^BOOLEAN$/i,
    lawyer_count: /^INTEGER$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  messages: { id: /^UUID$/i, consultation_id: /^UUID$/i, sender_id: /^UUID$/i, text: /^TEXT$/i,
    is_read: /^BOOLEAN$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  favorite_lawyers: { id: /^UUID$/i, client_id: /^UUID$/i, lawyer_id: /^UUID$/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  subscriptions: { id: /^UUID$/i, user_id: /^UUID$/i, expires_at: /^TIMESTAMP WITH TIME ZONE$/i,
    price: /^INTEGER$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  payments: { id: /^UUID$/i, user_id: /^UUID$/i, consultation_id: /^UUID$/i,
    amount: /DECIMAL|NUMERIC/i, currency: /CHARACTER VARYING|TEXT/i,
    transaction_id: /CHARACTER VARYING|TEXT/i, provider_response: /^JSONB$/i,
    created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
  support_tickets: { id: /^UUID$/i, user_id: /^UUID$/i, subject: /CHARACTER VARYING|TEXT/i,
    message: /^TEXT$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
    updated_at: /^TIMESTAMP WITH TIME ZONE$/i },
};

const ADOPTION_ENUMS = {
  'users.role': ['enum_users_role', ['client', 'lawyer', 'admin']],
  'consultations.status': ['enum_consultations_status', [
    'payment_pending', 'pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled',
  ]],
  'consultations.type': ['enum_consultations_type', ['video', 'chat', 'phone']],
  'documents.status': ['enum_documents_status', ['pending', 'verified', 'issues', 'rejected']],
  'subscriptions.plan': ['enum_subscriptions_plan', ['free', 'basic', 'pro']],
  'payments.provider': ['enum_payments_provider', ['payme', 'click', 'uzcard']],
  'payments.status': ['enum_payments_status', ['pending', 'paid', 'failed', 'refunded']],
  'support_tickets.status': ['enum_support_tickets_status', ['open', 'in_progress', 'closed']],
};

const PAYMENT_EXPANSION = '20260820000000-expand-payments.js';
const PAYMENT_STATUS_EXPANSION_VALUES = ['processing', 'cancelled', 'refund_pending', 'partially_refunded'];

const ADOPTION_NOT_NULL = {
  users: ['id', 'email', 'password', 'name', 'created_at', 'updated_at'],
  lawyer_profiles: ['id', 'specialization', 'created_at', 'updated_at'],
  consultations: ['id', 'question', 'created_at', 'updated_at'],
  ai_conversations: ['id', 'created_at', 'updated_at'],
  ai_messages: ['id', 'text', 'created_at', 'updated_at'],
  documents: ['id', 'name', 'created_at', 'updated_at'],
  reviews: ['id', 'rating', 'created_at', 'updated_at'],
  notifications: ['id', 'type', 'title', 'created_at', 'updated_at'],
  specializations: ['id', 'name', 'created_at', 'updated_at'],
  messages: ['id', 'text', 'created_at', 'updated_at'],
  favorite_lawyers: ['id', 'created_at', 'updated_at'],
  subscriptions: ['id', 'created_at', 'updated_at'],
  payments: ['id', 'amount', 'created_at', 'updated_at'],
  support_tickets: ['id', 'message', 'created_at', 'updated_at'],
};

const ADOPTION_DEFAULTS = {
  'users.settings': '{}', 'users.role': 'client', 'users.is_verified': false, 'users.is_active': true,
  'lawyer_profiles.experience': '0', 'lawyer_profiles.price': '0', 'lawyer_profiles.rating': '0',
  'lawyer_profiles.reviews_count': '0', 'lawyer_profiles.completed_cases': '0',
  'lawyer_profiles.languages': 'ARRAY[uz', 'lawyer_profiles.education': '[]',
  'lawyer_profiles.certificates': '[]', 'lawyer_profiles.schedule': '{}',
  'lawyer_profiles.is_available': true, 'lawyer_profiles.balance': '0',
  'lawyer_profiles.pending_balance': '0',
  'consultations.type': 'video', 'consultations.status': 'pending', 'consultations.price': '0',
  'consultations.is_free': false, 'consultations.reminder_sent': false,
  'ai_conversations.title': 'Новый разговор', 'ai_messages.is_user': true,
  'documents.status': 'pending', 'reviews.helpful_count': '0',
  'notifications.is_read': false, 'notifications.metadata': '{}',
  'specializations.icon': 'Gavel', 'specializations.is_active': true,
  'specializations.lawyer_count': '0', 'messages.is_read': false,
  'subscriptions.plan': 'free', 'subscriptions.price': '0',
  'payments.currency': 'UZS', 'payments.provider': 'payme', 'payments.status': 'pending',
  'payments.provider_response': '{}', 'support_tickets.status': 'open',
};

const ADOPTION_FOREIGN_KEYS = [
  ['lawyer_profiles', 'user_id', 'users', 'id'],
  ['consultations', 'client_id', 'users', 'id'], ['consultations', 'lawyer_id', 'users', 'id'],
  ['ai_conversations', 'user_id', 'users', 'id'],
  ['ai_messages', 'conversation_id', 'ai_conversations', 'id'],
  ['documents', 'user_id', 'users', 'id'],
  ['reviews', 'client_id', 'users', 'id'], ['reviews', 'lawyer_id', 'users', 'id'],
  ['reviews', 'consultation_id', 'consultations', 'id'],
  ['notifications', 'user_id', 'users', 'id'],
  ['messages', 'consultation_id', 'consultations', 'id'], ['messages', 'sender_id', 'users', 'id'],
  ['favorite_lawyers', 'client_id', 'users', 'id'], ['favorite_lawyers', 'lawyer_id', 'users', 'id'],
  ['subscriptions', 'user_id', 'users', 'id'],
  ['payments', 'consultation_id', 'consultations', 'id'], ['payments', 'user_id', 'users', 'id'],
  ['support_tickets', 'user_id', 'users', 'id'],
];

const ADOPTION_UNIQUES = [
  ['users', ['email']],
  ['specializations', ['name']],
  ['favorite_lawyers', ['client_id', 'lawyer_id']],
];

function tableNames(tables) {
  return tables.map((table) => typeof table === 'string' ? table : table.tableName);
}

function assertCompleteContractDefinition() {
  for (const [table, columns] of Object.entries(ADOPTION_COLUMNS)) {
    const uncovered = columns.filter((column) => !ADOPTION_TYPES[table][column]
      && !ADOPTION_ENUMS[`${table}.${column}`]);
    if (uncovered.length) {
      throw new Error(`Incomplete foundational adoption contract; ${table}: ${uncovered.join(', ')}`);
    }
  }
}

async function assertForeignKey(
  queryInterface,
  table,
  column,
  targetTable,
  targetColumn,
  onUpdate = 'c',
  onDelete = 'n'
) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT target.relname AS target_table, target_col.attname AS target_column,
           fk.confupdtype AS on_update, fk.confdeltype AS on_delete
    FROM pg_constraint fk
    JOIN pg_class source ON source.oid = fk.conrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN unnest(fk.conkey) WITH ORDINALITY source_key(attnum, ordinality) ON true
    JOIN unnest(fk.confkey) WITH ORDINALITY target_key(attnum, ordinality)
      ON target_key.ordinality = source_key.ordinality
    JOIN pg_attribute source_col ON source_col.attrelid = source.oid AND source_col.attnum = source_key.attnum
    JOIN pg_class target ON target.oid = fk.confrelid
    JOIN pg_attribute target_col ON target_col.attrelid = target.oid AND target_col.attnum = target_key.attnum
    WHERE namespace.nspname = current_schema() AND fk.contype = 'f'
      AND source.relname = :table AND source_col.attname = :column
  `, { replacements: { table, column } });
  if (rows.length !== 1 || rows[0].target_table !== targetTable || rows[0].target_column !== targetColumn
    || rows[0].on_update !== onUpdate || rows[0].on_delete !== onDelete) {
    throw new Error(`Incompatible foundational schema; ${table}.${column} foreign key differs`);
  }
}

async function enumContract(queryInterface, table, column) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT cols.udt_name, enum_values.value
    FROM information_schema.columns cols
    LEFT JOIN LATERAL (
      SELECT enumlabel AS value
      FROM pg_type type
      JOIN pg_enum enum_value ON enum_value.enumtypid = type.oid
      WHERE type.typname = cols.udt_name
      ORDER BY enum_value.enumsortorder
    ) enum_values ON true
    WHERE cols.table_schema = current_schema()
      AND cols.table_name = :table AND cols.column_name = :column
  `, { replacements: { table, column } });
  return {
    type: rows[0]?.udt_name,
    values: rows.map((row) => row.value).filter(Boolean),
  };
}

async function assertEnumContract(queryInterface, table, column, expectedType, expectedValues) {
  const actual = await enumContract(queryInterface, table, column);
  if (actual.type !== expectedType || JSON.stringify(actual.values) !== JSON.stringify(expectedValues)) {
    throw new Error(`Incompatible foundational schema; ${table}.${column} enum contract differs`);
  }
}

function expectedEnumValues(qualifiedColumn, historicalValues, applied) {
  if (qualifiedColumn === 'payments.status' && applied.has(PAYMENT_EXPANSION)) {
    return [...historicalValues, ...PAYMENT_STATUS_EXPANSION_VALUES];
  }
  return historicalValues;
}

function expectedAllowNull(table, column, applied) {
  if (table === 'lawyer_profiles' && column === 'specialization'
    && applied.has('20260821000000-add-account-capabilities.js')) return true;
  return !ADOPTION_NOT_NULL[table].includes(column);
}

function sameDefault(actual, expected) {
  if (actual === null || actual === undefined) return expected === null;
  return String(actual) === String(expected);
}

async function assertNumericShape(queryInterface, table, column, precision, scale) {
  const [[row]] = await queryInterface.sequelize.query(`
    SELECT numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column
  `, { replacements: { table, column } });
  if (Number(row?.numeric_precision) !== precision || Number(row?.numeric_scale) !== scale) {
    throw new Error(`Incompatible foundational schema; ${table}.${column} numeric shape differs`);
  }
}

async function assertLegacyPaymentsSafe(queryInterface, applied) {
  if (applied.has(PAYMENT_EXPANSION)) return;
  const sequelize = queryInterface.sequelize;
  const [unsafe] = await sequelize.query(`
    SELECT payment.id
    FROM payments payment
    WHERE payment.amount IS NULL OR payment.amount <= 0
       OR (
         payment.consultation_id IS NULL
         AND NOT (COALESCE(payment.provider_response, '{}'::jsonb) ? 'subscription')
       )
       OR (
         payment.consultation_id IS NULL
         AND COALESCE(payment.provider_response, '{}'::jsonb) ? 'subscription'
         AND (SELECT COUNT(*) FROM subscriptions subscription
              WHERE subscription.user_id IS NOT DISTINCT FROM payment.user_id) <> 1
       )
    LIMIT 1
  `);
  if (unsafe.length) throw new Error('Unsafe legacy payments; expansion preflight failed');

  const [duplicates] = await sequelize.query(`
    SELECT provider, transaction_id
    FROM payments
    WHERE transaction_id IS NOT NULL
    GROUP BY provider, transaction_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if (duplicates.length) throw new Error('Unsafe legacy payments; duplicate provider transaction IDs');
}

async function assertAppliedTable(queryInterface, table, contracts, foreignKeys = []) {
  let columns;
  try {
    columns = await queryInterface.describeTable(table);
  } catch (_error) {
    throw new Error(`Incompatible foundational schema; applied migration table ${table} is missing`);
  }
  for (const [column, type] of Object.entries(contracts)) {
    if (!columns[column] || !type.test(columns[column].type)) {
      throw new Error(`Incompatible foundational schema; ${table}.${column} is missing or has wrong type`);
    }
  }
  if (!columns.id.primaryKey) throw new Error(`Incompatible foundational schema; ${table}.id is not a primary key`);
  for (const contract of foreignKeys) await assertForeignKey(queryInterface, table, ...contract);
}

async function assertUnconditionalUnique(queryInterface, table, expectedColumns) {
  const [rows] = await queryInterface.sequelize.query(`
    SELECT index.indisvalid, index.indisready, index.indpred IS NULL AS unconditional,
           array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns
    FROM pg_index index
    JOIN pg_class source ON source.oid = index.indrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, ordinality)
      ON key.ordinality <= index.indnkeyatts
    JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
    WHERE namespace.nspname = current_schema() AND source.relname = :table AND index.indisunique
    GROUP BY index.indexrelid, index.indisvalid, index.indisready, index.indpred
  `, { replacements: { table } });
  const valid = rows.some((row) => row.indisvalid && row.indisready && row.unconditional
    && JSON.stringify(row.columns) === JSON.stringify(expectedColumns));
  if (!valid) {
    throw new Error(`Incompatible foundational schema; ${table} missing unconditional unique (${expectedColumns.join(', ')})`);
  }
}

async function preflightAdoption(queryInterface, existing) {
  assertCompleteContractDefinition();
  const present = FOUNDATIONAL_TABLES.filter((table) => existing.includes(table));
  if (present.length === 0) return false;
  const missingTables = FOUNDATIONAL_TABLES.filter((table) => !existing.includes(table));
  if (missingTables.length) {
    throw new Error(`Partial foundational schema; missing table(s): ${missingTables.join(', ')}`);
  }

  const [metaRows] = await queryInterface.sequelize.query('SELECT name FROM "SequelizeMeta"');
  const applied = new Set(metaRows.map((row) => row.name));

  for (const table of FOUNDATIONAL_TABLES) {
    const columns = await queryInterface.describeTable(table);
    const missingColumns = ADOPTION_COLUMNS[table].filter((column) => !columns[column]);
    if (missingColumns.length) {
      throw new Error(`Partial foundational schema; ${table} missing column(s): ${missingColumns.join(', ')}`);
    }
    for (const [column, pattern] of Object.entries(ADOPTION_TYPES[table])) {
      if (!pattern.test(columns[column].type)) {
        throw new Error(`Incompatible foundational schema; ${table}.${column} has type ${columns[column].type}`);
      }
    }
    for (const column of ADOPTION_COLUMNS[table]) {
      const allowNull = expectedAllowNull(table, column, applied);
      if (columns[column].allowNull !== allowNull) {
        throw new Error(`Incompatible foundational schema; ${table}.${column} nullability differs`);
      }
      const qualified = `${table}.${column}`;
      const expectedDefault = Object.prototype.hasOwnProperty.call(ADOPTION_DEFAULTS, qualified)
        ? ADOPTION_DEFAULTS[qualified]
        : null;
      if (!sameDefault(columns[column].defaultValue, expectedDefault)) {
        throw new Error(`Incompatible foundational schema; ${table}.${column} default differs`);
      }
    }
    if (!columns.id.primaryKey) {
      throw new Error(`Incompatible foundational schema; ${table}.id is not a primary key`);
    }
  }

  await assertNumericShape(queryInterface, 'lawyer_profiles', 'balance', 12, 2);
  await assertNumericShape(queryInterface, 'lawyer_profiles', 'pending_balance', 12, 2);
  await assertNumericShape(queryInterface, 'payments', 'amount', 12, 2);

  for (const [qualifiedColumn, [expectedType, expectedValues]] of Object.entries(ADOPTION_ENUMS)) {
    const [table, column] = qualifiedColumn.split('.');
    await assertEnumContract(queryInterface, table, column, expectedType,
      expectedEnumValues(qualifiedColumn, expectedValues, applied));
  }
  for (const contract of ADOPTION_FOREIGN_KEYS) {
    await assertForeignKey(queryInterface, ...contract);
  }
  for (const [table, columns] of ADOPTION_UNIQUES) {
    await assertUnconditionalUnique(queryInterface, table, columns);
  }
  await assertLegacyPaymentsSafe(queryInterface, applied);
  if (applied.has('20260813000000-add-lawyer-verification-status.js')) {
    const profiles = await queryInterface.describeTable('lawyer_profiles');
    if (!profiles.verification_status) {
      throw new Error('Incompatible foundational schema; lawyer_profiles.verification_status is missing');
    }
    await assertEnumContract(queryInterface, 'lawyer_profiles', 'verification_status',
      'enum_lawyer_profiles_verification_status', ['pending', 'approved', 'rejected']);
  }
  if (applied.has('20260814000000-add-lawyer-documents.js')) {
    await assertAppliedTable(queryInterface, 'lawyer_documents', {
      id: /^UUID$/i, type: /^USER-DEFINED$/i, name: /CHARACTER VARYING|TEXT/i,
      path: /CHARACTER VARYING|TEXT/i, mime_type: /CHARACTER VARYING|TEXT/i,
      size: /^INTEGER$/i, user_id: /^UUID$/i, created_at: /^TIMESTAMP WITH TIME ZONE$/i,
      updated_at: /^TIMESTAMP WITH TIME ZONE$/i,
    }, [['user_id', 'users', 'id', 'c', 'c']]);
    await assertEnumContract(queryInterface, 'lawyer_documents', 'type',
      'enum_lawyer_documents_type', ['diploma', 'license', 'id', 'other']);
  }
  if (applied.has('20260815000000-add-case-documents.js')) {
    await assertAppliedTable(queryInterface, 'case_documents', {
      id: /^UUID$/i, name: /CHARACTER VARYING|TEXT/i, path: /CHARACTER VARYING|TEXT/i,
      mime_type: /CHARACTER VARYING|TEXT/i, size: /^INTEGER$/i,
      consultation_id: /^UUID$/i, uploader_id: /^UUID$/i,
      created_at: /^TIMESTAMP WITH TIME ZONE$/i, updated_at: /^TIMESTAMP WITH TIME ZONE$/i,
    }, [
      ['consultation_id', 'consultations', 'id', 'c', 'c'],
      ['uploader_id', 'users', 'id', 'c', 'n'],
    ]);
  }
  return true;
}

function timestamps(Sequelize) {
  return {
    created_at: { type: Sequelize.DATE, allowNull: false },
    updated_at: { type: Sequelize.DATE, allowNull: false },
  };
}

function uuidPk(Sequelize) {
  return { type: Sequelize.UUID, allowNull: false, primaryKey: true };
}

function fk(Sequelize, table) {
  return {
    type: Sequelize.UUID,
    allowNull: true,
    references: { model: table, key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  };
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const existing = tableNames(await queryInterface.showAllTables());
    if (await preflightAdoption(queryInterface, existing)) return;

    await queryInterface.sequelize.transaction(async (transaction) => {
      const options = { transaction };
      await queryInterface.createTable('users', {
        id: uuidPk(Sequelize),
        email: { type: Sequelize.STRING, allowNull: false, unique: true },
        password: { type: Sequelize.STRING, allowNull: false },
        name: { type: Sequelize.STRING, allowNull: false },
        phone: { type: Sequelize.STRING, allowNull: true },
        address: { type: Sequelize.STRING, allowNull: true },
        settings: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
        role: { type: Sequelize.ENUM('client', 'lawyer', 'admin'), allowNull: true, defaultValue: 'client' },
        avatar: { type: Sequelize.STRING, allowNull: true },
        is_verified: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
        is_active: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: true },
        reset_token: { type: Sequelize.STRING, allowNull: true },
        reset_token_expiry: { type: Sequelize.DATE, allowNull: true },
        verification_token: { type: Sequelize.STRING, allowNull: true },
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('lawyer_profiles', {
        id: uuidPk(Sequelize),
        specialization: { type: Sequelize.STRING, allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        experience: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        price: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        rating: { type: Sequelize.FLOAT, allowNull: true, defaultValue: 0 },
        reviews_count: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        completed_cases: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        location: { type: Sequelize.STRING, allowNull: true },
        languages: { type: Sequelize.ARRAY(Sequelize.STRING), allowNull: true, defaultValue: ['uz', 'ru'] },
        education: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
        certificates: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
        schedule: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
        is_available: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: true },
        balance: { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: 0 },
        pending_balance: { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: 0 },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('consultations', {
        id: uuidPk(Sequelize),
        type: { type: Sequelize.ENUM('video', 'chat', 'phone'), allowNull: true, defaultValue: 'video' },
        status: {
          type: Sequelize.ENUM('payment_pending', 'pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled'),
          allowNull: true,
          defaultValue: 'pending',
        },
        question: { type: Sequelize.TEXT, allowNull: false },
        description: { type: Sequelize.TEXT, allowNull: true },
        preferred_date: { type: Sequelize.DATEONLY, allowNull: true },
        preferred_time: { type: Sequelize.STRING, allowNull: true },
        price: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        is_free: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
        video_room_url: { type: Sequelize.STRING, allowNull: true },
        notes: { type: Sequelize.TEXT, allowNull: true },
        reminder_sent: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
        rating: { type: Sequelize.INTEGER, allowNull: true },
        review: { type: Sequelize.TEXT, allowNull: true },
        client_id: fk(Sequelize, 'users'),
        lawyer_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('ai_conversations', {
        id: uuidPk(Sequelize),
        title: { type: Sequelize.STRING, allowNull: true, defaultValue: 'Новый разговор' },
        category: { type: Sequelize.STRING, allowNull: true },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('ai_messages', {
        id: uuidPk(Sequelize),
        text: { type: Sequelize.TEXT, allowNull: false },
        is_user: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: true },
        category: { type: Sequelize.STRING, allowNull: true },
        conversation_id: fk(Sequelize, 'ai_conversations'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('documents', {
        id: uuidPk(Sequelize),
        name: { type: Sequelize.STRING, allowNull: false },
        type: { type: Sequelize.STRING, allowNull: true },
        size: { type: Sequelize.INTEGER, allowNull: true },
        path: { type: Sequelize.STRING, allowNull: true },
        status: { type: Sequelize.ENUM('pending', 'verified', 'issues', 'rejected'), allowNull: true, defaultValue: 'pending' },
        ai_analysis: { type: Sequelize.JSONB, allowNull: true },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('reviews', {
        id: uuidPk(Sequelize),
        rating: { type: Sequelize.INTEGER, allowNull: false },
        text: { type: Sequelize.TEXT, allowNull: true },
        reply_text: { type: Sequelize.TEXT, allowNull: true },
        replied_at: { type: Sequelize.DATE, allowNull: true },
        helpful_count: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        client_id: fk(Sequelize, 'users'),
        lawyer_id: fk(Sequelize, 'users'),
        consultation_id: fk(Sequelize, 'consultations'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('notifications', {
        id: uuidPk(Sequelize),
        type: { type: Sequelize.STRING, allowNull: false },
        title: { type: Sequelize.STRING, allowNull: false },
        message: { type: Sequelize.TEXT, allowNull: true },
        is_read: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
        metadata: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('specializations', {
        id: uuidPk(Sequelize),
        name: { type: Sequelize.STRING, allowNull: false, unique: true },
        name_uz: { type: Sequelize.STRING, allowNull: true },
        name_en: { type: Sequelize.STRING, allowNull: true },
        icon: { type: Sequelize.STRING, allowNull: true, defaultValue: 'Gavel' },
        is_active: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: true },
        lawyer_count: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('messages', {
        id: uuidPk(Sequelize),
        text: { type: Sequelize.TEXT, allowNull: false },
        is_read: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false },
        consultation_id: fk(Sequelize, 'consultations'),
        sender_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('favorite_lawyers', {
        id: uuidPk(Sequelize),
        client_id: fk(Sequelize, 'users'),
        lawyer_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);
      await queryInterface.addIndex('favorite_lawyers', ['client_id', 'lawyer_id'], {
        unique: true,
        name: 'favorite_lawyers_client_id_lawyer_id',
        transaction,
      });

      await queryInterface.createTable('subscriptions', {
        id: uuidPk(Sequelize),
        plan: { type: Sequelize.ENUM('free', 'basic', 'pro'), allowNull: true, defaultValue: 'free' },
        expires_at: { type: Sequelize.DATE, allowNull: true },
        price: { type: Sequelize.INTEGER, allowNull: true, defaultValue: 0 },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('payments', {
        id: uuidPk(Sequelize),
        amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
        currency: { type: Sequelize.STRING, allowNull: true, defaultValue: 'UZS' },
        provider: { type: Sequelize.ENUM('payme', 'click', 'uzcard'), allowNull: true, defaultValue: 'payme' },
        status: { type: Sequelize.ENUM('pending', 'paid', 'failed', 'refunded'), allowNull: true, defaultValue: 'pending' },
        transaction_id: { type: Sequelize.STRING, allowNull: true },
        provider_response: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
        consultation_id: fk(Sequelize, 'consultations'),
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);

      await queryInterface.createTable('support_tickets', {
        id: uuidPk(Sequelize),
        subject: { type: Sequelize.STRING, allowNull: true },
        message: { type: Sequelize.TEXT, allowNull: false },
        status: { type: Sequelize.ENUM('open', 'in_progress', 'closed'), allowNull: true, defaultValue: 'open' },
        user_id: fk(Sequelize, 'users'),
        ...timestamps(Sequelize),
      }, options);
    });
  },

  async down() {
    // Monotonic adoption baseline: never drop a schema that may predate SequelizeMeta.
  },
};
