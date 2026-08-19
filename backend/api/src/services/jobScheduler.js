const { withRedisLock } = require('./jobLock');

function createManagedJob({
  name,
  intervalMs,
  ttlMs,
  runOnce,
  initialDelayMs = intervalMs,
  withLock = withRedisLock,
  timers = { setTimeout, clearTimeout },
  onError = () => {},
}) {
  if (!name || !Number.isInteger(intervalMs) || intervalMs < 1
    || !Number.isInteger(ttlMs) || ttlMs < 10 || typeof runOnce !== 'function') {
    throw new TypeError('Valid managed job configuration is required');
  }
  let active = false;
  let timer = null;
  let running = null;
  let runController = null;

  const combinedSignal = (signals) => {
    const controller = new AbortController();
    const abort = (signal) => controller.abort(signal.reason);
    for (const signal of signals) {
      if (signal.aborted) {
        abort(signal);
        break;
      }
      signal.addEventListener('abort', () => abort(signal), { once: true });
    }
    return controller.signal;
  };

  const schedule = (delay) => {
    if (!active) return;
    timer = timers.setTimeout(tick, delay);
    timer?.unref?.();
  };
  const tick = async () => {
    timer = null;
    if (!active || running) return;
    runController = new AbortController();
    running = withLock(name, ttlMs, ({ signal }) => runOnce(new Date(), {
      signal: combinedSignal([runController.signal, signal]),
    }));
    try {
      await running;
    } catch (error) {
      if (active || error?.code !== 'ABORT_ERR') onError(error, name);
    } finally {
      running = null;
      runController = null;
      schedule(intervalMs);
    }
  };
  const awaitRunning = () => running
    ? running.catch((error) => {
      if (!active && error?.code === 'ABORT_ERR') return undefined;
      throw error;
    })
    : Promise.resolve();
  const pause = () => {
    active = false;
    if (timer) timers.clearTimeout(timer);
    timer = null;
  };
  return {
    name,
    start() {
      if (active) return this;
      active = true;
      schedule(initialDelayMs);
      return this;
    },
    pause,
    stop() {
      pause();
      if (runController && !runController.signal.aborted) {
        runController.abort(Object.assign(new Error('Scheduled job stopped'), {
          name: 'AbortError', code: 'ABORT_ERR',
        }));
      }
      return awaitRunning();
    },
    wait() { return awaitRunning(); },
    isRunning() { return Boolean(running); },
  };
}

module.exports = { createManagedJob };
