const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const { Client } = require('pg');

const apiRoot = path.join(__dirname, '..', '..');
const migrationsDir = path.join(apiRoot, 'migrations');
const PREFIX = 'emaslaxat_session_a_a1_';

const IDS = Object.freeze({
  client: '00000000-0000-4000-8000-000000000001',
  lawyer: '00000000-0000-4000-8000-000000000002',
  admin: '00000000-0000-4000-8000-000000000003',
  profile: '00000000-0000-4000-8000-000000000010',
  completedConsultation: '00000000-0000-4000-8000-000000000020',
  pendingConsultation: '00000000-0000-4000-8000-000000000021',
  payment: '00000000-0000-4000-8000-000000000030',
  push: '00000000-0000-4000-8000-000000000040',
  promo: '00000000-0000-4000-8000-000000000050',
  withdrawal: '00000000-0000-4000-8000-000000000060',
  document: '00000000-0000-4000-8000-000000000070',
  lawyerDocument: '00000000-0000-4000-8000-000000000071',
  caseDocument: '00000000-0000-4000-8000-000000000072',
  review: '00000000-0000-4000-8000-000000000080',
  notification: '00000000-0000-4000-8000-000000000090',
  conversation: '00000000-0000-4000-8000-0000000000a0',
  aiMessage: '00000000-0000-4000-8000-0000000000a1',
  message: '00000000-0000-4000-8000-0000000000b0',
  favorite: '00000000-0000-4000-8000-0000000000c0',
  subscription: '00000000-0000-4000-8000-0000000000d0',
  support: '00000000-0000-4000-8000-0000000000e0',
});

function assertDisposableDatabaseName(name) {
  if (typeof name !== 'string' || !name.startsWith(PREFIX) || !/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing non-A1 database: ${name}`);
  }
}

function canonicalDatabaseTarget(name, env = process.env) {
  assertDisposableDatabaseName(name);
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER || env.USER,
    password: env.DB_PASSWORD || undefined,
    database: name,
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function withMaintenanceClient(name, operation) {
  const target = canonicalDatabaseTarget(name);
  const client = new Client({ ...target, database: process.env.DB_ADMIN_NAME || 'postgres' });
  await client.connect();
  try {
    const identity = await client.query('SELECT current_user, current_database(), inet_server_port() AS port');
    const row = identity.rows[0];
    if (row.current_user !== target.user || Number(row.port) !== target.port) {
      throw new Error(`Refusing mismatched disposable database target for ${name}`);
    }
    return await operation(client, target);
  } finally {
    await client.end();
  }
}

async function existingDatabaseOwner(client, name) {
  const result = await client.query(`
    SELECT pg_get_userbyid(datdba) AS owner
    FROM pg_database WHERE datname = $1
  `, [name]);
  return result.rows[0]?.owner || null;
}

async function dropVerifiedDatabase(client, target) {
  const owner = await existingDatabaseOwner(client, target.database);
  if (!owner) return;
  if (owner !== target.user) {
    throw new Error(`Refusing to drop disposable database owned by ${owner}`);
  }
  await client.query(`DROP DATABASE ${quoteIdentifier(target.database)} WITH (FORCE)`);
}

async function recreateDisposableDatabase(name) {
  return withMaintenanceClient(name, async (client, target) => {
    await dropVerifiedDatabase(client, target);
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)} OWNER ${quoteIdentifier(target.user)}`);
  });
}

async function dropDisposableDatabase(name) {
  return withMaintenanceClient(name, dropVerifiedDatabase);
}

async function dropAllDisposableDatabases(names, dropDatabase) {
  const failures = [];
  for (const name of names) {
    try {
      await dropDatabase(name);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, `Failed to drop ${failures.length} disposable database(s)`);
  }
}

function migrationEnv(name) {
  assertDisposableDatabaseName(name);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DB_NAME: name,
    DB_USER: process.env.DB_USER || process.env.USER,
  };
  delete env.DATABASE_URL;
  return env;
}

function runMigrations(name, extraArgs = []) {
  return spawnSync(process.execPath, [
    path.join(apiRoot, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'),
    'db:migrate',
    ...extraArgs,
  ], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: migrationEnv(name),
  });
}

function connect(name) {
  const target = canonicalDatabaseTarget(name);
  return new Sequelize.Sequelize(
    target.database,
    target.user,
    target.password || null,
    {
      dialect: 'postgres',
      host: target.host,
      port: target.port,
      logging: false,
    }
  );
}

