const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '..', 'migrations');
const emptyMigrationsDir = path.join(__dirname, 'fixtures', 'empty-migrations');

function loadSubject() {
  return require('../src/db/assertMigrationState');
}

function appliedRows(names) {
  return names.map((name) => ({ name }));
}

test('exact packaged and applied migration sets are accepted', async () => {
  let subject;
  let loadError;
  try {
    subject = loadSubject();
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();

  const names = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort();
  const sequelize = { query: async () => [appliedRows(names)] };
  await expect(subject.assertMigrationState({ sequelize, migrationsDir }))
    .resolves.toEqual({ appliedCount: names.length, migrationHead: names.at(-1) });
});

test('pending, unknown, and unavailable migration states fail closed', async () => {
  let subject;
  let loadError;
  try {
    subject = loadSubject();
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();

  const names = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort();
  await expect(subject.assertMigrationState({
    sequelize: { query: async () => [appliedRows(names.slice(0, -1))] }, migrationsDir,
  })).rejects.toMatchObject({ code: 'MIGRATIONS_PENDING', pending: [names.at(-1)] });
  await expect(subject.assertMigrationState({
    sequelize: { query: async () => [appliedRows([...names, '20990101000000-unknown.js'])] }, migrationsDir,
  })).rejects.toMatchObject({ code: 'MIGRATIONS_UNKNOWN', unknown: ['20990101000000-unknown.js'] });
  await expect(subject.assertMigrationState({
    sequelize: { query: async () => { throw Object.assign(new Error('missing relation'), { code: '42P01' }); } },
    migrationsDir,
  })).rejects.toMatchObject({ code: 'MIGRATION_STATE_UNAVAILABLE' });
});

test('empty migration package and duplicate applied names fail closed', async () => {
  const subject = loadSubject();
  fs.mkdirSync(emptyMigrationsDir, { recursive: true });
  try {
    await expect(subject.assertMigrationState({
      sequelize: { query: async () => [[]] }, migrationsDir: emptyMigrationsDir,
    })).rejects.toMatchObject({ code: 'MIGRATION_PACKAGE_EMPTY' });
  } finally {
    fs.rmdirSync(emptyMigrationsDir);
  }

  const names = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.js')).sort();
  await expect(subject.assertMigrationState({
    sequelize: { query: async () => [appliedRows([...names, names[0]])] }, migrationsDir,
  })).rejects.toMatchObject({ code: 'MIGRATIONS_DUPLICATE' });
});

test('database initialization asserts production migrations without sync and preserves dev alter sync', async () => {
  let subject;
  let loadError;
  try {
    subject = loadSubject();
  } catch (error) {
    loadError = error;
  }
  expect(loadError).toBeUndefined();

  const productionEvents = [];
  const productionDb = {
    authenticate: async () => productionEvents.push('authenticate'),
    sync: async () => { throw new Error('production sync must not run'); },
  };
  await subject.initializeDatabase({
    sequelize: productionDb,
    production: true,
    assertState: async () => productionEvents.push('assert'),
  });
  expect(productionEvents).toEqual(['authenticate', 'assert']);

  const developmentEvents = [];
  await subject.initializeDatabase({
    sequelize: {
      authenticate: async () => developmentEvents.push('authenticate'),
      sync: async (options) => developmentEvents.push(['sync', options]),
    },
    production: false,
    assertState: async () => { throw new Error('dev assertion must not run'); },
  });
  expect(developmentEvents).toEqual(['authenticate', ['sync', { alter: true }]]);
});
