const Sequelize = require('sequelize');
const migration = require('../migrations/20260824000000-create-authorization-evidence-events');
const { resetDb, models } = require('./helpers');
const { createAuthorizationEvidenceRecorder } = require('../src/services/authorizationEvidence');

const { sequelize } = models;
const { AuthorizationEvidenceEvent } = models;
const queryInterface = sequelize.getQueryInterface();

async function evidenceIndexKeys() {
  const [rows] = await sequelize.query(`
    SELECT index_class.relname AS name,
           array_agg(attribute.attname::text ORDER BY key.ordinality) AS columns,
           index.indpred IS NULL AS unconditional,
           index.indnkeyatts = index.indnatts AS no_includes
    FROM pg_index index
    JOIN pg_class source ON source.oid = index.indrelid
    JOIN pg_class index_class ON index_class.oid = index.indexrelid
    JOIN pg_namespace namespace ON namespace.oid = source.relnamespace
    JOIN unnest(index.indkey) WITH ORDINALITY key(attnum, ordinality)
      ON key.ordinality <= index.indnkeyatts
    JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum
    WHERE namespace.nspname = current_schema()
      AND source.relname = 'authorization_evidence_events'
      AND index_class.relname IN (
        'authorization_evidence_events_deployment_time_idx',
        'authorization_evidence_events_surface_mode_time_idx'
      )
    GROUP BY index.indexrelid, index_class.relname, index.indpred, index.indnkeyatts, index.indnatts
    ORDER BY index_class.relname
  `);
  return rows;
}

test('authorization evidence migration is additive, idempotent, and preserves legacy role', async () => {
  await resetDb();
  await queryInterface.dropTable('authorization_evidence_events');

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  const evidence = await queryInterface.describeTable('authorization_evidence_events');
  const users = await queryInterface.describeTable('users');
  expect(evidence).toEqual(expect.objectContaining({
    event_id: expect.any(Object), observed_at: expect.any(Object), surface: expect.any(Object),
    legacy_allowed: expect.any(Object), capability_allowed: expect.any(Object),
  }));
  expect(users.role).toEqual(expect.any(Object));
  await migration.down(queryInterface, Sequelize);
  await expect(queryInterface.describeTable('authorization_evidence_events')).resolves.toEqual(expect.any(Object));
});

test('authorization evidence migration repairs an empty partial table to the exact contract', async () => {
  await resetDb();
  await queryInterface.dropTable('authorization_evidence_events');
  await sequelize.query('CREATE TABLE authorization_evidence_events (event_id varchar(160) NOT NULL)');

  await migration.up(queryInterface, Sequelize);

  const columns = await queryInterface.describeTable('authorization_evidence_events');
  expect(Object.keys(columns).sort()).toEqual([
    'authorization_mode', 'capability_allowed', 'channel', 'commit_sha', 'config_digest',
    'created_at', 'deployment_id', 'event_id', 'legacy_allowed', 'migration_head', 'mode',
    'observed_at', 'schema_version', 'service_id', 'surface', 'type',
  ]);
  expect(columns.event_id).toEqual(expect.objectContaining({ type: 'CHARACTER VARYING(160)', allowNull: false, primaryKey: true }));
  expect(columns.schema_version).toEqual(expect.objectContaining({ type: 'SMALLINT', allowNull: false, defaultValue: '1' }));
  expect(columns.created_at.allowNull).toBe(false);
  expect(String(columns.created_at.defaultValue)).toMatch(/CURRENT_TIMESTAMP|now\(\)/i);
  expect(await evidenceIndexKeys()).toEqual([
    {
      name: 'authorization_evidence_events_deployment_time_idx',
      columns: ['deployment_id', 'observed_at'], unconditional: true, no_includes: true,
    },
    {
      name: 'authorization_evidence_events_surface_mode_time_idx',
      columns: ['surface', 'mode', 'observed_at'], unconditional: true, no_includes: true,
    },
  ]);
});

test('authorization evidence migration refuses incompatible partial columns atomically', async () => {
  await resetDb();
  await queryInterface.dropTable('authorization_evidence_events');
  await sequelize.query(`
    CREATE TABLE authorization_evidence_events (
      event_id varchar(160) NOT NULL,
      mode integer
    )
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/mode.*type|incompatible/i);

  const columns = await queryInterface.describeTable('authorization_evidence_events');
  expect(Object.keys(columns).sort()).toEqual(['event_id', 'mode']);
});

test('authorization evidence migration refuses missing required data on a populated partial table', async () => {
  await resetDb();
  await queryInterface.dropTable('authorization_evidence_events');
  await sequelize.query(`
    CREATE TABLE authorization_evidence_events (event_id varchar(160) PRIMARY KEY);
    INSERT INTO authorization_evidence_events (event_id) VALUES ('existing-event')
  `);

  await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(/populated|required|missing/i);
  const columns = await queryInterface.describeTable('authorization_evidence_events');
  expect(Object.keys(columns)).toEqual(['event_id']);
});

test('authorization evidence migration replaces malformed named indexes with exact key indexes', async () => {
  await resetDb();
  await sequelize.query(`
    DROP INDEX authorization_evidence_events_deployment_time_idx;
    DROP INDEX authorization_evidence_events_surface_mode_time_idx;
    CREATE INDEX authorization_evidence_events_deployment_time_idx
      ON authorization_evidence_events(event_id) INCLUDE (deployment_id)
  `);

  await migration.up(queryInterface, Sequelize);

  expect(await evidenceIndexKeys()).toEqual([
    {
      name: 'authorization_evidence_events_deployment_time_idx',
      columns: ['deployment_id', 'observed_at'], unconditional: true, no_includes: true,
    },
    {
      name: 'authorization_evidence_events_surface_mode_time_idx',
      columns: ['surface', 'mode', 'observed_at'], unconditional: true, no_includes: true,
    },
  ]);
});

test('two replica recorders idempotently converge on one shared canary row', async () => {
  await resetDb();
  const release = {
    commitSha: 'a'.repeat(40), deploymentId: 'replicated-deployment', serviceId: 'api-staging',
    configDigest: 'b'.repeat(64), migrationHead: '20260824000000-create-authorization-evidence-events.js',
    authorizationMode: 'compatibility',
  };
  const now = new Date('2026-08-19T12:02:00.000Z');
  const first = createAuthorizationEvidenceRecorder({ EventModel: AuthorizationEvidenceEvent, release, clock: () => now });
  const second = createAuthorizationEvidenceRecorder({ EventModel: AuthorizationEvidenceEvent, release, clock: () => now });

  await Promise.all([first.recordCanary(), second.recordCanary()]);

  expect(await AuthorizationEvidenceEvent.count({ where: { type: 'canary' } })).toBe(1);
});
