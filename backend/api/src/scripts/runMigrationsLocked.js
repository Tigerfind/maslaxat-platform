const { spawn } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const {
  prepareMigrationBackupGate,
  verifyMigrationBackupTarget,
} = require('./validateMigrationBackupEvidence');

const LOCK_NAMESPACE = 1162691404;
const LOCK_ID = 1;
const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectionConfig(env = process.env) {
  const ssl = env.DB_SSL === '1' || /sslmode=require/.test(env.DATABASE_URL || '')
    ? { rejectUnauthorized: false }
    : undefined;
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL, ssl };
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD || undefined,
    ssl,
  };
}

function runChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) return resolve(SIGNAL_EXIT_CODES[signal] || 1);
      return resolve(Number.isInteger(code) ? code : 1);
    });
  });
}

async function runLockedMigrations({
  Client: ClientClass = Client,
  spawn: spawnChild = spawn,
  signalBus = process,
  waitMs = Number(process.env.MIGRATION_LOCK_WAIT_MS || 120000),
  pollMs = Number(process.env.MIGRATION_LOCK_POLL_MS || 1000),
  env = process.env,
  prepareBackupGate = prepareMigrationBackupGate,
  verifyBackupTarget = verifyMigrationBackupTarget,
} = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 600000) {
    throw new Error('MIGRATION_LOCK_WAIT_MS must be between 0 and 600000');
  }
  if (!Number.isFinite(pollMs) || pollMs < 1 || pollMs > 10000) {
    throw new Error('MIGRATION_LOCK_POLL_MS must be between 1 and 10000');
  }

  const apiRoot = path.resolve(__dirname, '../..');
  const preparedBackupGate = prepareBackupGate({ env, migrationsDir: path.join(apiRoot, 'migrations') });
  const client = new ClientClass(connectionConfig(env));
  let acquired = false;
  let child;
  const forwardSignal = (signal) => {
    if (child?.kill) child.kill(signal);
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');

  try {
    await client.connect();
    const deadline = Date.now() + waitMs;
    do {
      const result = await client.query(
        'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
        [LOCK_NAMESPACE, LOCK_ID]
      );
      acquired = result.rows[0]?.acquired === true;
      if (!acquired && Date.now() < deadline) await delay(pollMs);
    } while (!acquired && Date.now() < deadline);
    if (!acquired) throw new Error(`Migration advisory lock was not acquired within ${waitMs}ms`);
    await verifyBackupTarget(client, preparedBackupGate);

    const executable = path.join(apiRoot, 'node_modules', '.bin', 'sequelize-cli');
    child = spawnChild(executable, ['db:migrate'], {
      cwd: apiRoot,
      env,
      stdio: 'inherit',
    });
    signalBus.on('SIGINT', onSigint);
    signalBus.on('SIGTERM', onSigterm);
    return await runChild(child);
  } finally {
    signalBus.off?.('SIGINT', onSigint);
    signalBus.off?.('SIGTERM', onSigterm);
    try {
      if (acquired) {
        await client.query(
          'SELECT pg_advisory_unlock($1::integer, $2::integer) AS released',
          [LOCK_NAMESPACE, LOCK_ID]
        );
      }
    } finally {
      await client.end();
    }
  }
}

async function main() {
  try {
    process.exitCode = await runLockedMigrations();
  } catch (error) {
    process.stderr.write(`Migration gate failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { connectionConfig, runLockedMigrations };
