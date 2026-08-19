const { withRedisLock } = require('../src/services/jobLock');
const { createManagedJob } = require('../src/services/jobScheduler');

function fakeRedis() {
  let owner = null;
  let renewals = 0;
  return {
    async set(_key, token) {
      if (owner) return null;
      owner = token;
      return 'OK';
    },
    async eval(_script, { arguments: args }) {
      const [token] = args;
      if (token !== owner) return 0;
      if (args.length === 2) {
        renewals += 1;
        return 1;
      }
      owner = null;
      return 1;
    },
    steal() { owner = 'another-replica'; },
    get owner() { return owner; },
    get renewals() { return renewals; },
  };
}

test('renewable lease permits one replica and releases only its owner token', async () => {
  const redis = fakeRedis();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = withRedisLock('reminders', 30, async () => held, { redis, renewEveryMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 2));

  const second = await withRedisLock('reminders', 30, async () => 'must-not-run', { redis });
  expect(second).toEqual({ acquired: false, reason: 'locked' });
  await new Promise((resolve) => setTimeout(resolve, 12));
  expect(redis.renewals).toBeGreaterThan(0);
  release('complete');
  await expect(first).resolves.toEqual({ acquired: true, value: 'complete', lost: false });
  expect(redis.owner).toBeNull();
});

test('lost lease aborts cooperative work and never releases another owner', async () => {
  const redis = fakeRedis();
  const result = withRedisLock('imports', 30, ({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    setTimeout(() => redis.steal(), 3);
  }), { redis, renewEveryMs: 5 });

  await expect(result).rejects.toMatchObject({ code: 'LEASE_LOST' });
  expect(redis.owner).toBe('another-replica');
});

test('non-cooperative work cannot report success after losing its lease', async () => {
  const redis = fakeRedis();
  const result = withRedisLock('non-cooperative', 30, async () => {
    setTimeout(() => redis.steal(), 3);
    await new Promise((resolve) => setTimeout(resolve, 15));
    return 'unsafe-success';
  }, { redis, renewEveryMs: 5 });

  await expect(result).rejects.toMatchObject({ code: 'LEASE_LOST' });
  expect(redis.owner).toBe('another-replica');
});

test('callback completion waits for an in-flight renewal before atomic owner release', async () => {
  let finishRenewal;
  let finishWork;
  const events = [];
  const renewal = new Promise((resolve) => { finishRenewal = resolve; });
  const work = new Promise((resolve) => { finishWork = resolve; });
  const redis = {
    set: async () => 'OK',
    eval: jest.fn(async (_script, { arguments: args }) => {
      if (args.length === 2) {
        events.push('renew:start');
        return renewal;
      }
      events.push('release');
      return 1;
    }),
  };
  let settled = false;
  const result = withRedisLock('completion-race', 30, async () => work, {
    redis, renewEveryMs: 5,
  }).then((value) => { settled = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 8));
  expect(events).toContain('renew:start');
  finishWork('done');
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(events).not.toContain('release');
  finishRenewal(1);

  await expect(result).resolves.toEqual({ acquired: true, value: 'done', lost: false });
  expect(events.at(-1)).toBe('release');
});

test('owner mismatch or release failure after callback completion is lease loss', async () => {
  const mismatch = {
    set: async () => 'OK',
    eval: async (_script, { arguments: args }) => args.length === 1 ? 0 : 1,
  };
  await expect(withRedisLock('release-mismatch', 100, async () => 'unsafe', { redis: mismatch }))
    .rejects.toMatchObject({ code: 'LEASE_LOST' });

  const failed = {
    set: async () => 'OK',
    eval: async (_script, { arguments: args }) => {
      if (args.length === 1) throw new Error('redis down during release');
      return 1;
    },
  };
  await expect(withRedisLock('release-failed', 100, async () => 'unsafe', { redis: failed }))
    .rejects.toMatchObject({ code: 'LEASE_LOST' });
});

test('Redis failure skips locked work', async () => {
  const run = jest.fn();
  const result = await withRedisLock('cleanup', 1000, run, {
    redis: { set: async () => { throw new Error('down'); } },
  });
  expect(result).toEqual({ acquired: false, reason: 'redis_unavailable' });
  expect(run).not.toHaveBeenCalled();
});

