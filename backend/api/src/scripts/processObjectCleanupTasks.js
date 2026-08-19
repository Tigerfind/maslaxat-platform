'use strict';

const cleanupService = require('../services/objectCleanupTaskService');

function parseLimit(argv) {
  const argument = argv.find((value) => value.startsWith('--limit='));
  return argument ? Number.parseInt(argument.slice('--limit='.length), 10) : 25;
}

async function runCleanupCommand({
  argv = [],
  env = process.env,
  processTasks = cleanupService.processObjectCleanupTasks,
  previewTasks = cleanupService.getObjectCleanupReconciliationReport,
  write = (value) => process.stdout.write(value),
} = {}) {
  const apply = argv.includes('--apply');
  if (!apply) {
    const result = { dryRun: true, preview: await previewTasks() };
    write(`${JSON.stringify(result)}\n`);
    return result;
  }
  const confirmed = argv.includes('--confirm-object-deletion') || env.CONFIRM_OBJECT_CLEANUP === 'DELETE';
  if (!confirmed) {
    throw Object.assign(new Error('Physical cleanup requires explicit confirmation'), {
      code: 'CLEANUP_CONFIRMATION_REQUIRED',
    });
  }
  const summary = await processTasks({ limit: parseLimit(argv) });
  const result = { dryRun: false, ...summary };
  write(`${JSON.stringify(result)}\n`);
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const result = await runCleanupCommand({ argv });
  if (result.dryRun ? !result.preview.ready : (result.deadLettered || result.manualReview)) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Object cleanup processing failed: ${error.code || error.name || 'ERROR'}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseLimit, runCleanupCommand };