function migrationFilenames() {
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort();
}

const PRE_P1_MIGRATIONS = Object.freeze([
  '20260724000000-remove-dead-consultation-columns.js',
  '20260725000000-remove-dead-consultation-videoroomurl.js',
  '20260726000000-add-review-ishidden.js',
  '20260727000000-add-document-category.js',
  '20260728000000-create-push-subscriptions.js',
  '20260729000000-add-user-2fa.js',
  '20260730000000-add-lawyer-greeting.js',
  '20260731000000-add-user-social-ids.js',
  '20260801000000-add-consultation-duration.js',
  '20260802000000-add-consultation-actual-duration.js',
  '20260803000000-add-consultation-promocode.js',
  '20260804000000-add-user-password-changed-at.js',
  '20260805000000-add-consultation-free-source.js',
  '20260806000000-add-payment-escrow-released.js',
  '20260807000000-add-consultation-loyalty-free-unique.js',
  '20260808000000-dedupe-duplicate-reviews.js',
  '20260808000001-add-reviews-consultation-unique.js',
  '20260809000000-add-support-ticket-response.js',
  '20260810000000-add-consultation-problems.js',
  '20260811000000-add-phone-otps.js',
  '20260812000000-add-consultation-specialization.js',
  '20260813000000-add-lawyer-verification-status.js',
  '20260814000000-add-lawyer-documents.js',
  '20260815000000-add-case-documents.js',
  '20260816000000-add-lawyer-specializations-array.js',
  '20260817000000-add-consultation-billing.js',
  '20260818000000-add-user-phone-unique.js',
  '20260819000000-add-consultation-lawyer-note.js',
]);

