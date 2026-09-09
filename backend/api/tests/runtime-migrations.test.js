const {
  BASELINE_ANCHOR,
  applyMigrations,
  buildMigrationState,
  inspectMigrations,
  listMigrationFiles,
  readAppliedMigrations,
} = require('../src/db/runtimeMigrations');
const { assertProductionSchema } = require('../src/db/productionSchemaGate');

function fakeFs(names) {
  return {
    readdirSync: jest.fn(() => names.map((name) => ({
      name,
      isFile: () => true,
    }))),
  };
}

function sequelizeQuery(rowsBySql) {
  return {
    query: jest.fn(async (sql) => [rowsBySql(sql), {}]),
  };
}

test('lists only sorted forward migrations after the exact anchor', () => {
  const files = listMigrationFiles('/migrations', fakeFs([
    '20260903000001-second.js',
    BASELINE_ANCHOR,
    'README.md',
    '20260801000000-historical.js',
    '20260830000000-first.js',
  ]));

  const state = buildMigrationState(files, [BASELINE_ANCHOR]);
  expect(state.forward).toEqual([
    '20260830000000-first.js',
    '20260903000001-second.js',
  ]);
  expect(state.pending).toEqual(state.forward);
});

test('refuses a missing migrations directory or anchor file', () => {
  expect(() => listMigrationFiles('/missing', {
    readdirSync: () => { throw new Error('ENOENT'); },
  })).toThrow('Migrations directory is unavailable');
  expect(() => listMigrationFiles('/migrations', fakeFs(['20260903000001-next.js'])))
    .toThrow(`Baseline anchor file is missing: ${BASELINE_ANCHOR}`);
});

test('refuses a missing SequelizeMeta table or unapplied anchor', async () => {
  await expect(readAppliedMigrations(sequelizeQuery(() => [{ relation: null }])))
    .rejects.toThrow('SequelizeMeta table is missing');

  const sequelizeInstance = sequelizeQuery((sql) => (
    sql.includes('to_regclass') ? [{ relation: '"SequelizeMeta"' }] : []
  ));
  await expect(inspectMigrations({
    sequelizeInstance,
    migrationsDirectory: '/migrations',
    fsModule: fakeFs([BASELINE_ANCHOR]),
  })).rejects.toThrow(`Baseline anchor is not applied: ${BASELINE_ANCHOR}`);
});

test('detects applied and pending forward migrations', () => {
  const first = '20260830000000-first.js';
  const second = '20260903000000-second.js';
  expect(buildMigrationState(
    [BASELINE_ANCHOR, first, second],
    [BASELINE_ANCHOR, first]
  )).toEqual({
    anchor: BASELINE_ANCHOR,
    forward: [first, second],
    applied: [first],
    pending: [second],
  });
});

test('up locks, rechecks, applies in order, records after success, and is idempotent', async () => {
  const first = '20260830000000-first.js';
  const second = '20260903000000-second.js';
  const applied = new Set([BASELINE_ANCHOR]);
  const events = [];
  const connection = {
    query: jest.fn(async (sql, values) => {
      if (sql.includes('pg_advisory_lock(')) events.push('lock');
      if (sql.includes('to_regclass')) return { rows: [{ relation: '"SequelizeMeta"' }] };
      if (sql.startsWith('SELECT name')) {
        events.push('recheck');
        return { rows: [...applied].sort().map((name) => ({ name })) };
      }
      if (sql.startsWith('INSERT INTO')) {
        events.push(`meta:${values[0]}`);
        applied.add(values[0]);
      }
      if (sql.includes('pg_advisory_unlock(')) events.push('unlock');
      return { rows: [] };
    }),
  };
  const sequelizeInstance = {
    connectionManager: {
      getConnection: jest.fn(async () => connection),
      releaseConnection: jest.fn(async () => events.push('release')),
    },
    getQueryInterface: jest.fn(() => ({ marker: 'query-interface' })),
  };
  const migrations = {
    [first]: { up: jest.fn(async () => events.push(`up:${first}`)) },
    [second]: { up: jest.fn(async () => events.push(`up:${second}`)) },
  };
  const options = {
    sequelizeInstance,
    migrationsDirectory: '/migrations',
    fsModule: fakeFs([second, BASELINE_ANCHOR, first]),
    loadMigration: (name) => migrations[name],
    sequelizeLibrary: { STRING: 'STRING' },
  };

  const firstRun = await applyMigrations(options);
  expect(firstRun.completed).toEqual([first, second]);
  expect(events).toEqual([
    'lock',
    'recheck',
    `up:${first}`,
    `meta:${first}`,
    `up:${second}`,
    `meta:${second}`,
    'unlock',
    'release',
  ]);

  events.length = 0;
  const secondRun = await applyMigrations(options);
  expect(secondRun.completed).toEqual([]);
  expect(events).toEqual(['lock', 'recheck', 'unlock', 'release']);
});

test('up never inserts metadata when a migration fails and still unlocks', async () => {
  const pending = '20260830000000-fails.js';
  const events = [];
  const connection = {
    query: jest.fn(async (sql) => {
      if (sql.includes('pg_advisory_lock(')) events.push('lock');
      if (sql.includes('to_regclass')) return { rows: [{ relation: '"SequelizeMeta"' }] };
      if (sql.startsWith('SELECT name')) return { rows: [{ name: BASELINE_ANCHOR }] };
      if (sql.startsWith('INSERT INTO')) events.push('meta');
      if (sql.includes('pg_advisory_unlock(')) events.push('unlock');
      return { rows: [] };
    }),
  };
  const sequelizeInstance = {
    connectionManager: {
      getConnection: jest.fn(async () => connection),
      releaseConnection: jest.fn(async () => events.push('release')),
    },
    getQueryInterface: () => ({}),
  };

  await expect(applyMigrations({
    sequelizeInstance,
    migrationsDirectory: '/migrations',
    fsModule: fakeFs([BASELINE_ANCHOR, pending]),
    loadMigration: () => ({ up: async () => { throw new Error('migration failed'); } }),
  })).rejects.toThrow('migration failed');
  expect(events).toEqual(['lock', 'unlock', 'release']);
});

test('production schema gate is injected, production-only, and reports pending names', async () => {
  const inspect = jest.fn(async () => ({ pending: ['one.js', 'two.js'] }));
  await expect(assertProductionSchema({
    environment: 'production',
    sequelizeInstance: {},
    inspect,
  })).rejects.toThrow('Pending production migrations: one.js, two.js');

  const skipped = await assertProductionSchema({ environment: 'test', inspect });
  expect(skipped).toEqual({ skipped: true });
  expect(inspect).toHaveBeenCalledTimes(1);
});
