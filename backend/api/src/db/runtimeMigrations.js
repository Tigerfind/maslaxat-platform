'use strict';

const fs = require('fs');
const path = require('path');
const SequelizeLibrary = require('sequelize');

const BASELINE_ANCHOR = '20260829000005-fix-reminder-column-names.js';
const ADVISORY_LOCK_KEYS = [1162691404, 20260829];
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

function listMigrationFiles(migrationsDirectory = DEFAULT_MIGRATIONS_DIR, fsModule = fs) {
  let entries;
  try {
    entries = fsModule.readdirSync(migrationsDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Migrations directory is unavailable: ${migrationsDirectory}`);
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();

  if (!files.includes(BASELINE_ANCHOR)) {
    throw new Error(`Baseline anchor file is missing: ${BASELINE_ANCHOR}`);
  }
  return files;
}

function buildMigrationState(files, appliedNames) {
  const applied = new Set(appliedNames);
  if (!applied.has(BASELINE_ANCHOR)) {
    throw new Error(`Baseline anchor is not applied: ${BASELINE_ANCHOR}`);
  }

  const forward = files.filter((name) => name > BASELINE_ANCHOR);
  return {
    anchor: BASELINE_ANCHOR,
    forward,
    applied: forward.filter((name) => applied.has(name)),
    pending: forward.filter((name) => !applied.has(name)),
  };
}

function rowsFromQueryResult(result) {
  if (Array.isArray(result)) return result[0];
  return result.rows;
}

async function readAppliedMigrations(queryable) {
  const relationRows = rowsFromQueryResult(await queryable.query(
    `SELECT to_regclass('public."SequelizeMeta"') AS relation`
  ));
  if (!relationRows?.[0]?.relation) {
    throw new Error('SequelizeMeta table is missing; refusing to infer or stamp a baseline');
  }

  const rows = rowsFromQueryResult(await queryable.query(
    'SELECT name FROM "public"."SequelizeMeta" ORDER BY name'
  ));
  return rows.map((row) => row.name);
}

async function inspectMigrations({
  sequelizeInstance,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIR,
  fsModule = fs,
}) {
  const files = listMigrationFiles(migrationsDirectory, fsModule);
  const applied = await readAppliedMigrations(sequelizeInstance);
  return buildMigrationState(files, applied);
}

async function applyMigrations({
  sequelizeInstance,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIR,
  fsModule = fs,
  loadMigration = (filename) => require(path.join(migrationsDirectory, filename)),
  sequelizeLibrary = SequelizeLibrary,
}) {
  const files = listMigrationFiles(migrationsDirectory, fsModule);
  const connection = await sequelizeInstance.connectionManager.getConnection();
  let locked = false;

  try {
    await connection.query('SELECT pg_advisory_lock($1, $2)', ADVISORY_LOCK_KEYS);
    locked = true;

    const applied = await readAppliedMigrations(connection);
    const state = buildMigrationState(files, applied);
    const queryInterface = sequelizeInstance.getQueryInterface();
    const completed = [];

    for (const filename of state.pending) {
      const migration = loadMigration(filename);
      if (!migration || typeof migration.up !== 'function') {
        throw new Error(`Migration does not export up(): ${filename}`);
      }
      await migration.up(queryInterface, sequelizeLibrary);
      await connection.query(
        'INSERT INTO "public"."SequelizeMeta" (name) VALUES ($1)',
        [filename]
      );
      completed.push(filename);
    }

    return { ...state, completed };
  } finally {
    if (locked) {
      try {
        await connection.query('SELECT pg_advisory_unlock($1, $2)', ADVISORY_LOCK_KEYS);
      } finally {
        await sequelizeInstance.connectionManager.releaseConnection(connection);
      }
    } else {
      await sequelizeInstance.connectionManager.releaseConnection(connection);
    }
  }
}

module.exports = {
  ADVISORY_LOCK_KEYS,
  BASELINE_ANCHOR,
  DEFAULT_MIGRATIONS_DIR,
  applyMigrations,
  buildMigrationState,
  inspectMigrations,
  listMigrationFiles,
  readAppliedMigrations,
};
