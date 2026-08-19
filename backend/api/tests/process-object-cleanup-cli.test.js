'use strict';

const { runCleanupCommand } = require('../src/scripts/processObjectCleanupTasks');

test('cleanup CLI is dry-run by default and never invokes physical processing', async () => {
  const processTasks = jest.fn();
  const previewTasks = jest.fn(async () => ({ ready: false, total: 3 }));
  const writes = [];
  const result = await runCleanupCommand({
    argv: [], env: {}, processTasks, previewTasks, write: (value) => writes.push(value),
  });
  expect(result).toEqual({ dryRun: true, preview: { ready: false, total: 3 } });
  expect(processTasks).not.toHaveBeenCalled();
  expect(writes.join('')).toContain('"dryRun":true');
});

test('cleanup CLI requires apply plus explicit confirmation before deletion', async () => {
  const processTasks = jest.fn(async () => ({ claimed: 1, completed: 1 }));
  await expect(runCleanupCommand({
    argv: ['--apply'], env: {}, processTasks, previewTasks: jest.fn(), write: jest.fn(),
  })).rejects.toMatchObject({ code: 'CLEANUP_CONFIRMATION_REQUIRED' });
  expect(processTasks).not.toHaveBeenCalled();

  await expect(runCleanupCommand({
    argv: ['--apply', '--confirm-object-deletion', '--limit=10'], env: {},
    processTasks, previewTasks: jest.fn(), write: jest.fn(),
  })).resolves.toMatchObject({ dryRun: false, claimed: 1, completed: 1 });
  expect(processTasks).toHaveBeenCalledWith({ limit: 10 });
});

test('cleanup CLI accepts the exact confirmation environment value with apply', async () => {
  const processTasks = jest.fn(async () => ({ claimed: 0, completed: 0 }));
  await runCleanupCommand({
    argv: ['--apply'], env: { CONFIRM_OBJECT_CLEANUP: 'DELETE' },
    processTasks, previewTasks: jest.fn(), write: jest.fn(),
  });
  expect(processTasks).toHaveBeenCalledTimes(1);
});
