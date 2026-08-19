function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function closeSocket(io) {
  if (!io?.close) return Promise.resolve();
  if (io.close.length > 0) return new Promise((resolve) => io.close(resolve));
  return Promise.resolve(io.close());
}

function closeHttp(server, drainMs) {
  if (!server?.close) return Promise.resolve();
  let finished = false;
  const closed = new Promise((resolve) => {
    server.close(() => {
      finished = true;
      resolve();
    });
  });
  server.closeIdleConnections?.();
  const forced = delay(drainMs).then(() => {
    if (!finished) server.closeAllConnections?.();
  });
  return Promise.race([closed, forced]);
}

function createServerLifecycle({
  server,
  io,
  jobs,
  closeAdapter,
  closeRedis,
  sequelize,
  sentry,
  exit = process.exit,
  drainMs = 10_000,
  deadlineMs = 20_000,
}) {
  let ready = false;
  let shuttingDown = false;

  async function shutdown(signal = 'SIGTERM', { exitProcess = true } = {}) {
    if (shuttingDown) {
      if (exitProcess) exit(1);
      return;
    }
    shuttingDown = true;
    ready = false;
    const work = (async () => {
      jobs?.pause?.();
      const httpDrain = closeHttp(server, drainMs);
      const socketDrain = closeSocket(io);
      const jobStopDrain = Promise.resolve(jobs?.stop?.());
      await Promise.all([httpDrain, socketDrain, jobStopDrain]);
      await closeAdapter?.();
      await closeRedis?.();
      await sequelize?.close?.();
      await sentry?.flush?.(2000);
      if (exitProcess) exit(0);
    })();
    const deadline = delay(deadlineMs).then(() => {
      throw Object.assign(new Error(`Shutdown deadline exceeded after ${signal}`), { code: 'SHUTDOWN_DEADLINE' });
    });
    try {
      await Promise.race([work, deadline]);
    } catch (_error) {
      server?.closeAllConnections?.();
      if (exitProcess) exit(1);
      else throw Object.assign(new Error('Server shutdown failed'), { code: 'SHUTDOWN_FAILED' });
    }
  }

  return {
    markReady() { if (!shuttingDown) ready = true; },
    isReady() { return ready && !shuttingDown; },
    isShuttingDown() { return shuttingDown; },
    shutdown,
  };
}

function installShutdownHandlers(lifecycle, signalBus = process) {
  const handler = (signal) => { lifecycle.shutdown(signal); };
  signalBus.on('SIGTERM', handler);
  signalBus.on('SIGINT', handler);
  return () => {
    signalBus.removeListener('SIGTERM', handler);
    signalBus.removeListener('SIGINT', handler);
  };
}

module.exports = { createServerLifecycle, installShutdownHandlers };