const FROZEN_SYNC_ERA_DDL = `
  CREATE TYPE enum_users_role AS ENUM ('client', 'lawyer', 'admin');
  CREATE TYPE enum_lawyer_profiles_verification_status AS ENUM ('pending', 'approved', 'rejected');
  CREATE TYPE enum_consultations_type AS ENUM ('video', 'chat', 'phone');
  CREATE TYPE enum_consultations_status AS ENUM ('payment_pending', 'pending', 'accepted', 'rejected', 'in_progress', 'completed', 'cancelled');
  CREATE TYPE enum_consultations_billing_status AS ENUM ('none', 'held', 'charged', 'released', 'failed');
  CREATE TYPE enum_documents_status AS ENUM ('pending', 'verified', 'issues', 'rejected');
  CREATE TYPE enum_subscriptions_plan AS ENUM ('free', 'basic', 'pro');
  CREATE TYPE enum_payments_provider AS ENUM ('payme', 'click', 'uzcard');
  CREATE TYPE enum_payments_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
  CREATE TYPE enum_support_tickets_status AS ENUM ('open', 'in_progress', 'closed');
  CREATE TYPE enum_lawyer_documents_type AS ENUM ('diploma', 'license', 'id', 'other');
  CREATE TYPE enum_withdrawals_status AS ENUM ('pending', 'paid', 'failed', 'cancelled');

  CREATE TABLE users (
    id uuid PRIMARY KEY, email varchar(255) NOT NULL UNIQUE, password varchar(255) NOT NULL,
    name varchar(255) NOT NULL, phone varchar(255), address varchar(255), settings jsonb DEFAULT '{}'::jsonb,
    role enum_users_role DEFAULT 'client', avatar varchar(255), is_verified boolean DEFAULT false,
    is_active boolean DEFAULT true, reset_token varchar(255), reset_token_expiry timestamptz,
    verification_token varchar(255), password_changed_at timestamptz, google_id varchar(255),
    telegram_id varchar(255), two_factor_secret varchar(255), two_factor_enabled boolean DEFAULT false,
    two_factor_backup_codes jsonb DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE UNIQUE INDEX users_phone_unique ON users(phone) WHERE phone IS NOT NULL;

  CREATE TABLE lawyer_profiles (
    id uuid PRIMARY KEY, specialization varchar(255) NOT NULL, specializations varchar(255)[] DEFAULT ARRAY[]::varchar(255)[],
    description text, greeting text, experience integer DEFAULT 0, price integer DEFAULT 0,
    rating double precision DEFAULT 0, reviews_count integer DEFAULT 0, completed_cases integer DEFAULT 0,
    location varchar(255), languages varchar(255)[] DEFAULT ARRAY['uz','ru']::varchar(255)[],
    education jsonb DEFAULT '[]'::jsonb, certificates jsonb DEFAULT '[]'::jsonb, schedule jsonb DEFAULT '{}'::jsonb,
    is_available boolean DEFAULT true, balance numeric(12,2) DEFAULT 0, pending_balance numeric(12,2) DEFAULT 0,
    verification_status enum_lawyer_profiles_verification_status DEFAULT 'pending', rejection_reason text,
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );

  CREATE TABLE consultations (
    id uuid PRIMARY KEY, type enum_consultations_type DEFAULT 'video', status enum_consultations_status DEFAULT 'pending',
    question text NOT NULL, problems jsonb DEFAULT '[]'::jsonb, specialization varchar(255), description text,
    preferred_date date, preferred_time varchar(255), duration integer DEFAULT 60, actual_duration integer,
    price integer DEFAULT 0, is_free boolean DEFAULT false, promo_code varchar(255), free_source varchar(255), notes text,
    lawyer_note text, reminder_sent boolean DEFAULT false, call_started_at timestamptz, charged_at timestamptz,
    billing_status enum_consultations_billing_status DEFAULT 'none',
    client_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    lawyer_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE UNIQUE INDEX consultations_loyalty_free_unique ON consultations(client_id)
    WHERE free_source = 'loyalty' AND status <> 'rejected';

  CREATE TABLE ai_conversations (
    id uuid PRIMARY KEY, title varchar(255) DEFAULT 'Новый разговор', category varchar(255),
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE ai_messages (
    id uuid PRIMARY KEY, text text NOT NULL, is_user boolean DEFAULT true, category varchar(255),
    conversation_id uuid REFERENCES ai_conversations(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE documents (
    id uuid PRIMARY KEY, name varchar(255) NOT NULL, type varchar(255), size integer, path varchar(255),
    status enum_documents_status DEFAULT 'pending', ai_analysis jsonb, category varchar(255),
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE reviews (
    id uuid PRIMARY KEY, rating integer NOT NULL, text text, is_hidden boolean DEFAULT false,
    reply_text text, replied_at timestamptz, helpful_count integer DEFAULT 0,
    client_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    lawyer_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    consultation_id uuid REFERENCES consultations(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE UNIQUE INDEX reviews_consultation_id_unique ON reviews(consultation_id);
  CREATE TABLE notifications (
    id uuid PRIMARY KEY, type varchar(255) NOT NULL, title varchar(255) NOT NULL, message text,
    is_read boolean DEFAULT false, metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE specializations (
    id uuid PRIMARY KEY, name varchar(255) NOT NULL UNIQUE, name_uz varchar(255), name_en varchar(255),
    icon varchar(255) DEFAULT 'Gavel', is_active boolean DEFAULT true, lawyer_count integer DEFAULT 0,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE messages (
    id uuid PRIMARY KEY, text text NOT NULL, is_read boolean DEFAULT false,
    consultation_id uuid REFERENCES consultations(id) ON UPDATE CASCADE ON DELETE SET NULL,
    sender_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE favorite_lawyers (
    id uuid PRIMARY KEY, client_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    lawyer_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    CONSTRAINT favorite_lawyers_client_id_lawyer_id UNIQUE (client_id, lawyer_id)
  );
  CREATE TABLE subscriptions (
    id uuid PRIMARY KEY, plan enum_subscriptions_plan DEFAULT 'free', expires_at timestamptz, price integer DEFAULT 0,
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE payments (
    id uuid PRIMARY KEY, amount numeric(12,2) NOT NULL, currency varchar(255) DEFAULT 'UZS',
    provider enum_payments_provider DEFAULT 'payme', status enum_payments_status DEFAULT 'pending',
    transaction_id varchar(255), provider_response jsonb DEFAULT '{}'::jsonb,
    escrow_released boolean NOT NULL DEFAULT false,
    consultation_id uuid REFERENCES consultations(id) ON UPDATE CASCADE ON DELETE SET NULL,
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE support_tickets (
    id uuid PRIMARY KEY, subject varchar(255), message text NOT NULL, status enum_support_tickets_status DEFAULT 'open',
    response text, responded_at timestamptz, user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE push_subscriptions (
    id uuid PRIMARY KEY, "userId" uuid NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    endpoint text NOT NULL UNIQUE, keys jsonb NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
  );
  CREATE TABLE phone_otps (
    id uuid PRIMARY KEY, phone varchar(255) NOT NULL UNIQUE, code varchar(255) NOT NULL,
    expires_at timestamptz NOT NULL, attempts integer DEFAULT 0,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE lawyer_documents (
    id uuid PRIMARY KEY, type enum_lawyer_documents_type DEFAULT 'other', name varchar(255) NOT NULL,
    path varchar(255) NOT NULL, mime_type varchar(255), size integer,
    user_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE INDEX lawyer_documents_user_id ON lawyer_documents(user_id);
  CREATE TABLE case_documents (
    id uuid PRIMARY KEY, name varchar(255) NOT NULL, path varchar(255) NOT NULL, mime_type varchar(255), size integer,
    consultation_id uuid REFERENCES consultations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    uploader_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE INDEX case_documents_consultation_id ON case_documents(consultation_id);
  CREATE TABLE promos (
    id uuid PRIMARY KEY, code varchar(255) NOT NULL UNIQUE, discount_percent integer NOT NULL,
    is_active boolean DEFAULT true, expires_at timestamptz, usage_limit integer, used_count integer DEFAULT 0,
    min_amount integer DEFAULT 0, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE withdrawals (
    id uuid PRIMARY KEY, amount numeric(12,2) NOT NULL, status enum_withdrawals_status DEFAULT 'pending',
    provider varchar(255) DEFAULT 'manual', note text,
    lawyer_id uuid REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
  );
  CREATE TABLE "SequelizeMeta" (name varchar(255) NOT NULL PRIMARY KEY UNIQUE);
`;

