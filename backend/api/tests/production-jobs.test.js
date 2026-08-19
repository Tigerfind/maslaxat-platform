const EXPECTED = {
  reminders: [5 * 60_000, 4 * 60_000],
  promotionLifecycle: [60_000, 55_000],
  deferredRevenue: [60 * 60_000, 15 * 60_000],
  importParser: [15_000, 2 * 60_000],
  importRetention: [60 * 60_000, 10 * 60_000],
  importAuditRetention: [24 * 60 * 60_000, 30 * 60_000],
  objectCleanup: [60_000, 5 * 60_000],
  objectReconciliation: [6 * 60 * 60_000, 30 * 60_000],
  authorizationCanary: [5 * 60_000, 60_000],
};

test('production scheduler defines only bounded renewable jobs with exact intervals and TTLs', async () => {
  const { createProductionJobs, JOB_SPECS } = require('../src/services/productionJobs');
  expect(Object.fromEntries(Object.entries(JOB_SPECS).map(([name, spec]) => [
    name, [spec.intervalMs, spec.ttlMs],
  ]))).toEqual(EXPECTED);
  expect(Object.keys(JOB_SPECS).some((name) => /billing|capture/i.test(name))).toBe(false);

  const calls = [];
  const handles = [];
  const services = Object.fromEntries(Object.keys(EXPECTED).map((name) => [name, jest.fn()]));
  const manager = createProductionJobs({
    services,
    createJob(spec) {
      calls.push(spec);
      const handle = {
        start: jest.fn(), pause: jest.fn(), stop: jest.fn(), wait: jest.fn().mockResolvedValue(),
      };
      handles.push(handle);
      return handle;
    },
  });

  expect(calls.map(({ name }) => name)).toEqual(Object.keys(EXPECTED));
  for (const call of calls) {
    const controller = new AbortController();
    await call.runOnce(new Date('2026-08-19T00:00:00Z'), { signal: controller.signal });
    expect(services[call.name]).toHaveBeenCalledWith(
      new Date('2026-08-19T00:00:00Z'),
      expect.objectContaining({ signal: controller.signal })
    );
  }
  manager.start();
  manager.pause();
  await manager.stop();
  await manager.wait();
  handles.forEach((handle) => {
    expect(handle.start).toHaveBeenCalledTimes(1);
    expect(handle.pause).toHaveBeenCalledTimes(1);
    expect(handle.stop).toHaveBeenCalledTimes(1);
    expect(handle.wait).toHaveBeenCalledTimes(1);
  });
});

test('production job manager aborts every handle and awaits all active stops', async () => {
  const { createProductionJobs } = require('../src/services/productionJobs');
  const releases = [];
  const handles = [];
  const services = Object.fromEntries(Object.keys(EXPECTED).map((name) => [name, jest.fn()]));
  const manager = createProductionJobs({
    services,
    createJob() {
      let release;
      const stopped = new Promise((resolve) => { release = resolve; });
      releases.push(release);
      const handle = { start() {}, stop: jest.fn(() => stopped), wait: jest.fn(() => stopped) };
      handles.push(handle);
      return handle;
    },
  });
  let settled = false;
  const stopping = manager.stop().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  handles.forEach((handle) => expect(handle.stop).toHaveBeenCalledTimes(1));
  releases.forEach((release) => release());
  await stopping;
  expect(settled).toBe(true);
});

test('business services expose cooperative idempotent run-once entry points', async () => {
  const entries = [
    [require('../src/services/reminderService'), 'runReminderOnce'],
    [require('../src/services/promotionJobs'), 'runPromotionLifecycleOnce'],
    [require('../src/services/ledgerService'), 'runDeferredRevenueOnce'],
    [require('../src/services/profileImportService'), 'runImportParserOnce'],
    [require('../src/services/profileImportService'), 'runImportRetentionOnce'],
    [require('../src/services/profileImportService'), 'runImportAuditRetentionOnce'],
    [require('../src/services/objectCleanupTaskService'), 'runObjectCleanupOnce'],
  ];
  const controller = new AbortController();
  controller.abort();
  for (const [service, name] of entries) {
    expect(service[name]).toEqual(expect.any(Function));
    await expect(service[name](new Date(), { signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORT_ERR',
    });
  }
});

test('multi-phase production wrappers stop between transactions after cooperative abort', async () => {
  const promotions = require('../src/services/promotionJobs');
  const ledger = require('../src/services/ledgerService');
  const promotionController = new AbortController();
  const resume = jest.fn();
  await expect(promotions.runPromotionLifecycleOnce(new Date(), {
    signal: promotionController.signal,
    expire: async () => { promotionController.abort(); return {}; },
    resume,
  })).rejects.toMatchObject({ code: 'ABORT_ERR' });
  expect(resume).not.toHaveBeenCalled();

  const revenueController = new AbortController();
  const recognizePromotions = jest.fn();
  await expect(ledger.runDeferredRevenueOnce(new Date(), {
    signal: revenueController.signal,
    recognizeSubscriptions: async () => { revenueController.abort(); return {}; },
    recognizePromotions,
  })).rejects.toMatchObject({ code: 'ABORT_ERR' });
  expect(recognizePromotions).not.toHaveBeenCalled();
});

test('single-phase production wrappers pass the scheduler signal into bounded processors', async () => {
  const imports = require('../src/services/profileImportService');
  const cleanup = require('../src/services/objectCleanupTaskService');
  const signal = new AbortController().signal;
  const service = {
    processImportJobs: jest.fn().mockResolvedValue({}),
    processRetentionJobs: jest.fn().mockResolvedValue({}),
    processAuditRetentionJobs: jest.fn().mockResolvedValue({}),
  };
  const processCleanup = jest.fn().mockResolvedValue({});

  await imports.runImportParserOnce(new Date(), { signal, service, limit: 7, concurrency: 2 });
  await imports.runImportRetentionOnce(new Date(), { signal, service, limit: 8 });
  await imports.runImportAuditRetentionOnce(new Date(), { signal, service, limit: 9 });
  await cleanup.runObjectCleanupOnce(new Date(), { signal, limit: 6, processCleanup });

  expect(service.processImportJobs).toHaveBeenCalledWith({ limit: 7, concurrency: 2, signal });
  expect(service.processRetentionJobs).toHaveBeenCalledWith({ limit: 8, signal });
  expect(service.processAuditRetentionJobs).toHaveBeenCalledWith({ limit: 9, signal });
  expect(processCleanup).toHaveBeenCalledWith(expect.objectContaining({ limit: 6, signal }));
});

test('promotion lifecycle stops between candidate transactions when its lease signal aborts', async () => {
  const models = require('../src/models');
  const promotions = require('../src/services/promotionJobs');
  const controller = new AbortController();
  const findAll = jest.spyOn(models.LawyerPromotion, 'findAll').mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
  const transaction = jest.spyOn(models.sequelize, 'transaction').mockImplementation(async () => {
    controller.abort();
  });
  try {
    await expect(promotions.expireAndAdvancePromotions(new Date(), { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ABORT_ERR' });
    expect(transaction).toHaveBeenCalledTimes(1);
  } finally {
    findAll.mockRestore();
    transaction.mockRestore();
  }
});
