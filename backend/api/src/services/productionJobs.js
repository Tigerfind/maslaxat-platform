const { createManagedJob } = require('./jobScheduler');

const MINUTE = 60_000;
const JOB_SPECS = Object.freeze({
  reminders: { intervalMs: 5 * MINUTE, ttlMs: 4 * MINUTE, initialDelayMs: 15_000 },
  promotionLifecycle: { intervalMs: MINUTE, ttlMs: 55_000, initialDelayMs: 10_000 },
  deferredRevenue: { intervalMs: 60 * MINUTE, ttlMs: 15 * MINUTE, initialDelayMs: 30_000 },
  importParser: { intervalMs: 15_000, ttlMs: 2 * MINUTE, initialDelayMs: 5_000 },
  importRetention: { intervalMs: 60 * MINUTE, ttlMs: 10 * MINUTE, initialDelayMs: MINUTE },
  importAuditRetention: { intervalMs: 24 * 60 * MINUTE, ttlMs: 30 * MINUTE, initialDelayMs: 2 * MINUTE },
  objectCleanup: { intervalMs: MINUTE, ttlMs: 5 * MINUTE, initialDelayMs: 20_000 },
  objectReconciliation: { intervalMs: 6 * 60 * MINUTE, ttlMs: 30 * MINUTE, initialDelayMs: 5 * MINUTE },
  authorizationCanary: { intervalMs: 5 * MINUTE, ttlMs: MINUTE, initialDelayMs: 5_000 },
});

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Job aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
}

function defaultServices() {
  const reminders = require('./reminderService');
  const promotions = require('./promotionJobs');
  const ledger = require('./ledgerService');
  const imports = require('./profileImportService');
  const cleanup = require('./objectCleanupTaskService');
  const objectStorage = require('./objectStorage');
  const reconciliation = require('../scripts/reconcileObjectStorage');
  const authorization = require('./authorizationRuntime');
  return {
    reminders: (now, { signal }) => reminders.runReminderOnce(now, { signal }),
    promotionLifecycle: (now, { signal }) => promotions.runPromotionLifecycleOnce(now, { signal }),
    deferredRevenue: (now, { signal }) => ledger.runDeferredRevenueOnce(now, { signal }),
    importParser: (now, { signal }) => imports.runImportParserOnce(now, { signal, limit: 10, concurrency: 4 }),
    importRetention: (now, { signal }) => imports.runImportRetentionOnce(now, { signal, limit: 25 }),
    importAuditRetention: (now, { signal }) => imports.runImportAuditRetentionOnce(now, { signal, limit: 100 }),
    objectCleanup: (now, { signal }) => cleanup.runObjectCleanupOnce(now, { signal, limit: 25 }),
    objectReconciliation: async (now, { signal }) => {
      throwIfAborted(signal);
      const inventory = reconciliation.createDefaultInventory();
      return reconciliation.reconcileObjectStorage({
        ...inventory,
        objectStorage,
        scheduleDeletion: false,
        now,
        pageSize: 100,
        dbBatchSize: 100,
        maxPages: 100,
        maxDbRows: 10_000,
        reportLimit: 25,
        signal,
      });
    },
    authorizationCanary: async (now, { signal }) => {
      throwIfAborted(signal);
      return authorization.recordAuthorizationCanary(now);
    },
  };
}

function createProductionJobs({ services = defaultServices(), createJob = createManagedJob, onError } = {}) {
  const handles = Object.entries(JOB_SPECS).map(([name, spec]) => createJob({
    name,
    ...spec,
    onError,
    runOnce: (now, context) => services[name](now, context),
  }));
  return {
    start() { handles.forEach((handle) => handle.start()); },
    pause() { handles.forEach((handle) => handle.pause()); },
    stop() { return Promise.all(handles.map((handle) => handle.stop())); },
    wait() { return Promise.all(handles.map((handle) => handle.wait())); },
    handles,
  };
}

module.exports = { JOB_SPECS, createProductionJobs, throwIfAborted };
