#!/usr/bin/env node
'use strict';

require('dotenv').config();
const sequelize = require('../config/database');
const {
  applyMigrations,
  inspectMigrations,
} = require('../db/runtimeMigrations');

// Keep deployment output limited to migration state; never print connection details.
sequelize.options.logging = false;

function printStatus(state) {
  console.log(`Baseline anchor: applied (${state.anchor})`);
  console.log(`Forward applied: ${state.applied.length}${state.applied.length ? ` (${state.applied.join(', ')})` : ''}`);
  console.log(`Forward pending: ${state.pending.length}${state.pending.length ? ` (${state.pending.join(', ')})` : ''}`);
}

async function main(command = process.argv[2]) {
  if (!['status', 'check', 'up'].includes(command)) {
    throw new Error('Usage: node src/scripts/runMigrations.js <status|check|up>');
  }

  await sequelize.authenticate();
  if (command === 'up') {
    const result = await applyMigrations({ sequelizeInstance: sequelize });
    printStatus({ ...result, applied: [...result.applied, ...result.completed], pending: [] });
    console.log(result.completed.length
      ? `Applied: ${result.completed.join(', ')}`
      : 'Applied: none (schema is current)');
    return;
  }

  const state = await inspectMigrations({ sequelizeInstance: sequelize });
  printStatus(state);
  if (command === 'check' && state.pending.length > 0) {
    throw new Error(`Pending migrations: ${state.pending.join(', ')}`);
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Runtime migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await sequelize.close();
      } catch (error) {
        console.error(`Runtime migration shutdown failed: ${error.message}`);
        process.exitCode = 1;
      }
    });
}

module.exports = { main, printStatus };