async function createRepresentativeDatabase(name) {
  const sequelize = connect(name);
  try {
    await sequelize.query(FROZEN_SYNC_ERA_DDL);
    await sequelize.getQueryInterface().bulkInsert('SequelizeMeta', PRE_P1_MIGRATIONS.map((name) => ({ name })));

    await sequelize.query(`
      INSERT INTO users
        (id, email, password, name, phone, role, is_verified, is_active, created_at, updated_at)
      VALUES
        (:client, 'a1-client@example.test', 'hash', 'A1 Client', '+998901110001', 'client', true, true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        (:lawyer, 'a1-lawyer@example.test', 'hash', 'A1 Lawyer', '+998901110002', 'lawyer', true, true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        (:admin, 'a1-admin@example.test', 'hash', 'A1 Admin', '+998901110003', 'admin', true, true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      INSERT INTO lawyer_profiles
        (id, user_id, specialization, specializations, description, price, rating, reviews_count,
         schedule, is_available, balance, pending_balance, verification_status, created_at, updated_at)
      VALUES
        (:profile, :lawyer, 'civil', ARRAY['civil']::varchar(255)[], 'Representative lawyer',
         125000, 4.8, 1, '{"mon":{"enabled":true}}'::jsonb, true, 500000, 125000,
         'approved', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      INSERT INTO consultations
        (id, client_id, lawyer_id, type, status, question, price, is_free, reminder_sent,
         duration, actual_duration, free_source, problems, specialization, billing_status,
         lawyer_note, created_at, updated_at)
      VALUES
        (:completedConsultation, :client, :lawyer, 'video', 'completed', 'Completed representative case',
         125000, false, true, 60, 1800, NULL, '["Completed representative case"]'::jsonb,
         'civil', 'released', 'private note', '2026-02-01T00:00:00Z', '2026-02-01T01:00:00Z'),
        (:pendingConsultation, :client, :lawyer, 'chat', 'pending', 'Pending representative case',
         90000, false, false, 30, NULL, NULL, '["Pending representative case"]'::jsonb,
         'civil', 'none', NULL, '2026-02-02T00:00:00Z', '2026-02-02T00:00:00Z');

      INSERT INTO subscriptions (id, user_id, plan, price, created_at, updated_at)
      VALUES (:subscription, :client, 'free', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

      INSERT INTO payments
        (id, user_id, consultation_id, amount, currency, provider, status, transaction_id,
         provider_response, escrow_released, created_at, updated_at)
      VALUES
        (:payment, :client, :completedConsultation, 125000.00, 'UZS', 'payme', 'paid',
         'a1-provider-transaction', '{"legacy":true}'::jsonb, true,
         '2026-02-01T00:00:00Z', '2026-02-01T00:05:00Z');

      INSERT INTO reviews
        (id, client_id, lawyer_id, consultation_id, rating, text, is_hidden, created_at, updated_at)
      VALUES
        (:review, :client, :lawyer, :completedConsultation, 5, 'Representative review', false,
         '2026-02-01T02:00:00Z', '2026-02-01T02:00:00Z');

      INSERT INTO documents (id, user_id, name, type, size, path, status, category, created_at, updated_at)
      VALUES (:document, :client, 'contract.pdf', 'application/pdf', 128, '/legacy/contract.pdf',
              'pending', 'contract', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO lawyer_documents (id, user_id, type, name, path, mime_type, size, created_at, updated_at)
      VALUES (:lawyerDocument, :lawyer, 'license', 'license.pdf', '/legacy/license.pdf',
              'application/pdf', 256, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO case_documents
        (id, consultation_id, uploader_id, name, path, mime_type, size, created_at, updated_at)
      VALUES (:caseDocument, :completedConsultation, :client, 'case.pdf', '/legacy/case.pdf',
              'application/pdf', 512, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');

      INSERT INTO notifications (id, user_id, type, title, message, metadata, created_at, updated_at)
      VALUES (:notification, :client, 'consultation', 'Representative notification', 'Preserve me',
              '{"fixture":true}'::jsonb, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO ai_conversations (id, user_id, title, category, created_at, updated_at)
      VALUES (:conversation, :client, 'Representative AI chat', 'civil', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO ai_messages (id, conversation_id, text, is_user, category, created_at, updated_at)
      VALUES (:aiMessage, :conversation, 'Representative question', true, 'civil',
              '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO messages (id, consultation_id, sender_id, text, is_read, created_at, updated_at)
      VALUES (:message, :completedConsultation, :client, 'Representative chat message', true,
              '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO favorite_lawyers (id, client_id, lawyer_id, created_at, updated_at)
      VALUES (:favorite, :client, :lawyer, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
      INSERT INTO support_tickets (id, user_id, subject, message, status, response, responded_at, created_at, updated_at)
      VALUES (:support, :client, 'Representative support', 'Preserve ticket', 'closed', 'Resolved',
              '2026-02-02T00:00:00Z', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z');

      INSERT INTO promos
        (id, code, discount_percent, is_active, usage_limit, used_count, min_amount, created_at, updated_at)
      VALUES (:promo, 'A1KEEP10', 10, true, 20, 3, 50000,
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO withdrawals
        (id, lawyer_id, amount, status, provider, note, created_at, updated_at)
      VALUES (:withdrawal, :lawyer, 75000.00, 'pending', 'manual', 'Representative withdrawal',
              '2026-02-03T00:00:00Z', '2026-02-03T00:00:00Z');
      INSERT INTO push_subscriptions
        (id, "userId", endpoint, keys, "createdAt", "updatedAt")
      VALUES (:push, :client, 'https://push.example.test/a1',
              '{"p256dh":"fixture-p256dh","auth":"fixture-auth"}'::jsonb,
              '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
    `, { replacements: IDS });
  } finally {
    await sequelize.close();
  }
}

