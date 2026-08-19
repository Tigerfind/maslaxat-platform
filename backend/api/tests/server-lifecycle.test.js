const { createServerLifecycle } = require('../src/serverLifecycle');

test('graceful shutdown marks unready and closes resources in order', async () => {
  const events = [];
  let lifecycle;
  lifecycle = createServerLifecycle({
    server: {
      close(callback) { events.push('http:close'); callback(); },
      closeIdleConnections() { events.push('http:idle'); },
      closeAllConnections() { events.push('http:all'); },
    },
    io: { close: async () => events.push('socket') },
    jobs: {
      pause: () => events.push(`jobs:pause:ready=${lifecycle.isReady()}`),
      stop: () => events.push(`jobs:stop:ready=${lifecycle.isReady()}`),
    },
    closeAdapter: async () => events.push('adapter'),
    closeRedis: async () => events.push('redis'),
    sequelize: { close: async () => events.push('sequelize') },
    sentry: { flush: async (ms) => events.push(`sentry:${ms}`) },
    exit: (code) => events.push(`exit:${code}`),
    drainMs: 5,
    deadlineMs: 100,
  });
  lifecycle.markReady();
  expect(lifecycle.isReady()).toBe(true);

  await lifecycle.shutdown('SIGTERM');

  expect(lifecycle.isReady()).toBe(false);
  expect(events).toEqual([
    'jobs:pause:ready=false', 'http:close', 'http:idle', 'socket', 'jobs:stop:ready=false',
    'adapter', 'redis', 'sequelize', 'sentry:2000', 'exit:0',
  ]);
});

test('shutdown deadline force-closes HTTP and a second signal forces exit', async () => {
  const events = [];
  const lifecycle = createServerLifecycle({
    server: {
      close() { events.push('http:close'); },
      closeIdleConnections() {},
      closeAllConnections() { events.push('http:all'); },
    },
    io: { close: async () => {} },
    jobs: { pause() {}, stop() {} },
    closeAdapter: async () => {},
    closeRedis: async () => {},
    sequelize: { close: async () => {} },
    sentry: { flush: async () => {} },
    exit: (code) => events.push(`exit:${code}`),
    drainMs: 5,
    deadlineMs: 100,
  });

  const running = lifecycle.shutdown('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toContain('http:all');
  await running;
  expect(events).toContain('exit:0');
  expect(events).not.toContain('exit:1');

  const hanging = createServerLifecycle({
    server: { close() {}, closeIdleConnections() {}, closeAllConnections() {} },
    io: { close: async () => new Promise(() => {}) },
    jobs: { pause() {}, stop() {} },
    closeAdapter: async () => {}, closeRedis: async () => {},
    sequelize: { close: async () => {} }, sentry: { flush: async () => {} },
    exit: (code) => events.push(`forced:${code}`), deadlineMs: 1000, drainMs: 1000,
  });
  hanging.shutdown('SIGTERM');
  await hanging.shutdown('SIGINT');
  expect(events).toContain('forced:1');
});

test('embedded lifecycle shutdown drains resources without terminating its host process', async () => {
  const exit = jest.fn();
  const lifecycle = createServerLifecycle({
    server: { close: (callback) => callback(), closeIdleConnections() {}, closeAllConnections() {} },
    io: { close: async () => {} },
    jobs: { pause() {}, stop() {} },
    closeAdapter: async () => {}, closeRedis: async () => {},
    sequelize: { close: async () => {} }, sentry: { flush: async () => {} },
    exit,
  });

  await lifecycle.shutdown('RESTORE_SMOKE', { exitProcess: false });
  expect(exit).not.toHaveBeenCalled();
});
