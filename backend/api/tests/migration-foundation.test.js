const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const fixture = require('./fixtures/representative-db');

const apiRoot = path.join(__dirname, '..');
const migrationDir = path.join(apiRoot, 'migrations');
const PREFIX = 'emaslaxat_session_a_a1_';
const emptyDb = `${PREFIX}empty_${process.pid}`;
const partialDb = `${PREFIX}partial_${process.pid}`;
const incompatibleDb = `${PREFIX}incompatible_${process.pid}`;
const evolvedDb = `${PREFIX}evolved_${process.pid}`;

function assertDisposableName(name) {
  if (!name.startsWith(PREFIX)) throw new Error(`Refusing non-A1 database: ${name}`);
}

async function recreateDatabase(name) {
  assertDisposableName(name);
  await fixture.recreateDisposableDatabase(name);
}

async function dropDatabase(name) {
  assertDisposableName(name);
  await fixture.dropDisposableDatabase(name);
}

function migrate(name, extraArgs = []) {
  assertDisposableName(name);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    TEST_DB_NAME: name,
    DB_USER: process.env.DB_USER || process.env.USER,
  };
  delete env.DATABASE_URL;
  return spawnSync(process.execPath, [
    path.join(apiRoot, 'node_modules', 'sequelize-cli', 'lib', 'sequelize'),
    'db:migrate',
    ...extraArgs,
  ], {
    cwd: apiRoot,
    encoding: 'utf8',
    env,
  });
}

async function query(name, sql) {
  assertDisposableName(name);
  const rows = await fixture.queryRows(name, sql);
  return rows.map((row) => String(Object.values(row)[0]));
}

beforeAll(async () => {
  await recreateDatabase(emptyDb);
  await recreateDatabase(partialDb);
  await recreateDatabase(incompatibleDb);
  await recreateDatabase(evolvedDb);
});

afterAll(async () => {
  await fixture.dropAllDisposableDatabases(
    [emptyDb, partialDb, incompatibleDb, evolvedDb],
    dropDatabase
  );
});

test('cleanup attempts every owned database and aggregates failures', async () => {
  const names = [`${PREFIX}cleanup_a`, `${PREFIX}cleanup_b`, `${PREFIX}cleanup_c`];
  const attempted = [];
  await expect(fixture.dropAllDisposableDatabases(names, async (name) => {
    attempted.push(name);
    if (name !== names[1]) throw new Error(`drop failed: ${name}`);
  })).rejects.toThrow(AggregateError);
  expect(attempted).toEqual(names);
});

test('the actual migration chain builds a true-empty database without model sync and reruns cleanly', async () => {
  const first = migrate(emptyDb);
  expect({ status: first.status, stdout: first.stdout, stderr: first.stderr }).toEqual(expect.objectContaining({
    status: 0,
  }));

  const tables = await query(emptyDb, `
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema()
    ORDER BY tablename
  `);
  expect(tables).toEqual(expect.arrayContaining([
    'users', 'consultations', 'payments', 'promos', 'withdrawals', 'push_subscriptions',
    'financial_transactions', 'lawyer_profile_imports', 'profile_import_audits',
  ]));
  expect(await query(emptyDb, `
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'push_subscriptions'
    ORDER BY column_name
  `)).toEqual(['created_at', 'endpoint', 'id', 'keys', 'updated_at', 'user_id']);
  expect(await query(emptyDb, `
    SELECT tablename || ':' || COUNT(*)
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      AND ((tablename = 'promos' AND indexdef ~ '\\(code\\)')
        OR (tablename = 'push_subscriptions' AND indexdef ~ '\\(endpoint\\)'))
    GROUP BY tablename ORDER BY tablename
  `)).toEqual(['promos:1', 'push_subscriptions:1']);

  const expectedMigrations = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.js')).sort();
  expect(await query(emptyDb, 'SELECT name FROM "SequelizeMeta" ORDER BY name')).toEqual(expectedMigrations);

  const second = migrate(emptyDb);
  expect(second.status).toBe(0);
  expect(second.stdout).toContain('No migrations were executed');
});

test('baseline adoption rejects a partial existing schema before creating foundational tables', async () => {
  await fixture.executeSql(partialDb, 'CREATE TABLE users (id uuid PRIMARY KEY)');

  const result = migrate(partialDb, ['--to', '20260723000000-initial-sync-baseline.js']);
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/partial|missing|foundational/i);
  expect(await query(partialDb, `
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename = 'consultations'
  `)).toEqual([]);
});

test('baseline adoption rejects incompatible foundational column types', async () => {
  const initial = migrate(incompatibleDb);
  expect(initial.status).toBe(0);
  await fixture.executeSql(incompatibleDb, `
    ALTER TABLE users ALTER COLUMN email TYPE integer USING 0;
    DELETE FROM "SequelizeMeta" WHERE name = '20260723000000-initial-sync-baseline.js'
  `);

  const result = migrate(incompatibleDb, ['--to', '20260723000000-initial-sync-baseline.js']);
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/users\.email.*incompatible|incompatible.*users\.email/i);
  expect(await query(incompatibleDb, `
    SELECT COUNT(*) FROM "SequelizeMeta"
    WHERE name = '20260723000000-initial-sync-baseline.js'
  `)).toEqual(['0']);
});

test('baseline adoption accepts a fully evolved schema with additive enum values', async () => {
  const initial = migrate(evolvedDb);
  expect(initial.status).toBe(0);
  await fixture.executeSql(evolvedDb, `
    DELETE FROM "SequelizeMeta" WHERE name = '20260723000000-initial-sync-baseline.js'
  `);

  const adoption = migrate(evolvedDb, ['--to', '20260723000000-initial-sync-baseline.js']);
  expect({ status: adoption.status, stdout: adoption.stdout, stderr: adoption.stderr })
    .toEqual(expect.objectContaining({ status: 0 }));
  expect(await query(evolvedDb, `
    SELECT COUNT(*) FROM "SequelizeMeta"
    WHERE name = '20260723000000-initial-sync-baseline.js'
  `)).toEqual(['1']);
});