async function createRepresentativeScaleData(name) {
  const sequelize = connect(name);
  try {
    await sequelize.query(`
      INSERT INTO users
        (id, email, password, name, phone, role, is_verified, is_active, created_at, updated_at)
      SELECT ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        'scale-lawyer-' || lpad(value::text, 3, '0') || '@example.test', 'hash',
        'Scale Lawyer ' || value, '+99893' || lpad((1000000 + value)::text, 7, '0'),
        'lawyer', true, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
      FROM generate_series(1, 50) AS value;

      INSERT INTO users
        (id, email, password, name, phone, role, is_verified, is_active, created_at, updated_at)
      SELECT ('20000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        'scale-client-' || lpad(value::text, 3, '0') || '@example.test', 'hash',
        'Scale Client ' || value, '+99894' || lpad((2000000 + value)::text, 7, '0'),
        'client', true, true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
      FROM generate_series(1, 200) AS value;

      INSERT INTO lawyer_profiles
        (id, user_id, specialization, specializations, description, price, rating, reviews_count,
         schedule, is_available, balance, pending_balance, verification_status, created_at, updated_at)
      SELECT ('30000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        ('10000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        'civil', ARRAY['civil']::varchar(255)[], 'Generated scale lawyer', 100000 + value,
        4.5, 0, '{}'::jsonb, true, 0, 0, 'approved',
        '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'
      FROM generate_series(1, 50) AS value;

      INSERT INTO consultations
        (id, client_id, lawyer_id, type, status, question, problems, specialization, price,
         is_free, reminder_sent, duration, billing_status, created_at, updated_at)
      SELECT ('40000000-0000-4000-8000-' || lpad(value::text, 12, '0'))::uuid,
        ('20000000-0000-4000-8000-' || lpad((((value - 1) % 200) + 1)::text, 12, '0'))::uuid,
        ('10000000-0000-4000-8000-' || lpad((((value - 1) % 50) + 1)::text, 12, '0'))::uuid,
        CASE WHEN value % 2 = 0 THEN 'video'::enum_consultations_type ELSE 'chat'::enum_consultations_type END,
        'pending', 'Scale consultation ' || lpad(value::text, 4, '0'), '[]'::jsonb,
        'civil', 100000 + value, false, false, 60, 'none',
        '2026-03-01T00:00:00Z'::timestamptz + value * interval '1 minute',
        '2026-03-01T00:00:00Z'::timestamptz + value * interval '1 minute'
      FROM generate_series(1, 1000) AS value;
    `);
  } finally {
    await sequelize.close();
  }
}

