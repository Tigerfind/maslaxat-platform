const fs = require('fs');
const path = require('path');

const defaultMigrationsDir = path.resolve(__dirname, '..', '..', 'migrations');

function stateError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function packagedMigrations(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.js'))
    .sort();
}

async function assertMigrationState({ sequelize, migrationsDir = defaultMigrationsDir, transaction = null }) {
  const expected = packagedMigrations(migrationsDir);
  if (expected.length === 0) {
    throw stateError('MIGRATION_PACKAGE_EMPTY', 'No packaged database migrations are available');
  }
  let rows;
  try {
    [rows] = await sequelize.query('SELECT name FROM "SequelizeMeta" ORDER BY name', { transaction });
  } catch (_error) {
    throw stateError('MIGRATION_STATE_UNAVAILABLE', 'Database migration state is unavailable');
  }

  const applied = rows.map((row) => row.name).sort();
  const duplicates = applied.filter((name, index) => applied[index - 1] === name);
  if (duplicates.length) {
    throw stateError('MIGRATIONS_DUPLICATE', 'Duplicate database migration records are applied', {
      duplicates: [...new Set(duplicates)],
    });
  }
  const appliedSet = new Set(applied);
  const expectedSet = new Set(expected);
  const pending = expected.filter((name) => !appliedSet.has(name));
  if (pending.length) {
    throw stateError('MIGRATIONS_PENDING', `${pending.length} database migration(s) are pending`, { pending });
  }
  const unknown = applied.filter((name) => !expectedSet.has(name));
  if (unknown.length) {
    throw stateError('MIGRATIONS_UNKNOWN', `${unknown.length} unknown database migration(s) are applied`, { unknown });
  }
  return { appliedCount: applied.length, migrationHead: expected.at(-1) };
}

async function initializeDatabase({
  sequelize,
  production,
  migrationsDir = defaultMigrationsDir,
  assertState = assertMigrationState,
}) {
  await sequelize.authenticate();
  if (production) {
    return assertState({ sequelize, migrationsDir });
  }
  await sequelize.sync({ alter: true });
  return null;
}

module.exports = { assertMigrationState, initializeDatabase };
