'use strict';

const { inspectMigrations } = require('./runtimeMigrations');

async function assertProductionSchema({
  environment = process.env.NODE_ENV,
  sequelizeInstance,
  inspect = inspectMigrations,
  migrationsDirectory,
} = {}) {
  if (environment !== 'production') return { skipped: true };

  const state = await inspect({ sequelizeInstance, migrationsDirectory });
  if (state.pending.length > 0) {
    throw new Error(`Pending production migrations: ${state.pending.join(', ')}`);
  }
  return state;
}

module.exports = { assertProductionSchema };