test('managed recursive scheduler never overlaps and stop cancels future runs', async () => {
  const callbacks = [];
  const timers = {
    setTimeout(fn) { callbacks.push(fn); return fn; },
    clearTimeout(handle) { const index = callbacks.indexOf(handle); if (index >= 0) callbacks.splice(index, 1); },
  };
  let finish;
  const runOnce = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
  const job = createManagedJob({
    name: 'test', intervalMs: 100, ttlMs: 200, initialDelayMs: 0, runOnce, timers,
    withLock: async (_name, _ttl, fn) => fn({ signal: new AbortController().signal }),
  });

  job.start();
  const firstTick = callbacks.shift();
  const running = firstTick();
  expect(runOnce).toHaveBeenCalledTimes(1);
  expect(callbacks).toHaveLength(0);
  finish();
  await running;
  expect(callbacks).toHaveLength(1);
  job.stop();
  expect(callbacks).toHaveLength(0);
});

test('managed scheduler pause synchronously prevents new runs without aborting active work', async () => {
  const callbacks = [];
  const timers = {
    setTimeout(fn) { callbacks.push(fn); return fn; },
    clearTimeout(handle) { const index = callbacks.indexOf(handle); if (index >= 0) callbacks.splice(index, 1); },
  };
  const job = createManagedJob({
    name: 'pause', intervalMs: 100, ttlMs: 200, initialDelayMs: 0,
    runOnce: jest.fn(), timers,
    withLock: async (_name, _ttl, fn) => fn({ signal: new AbortController().signal }),
  });
  job.start();
  expect(callbacks).toHaveLength(1);
  job.pause();
  expect(callbacks).toHaveLength(0);
  expect(job.isRunning()).toBe(false);
});

test('managed scheduler aborts an active long run and stop awaits its completion', async () => {
  const callbacks = [];
  const timers = {
    setTimeout(fn) { callbacks.push(fn); return fn; },
    clearTimeout(handle) { const index = callbacks.indexOf(handle); if (index >= 0) callbacks.splice(index, 1); },
  };
  let observedSignal;
  const runOnce = jest.fn((_now, { signal }) => new Promise((resolve) => {
    observedSignal = signal;
    signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  }));
  const job = createManagedJob({
    name: 'long-job', intervalMs: 100, ttlMs: 200, initialDelayMs: 0, runOnce, timers,
    withLock: async (_name, _ttl, fn) => fn({ signal: new AbortController().signal }),
  });

  job.start();
  const tick = callbacks.shift();
  const running = tick();
  expect(observedSignal.aborted).toBe(false);

  const stopped = job.stop();
  expect(observedSignal.aborted).toBe(true);
  await stopped;
  await running;
  expect(job.isRunning()).toBe(false);
  expect(callbacks).toHaveLength(0);
});

test('managed scheduler reports lease loss as a hard job failure', async () => {
  const callbacks = [];
  const onError = jest.fn();
  const job = createManagedJob({
    name: 'lease-loss', intervalMs: 100, ttlMs: 200, initialDelayMs: 0,
    runOnce: jest.fn(), onError,
    timers: {
      setTimeout(fn) { callbacks.push(fn); return fn; },
      clearTimeout() {},
    },
    withLock: async () => { throw Object.assign(new Error('lost'), { code: 'LEASE_LOST' }); },
  });
  job.start();
  await callbacks.shift()();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'LEASE_LOST' }), 'lease-loss');
});

test('managed scheduler treats its own cooperative stop abort as a clean drain', async () => {
  const callbacks = [];
  const onError = jest.fn();
  const job = createManagedJob({
    name: 'clean-stop', intervalMs: 100, ttlMs: 200, initialDelayMs: 0, onError,
    timers: {
      setTimeout(fn) { callbacks.push(fn); return fn; }, clearTimeout() {},
    },
    withLock: async (_name, _ttl, fn) => fn({ signal: new AbortController().signal }),
    runOnce: (_now, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  job.start();
  const ticking = callbacks.shift()();
  const stopping = job.stop();
  await expect(job.wait()).resolves.toBeUndefined();
  await expect(stopping).resolves.toBeUndefined();
  await ticking;
  expect(onError).not.toHaveBeenCalled();
});