async function readRepresentativeScaleSnapshot(name) {
  const sequelize = connect(name);
  try {
    const [[row]] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM users WHERE email LIKE 'scale-lawyer-%@example.test') AS lawyers,
        (SELECT COUNT(*)::integer FROM users WHERE email LIKE 'scale-client-%@example.test') AS clients,
        (SELECT COUNT(*)::integer FROM consultations WHERE question LIKE 'Scale consultation %') AS consultations,
        (SELECT MIN(id::text) FROM users WHERE email LIKE 'scale-lawyer-%@example.test') AS first_lawyer_id,
        (SELECT MAX(id::text) FROM users WHERE email LIKE 'scale-lawyer-%@example.test') AS last_lawyer_id,
        (SELECT MIN(id::text) FROM users WHERE email LIKE 'scale-client-%@example.test') AS first_client_id,
        (SELECT MAX(id::text) FROM users WHERE email LIKE 'scale-client-%@example.test') AS last_client_id,
        (SELECT MIN(id::text) FROM consultations WHERE question LIKE 'Scale consultation %') AS first_consultation_id,
        (SELECT MAX(id::text) FROM consultations WHERE question LIKE 'Scale consultation %') AS last_consultation_id
    `);
    return {
      lawyers: row.lawyers,
      clients: row.clients,
      consultations: row.consultations,
      firstLawyerId: row.first_lawyer_id,
      lastLawyerId: row.last_lawyer_id,
      firstClientId: row.first_client_id,
      lastClientId: row.last_client_id,
      firstConsultationId: row.first_consultation_id,
      lastConsultationId: row.last_consultation_id,
    };
  } finally {
    await sequelize.close();
  }
}

async function pushColumnNames(sequelize) {
  const [rows] = await sequelize.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'push_subscriptions'
    ORDER BY column_name
  `);
  return rows.map((row) => row.column_name);
}

