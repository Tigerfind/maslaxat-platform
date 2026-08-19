const express = require('express');

const DEPENDENCIES = ['database', 'redis', 'objectStorage', 'migrations'];

function probeTimeoutError() {
  return Object.assign(new Error('probe timeout'), { code: 'PROBE_TIMEOUT' });
}

function createReadinessProbes({
  sequelize,
  getRedis,
  getObjectStorage,
  assertMigrationState,
  statementTimeoutMs = 900,
}) {
  let databaseInFlight = null;
  let migrationsInFlight = null;
  const inTransaction = (operation) => sequelize.transaction(async (transaction) => {
    await sequelize.query('SET LOCAL statement_timeout = :timeoutMs', {
      replacements: { timeoutMs: statementTimeoutMs }, transaction,
    });
    return operation(transaction);
  });
  const databaseReadiness = ({ signal }) => {
    if (databaseInFlight) return databaseInFlight;
    if (signal.aborted) return Promise.reject(signal.reason);
    const operation = Promise.resolve().then(() => inTransaction(async (transaction) => {
      await sequelize.query('SELECT 1', { transaction });
      return true;
    }));
    const tracked = operation.finally(() => {
      if (databaseInFlight === tracked) databaseInFlight = null;
    });
    databaseInFlight = tracked;
    return tracked;
  };
  const migrationsReadiness = ({ signal }) => {
    if (migrationsInFlight) return migrationsInFlight;
    if (signal.aborted) return Promise.reject(signal.reason);
    const operation = Promise.resolve().then(() => inTransaction(async (transaction) => {
      const scopedSequelize = {
        query: (sql, options = {}) => sequelize.query(sql, { ...options, transaction }),
      };
      await assertMigrationState({ sequelize: scopedSequelize });
      return true;
    }));
    const tracked = operation.finally(() => {
      if (migrationsInFlight === tracked) migrationsInFlight = null;
    });
    migrationsInFlight = tracked;
    return tracked;
  };
  return {
    database: databaseReadiness,
    redis: async ({ signal }) => {
      if (signal.aborted) throw signal.reason;
      const redis = getRedis();
      if (!redis?.isReady) throw new Error('Redis unavailable');
      await redis.ping();
      return true;
    },
    objectStorage: ({ signal }) => getObjectStorage().checkReady({ signal }),
    migrations: migrationsReadiness,
  };
}

function createHealthRouter({
  probes,
  lifecycle,
  dependencyTimeoutMs = 1000,
  totalTimeoutMs = 1500,
}) {
  const router = express.Router();
  const live = (_req, res) => res.status(200).json({ status: 'live' });
  router.get('/live', live);
  router.get('/health', live);
  router.get('/ready', async (_req, res) => {
    if (!lifecycle.isReady()) {
      return res.status(503).json({ status: 'not_ready', failed: ['shutdown'] });
    }
    const activeControllers = new Set();
    const results = new Map();
    const runCheck = async (name) => {
      const controller = new AbortController();
      activeControllers.add(controller);
      let timer;
      try {
        const timedOut = new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = probeTimeoutError();
            controller.abort(error);
            reject(error);
          }, dependencyTimeoutMs);
          timer.unref?.();
        });
        await Promise.race([
          Promise.resolve().then(() => probes[name]({ signal: controller.signal })),
          timedOut,
        ]);
        results.set(name, null);
        return null;
      } catch (_error) {
        results.set(name, name);
        return name;
      } finally {
        clearTimeout(timer);
        activeControllers.delete(controller);
      }
    };
    const databaseCheck = runCheck('database');
    const checks = [
      databaseCheck,
      runCheck('redis'),
      runCheck('objectStorage'),
      databaseCheck.then((databaseFailure) => (
        databaseFailure === null ? runCheck('migrations') : null
      )),
    ];
    let failed;
    let totalTimer;
    try {
      const totalTimeout = new Promise((_, reject) => {
        totalTimer = setTimeout(() => {
          const error = probeTimeoutError();
          for (const controller of activeControllers) controller.abort(error);
          reject(error);
        }, totalTimeoutMs);
        totalTimer.unref?.();
      });
      failed = await Promise.race([Promise.all(checks), totalTimeout]);
    } catch (_error) {
      failed = DEPENDENCIES.filter((name) => (
        results.get(name) === name
        || (!results.has(name) && name !== 'migrations')
        || (!results.has(name) && name === 'migrations' && results.get('database') === null)
      ));
    } finally {
      clearTimeout(totalTimer);
    }
    failed = failed.filter(Boolean);
    return res.status(failed.length ? 503 : 200).json(failed.length
      ? { status: 'not_ready', failed }
      : { status: 'ready' });
  });
  return router;
}

module.exports = { createHealthRouter, createReadinessProbes };