async function readRepresentativeSnapshot(name) {
  const sequelize = connect(name);
  try {
    const pushColumns = await pushColumnNames(sequelize);
    const userColumn = pushColumns.includes('user_id') ? 'user_id' : '"userId"';
    const createdColumn = pushColumns.includes('created_at') ? 'created_at' : '"createdAt"';
    const updatedColumn = pushColumns.includes('updated_at') ? 'updated_at' : '"updatedAt"';
    const [users] = await sequelize.query('SELECT id FROM users ORDER BY id');
    const [consultations] = await sequelize.query(`
      SELECT id, client_id, lawyer_id, type, status, question, problems, specialization,
             description, preferred_date, preferred_time, duration, actual_duration, price,
             is_free, promo_code, free_source, notes, lawyer_note, reminder_sent,
             call_started_at, charged_at, billing_status, created_at, updated_at
      FROM consultations ORDER BY id
    `);
    const [paymentColumnRows] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'payments'
    `);
    const paymentColumns = new Set(paymentColumnRows.map((row) => row.column_name));
    const optionalPaymentColumn = (name) => paymentColumns.has(name) ? name : `NULL AS ${name}`;
    const [[payment]] = await sequelize.query(`
      SELECT id, user_id, consultation_id, amount, currency, provider, status, transaction_id,
             provider_response, escrow_released, created_at, updated_at,
              ${optionalPaymentColumn('amount_tiyin')},
              ${optionalPaymentColumn('purpose')},
              ${optionalPaymentColumn('provider_transaction_id')},
              ${optionalPaymentColumn('provider_data')}
      FROM payments WHERE id = :id
    `, { replacements: { id: IDS.payment } });
    const [[push]] = await sequelize.query(`
      SELECT id, ${userColumn} AS user_id, endpoint, keys,
             ${createdColumn} AS created_at, ${updatedColumn} AS updated_at
      FROM push_subscriptions WHERE id = :id
    `, { replacements: { id: IDS.push } });
    const [[promo]] = await sequelize.query(`
      SELECT id, code, discount_percent, is_active, usage_limit, used_count, min_amount
      FROM promos WHERE id = :id
    `, { replacements: { id: IDS.promo } });
    const [[withdrawal]] = await sequelize.query(`
      SELECT id, lawyer_id, amount, status, provider, note FROM withdrawals WHERE id = :id
    `, { replacements: { id: IDS.withdrawal } });
    const [[document]] = await sequelize.query('SELECT path FROM documents WHERE id = :id', {
      replacements: { id: IDS.document },
    });
    const [[profile]] = await sequelize.query(`
      SELECT user_id, specialization, specializations, description, price, rating, reviews_count,
             completed_cases, schedule, is_available, balance, pending_balance,
             verification_status, created_at, updated_at
      FROM lawyer_profiles WHERE id = :id
    `, { replacements: { id: IDS.profile } });
    const [[review]] = await sequelize.query(`
      SELECT client_id, lawyer_id, consultation_id, rating, text, is_hidden, created_at, updated_at
      FROM reviews WHERE id = :id
    `, { replacements: { id: IDS.review } });
    const [[notification]] = await sequelize.query(`
      SELECT user_id, type, title, message, metadata
      FROM notifications WHERE id = :id
    `, { replacements: { id: IDS.notification } });
    const [[conversation]] = await sequelize.query(`
      SELECT user_id, title, category FROM ai_conversations WHERE id = :id
    `, { replacements: { id: IDS.conversation } });
    const [[aiMessage]] = await sequelize.query(`
      SELECT conversation_id, text, is_user, category FROM ai_messages WHERE id = :id
    `, { replacements: { id: IDS.aiMessage } });
    const [[message]] = await sequelize.query(`
      SELECT consultation_id, sender_id, text, is_read FROM messages WHERE id = :id
    `, { replacements: { id: IDS.message } });
    const [[favorite]] = await sequelize.query(`
      SELECT client_id, lawyer_id FROM favorite_lawyers WHERE id = :id
    `, { replacements: { id: IDS.favorite } });
    const [[subscription]] = await sequelize.query(`
      SELECT user_id, plan, price FROM subscriptions WHERE id = :id
    `, { replacements: { id: IDS.subscription } });
    const [[support]] = await sequelize.query(`
      SELECT user_id, subject, message, status, response FROM support_tickets WHERE id = :id
    `, { replacements: { id: IDS.support } });
    const [[lawyerDocument]] = await sequelize.query(`
      SELECT user_id, type, name, path, mime_type, size FROM lawyer_documents WHERE id = :id
    `, { replacements: { id: IDS.lawyerDocument } });
    const [[caseDocument]] = await sequelize.query(`
      SELECT consultation_id, uploader_id, name, path, mime_type, size
      FROM case_documents WHERE id = :id
    `, { replacements: { id: IDS.caseDocument } });
    const rowCountTables = [
      'users', 'lawyer_profiles', 'consultations', 'payments', 'reviews', 'documents',
      'lawyer_documents', 'case_documents', 'notifications', 'ai_conversations', 'ai_messages',
      'messages', 'favorite_lawyers', 'subscriptions', 'support_tickets', 'promos', 'withdrawals',
      'push_subscriptions',
    ];
    const rowCounts = {};
    for (const table of rowCountTables) {
      const [[row]] = await sequelize.query(`SELECT COUNT(*)::integer AS count FROM ${table}`);
      rowCounts[table] = row.count;
    }
    const [meta] = await sequelize.query('SELECT name FROM "SequelizeMeta" ORDER BY name');
    const [[pushContract]] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*)::integer FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'push_subscriptions'
            AND column_name IN ('userId', 'createdAt', 'updatedAt')) AS camel_columns,
        (SELECT COUNT(*)::integer FROM pg_index index
          JOIN pg_class source ON source.oid = index.indrelid
          JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
          JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, ordinality)
            ON key.ordinality <= index.indnkeyatts
          JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
          WHERE namespace.nspname = current_schema() AND source.relname = 'push_subscriptions'
            AND attribute.attname = 'endpoint' AND index.indisunique AND index.indisvalid
            AND index.indisready AND index.indpred IS NULL AND index.indnkeyatts = 1) AS endpoint_unique_indexes,
        (SELECT COUNT(*)::integer FROM pg_constraint fk
          JOIN pg_class source ON source.oid = fk.conrelid
          JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
          JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = ANY(fk.conkey)
          WHERE namespace.nspname = current_schema() AND source.relname = 'push_subscriptions'
            AND attribute.attname = 'user_id' AND fk.contype = 'f'
            AND fk.confupdtype = 'c' AND fk.confdeltype = 'c') AS user_foreign_keys,
        (SELECT COUNT(*)::integer FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'push_subscriptions'
            AND column_name IN ('user_id', 'created_at', 'updated_at') AND is_nullable = 'NO'
            AND ((column_name = 'user_id' AND data_type = 'uuid')
              OR (column_name <> 'user_id' AND data_type = 'timestamp with time zone'))) AS required_snake_columns
    `);
    return {
      userIds: users.map((row) => row.id),
      consultationIds: consultations.map((row) => row.id),
      consultations,
      payment,
      paymentStable: {
        id: payment.id,
        user_id: payment.user_id,
        consultation_id: payment.consultation_id,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        status: payment.status,
        transaction_id: payment.transaction_id,
        provider_response: payment.provider_response,
        escrow_released: payment.escrow_released,
        created_at: payment.created_at,
        updated_at: payment.updated_at,
      },
      paymentBackfill: {
        amount_tiyin: payment.amount_tiyin,
        purpose: payment.purpose,
        provider_transaction_id: payment.provider_transaction_id,
        provider_data: payment.provider_data,
      },
      push,
      promo,
      withdrawal,
      documentPath: document.path,
      profile,
      preserved: {
        profile,
        review,
        notification,
        conversation,
        aiMessage,
        message,
        favorite,
        subscription,
        support,
        lawyerDocument,
        caseDocument,
      },
      rowCounts,
      pushColumns,
      pushContract: {
        camelColumns: pushContract.camel_columns,
        endpointUniqueIndexes: pushContract.endpoint_unique_indexes,
        userForeignKeys: pushContract.user_foreign_keys,
        requiredSnakeColumns: pushContract.required_snake_columns,
      },
      migrations: meta.map((row) => row.name),
    };
  } finally {
    await sequelize.close();
  }
}

async function addConflictingCamelPushOwner(name) {
  const sequelize = connect(name);
  try {
    await sequelize.query(`
      ALTER TABLE push_subscriptions ADD COLUMN "userId" uuid;
      UPDATE push_subscriptions SET "userId" = :admin WHERE id = :push
    `, { replacements: { admin: IDS.admin, push: IDS.push } });
  } finally {
    await sequelize.close();
  }
}

async function runBridge(name, bridge) {
  const sequelize = connect(name);
  try {
    return await bridge.up(sequelize.getQueryInterface(), Sequelize);
  } finally {
    await sequelize.close();
  }
}

async function executeSql(name, sql) {
  const sequelize = connect(name);
  try {
    await sequelize.query(sql);
  } finally {
    await sequelize.close();
  }
}

async function queryRows(name, sql) {
  const sequelize = connect(name);
  try {
    const [rows] = await sequelize.query(sql);
    return rows;
  } finally {
    await sequelize.close();
  }
}

async function readPushConflictState(name) {
  const sequelize = connect(name);
  try {
    const columns = await pushColumnNames(sequelize);
    const [[row]] = await sequelize.query(`
      SELECT user_id AS snake_user_id, "userId" AS camel_user_id
      FROM push_subscriptions WHERE id = :id
    `, { replacements: { id: IDS.push } });
    return {
      snakeUserId: row.snake_user_id,
      camelUserId: row.camel_user_id,
      hasCamelUserId: columns.includes('userId'),
    };
  } finally {
    await sequelize.close();
  }
}

module.exports = {
  IDS,
  canonicalDatabaseTarget,
  recreateDisposableDatabase,
  dropDisposableDatabase,
  dropAllDisposableDatabases,
  runMigrations,
  migrationFilenames,
  createRepresentativeDatabase,
  createRepresentativeScaleData,
  readRepresentativeScaleSnapshot,
  readRepresentativeSnapshot,
  addConflictingCamelPushOwner,
  runBridge,
  executeSql,
  queryRows,
  readPushConflictState,
};
