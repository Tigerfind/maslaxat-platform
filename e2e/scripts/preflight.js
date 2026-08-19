const { assertSafeTarget, requireReady } = require('../helpers/http');
const { runSeed } = require('../helpers/seed-process');

async function main() {
  const frontend = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
  const api = (process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
  assertSafeTarget({ frontendUrl: frontend, apiUrl: api });
  await runSeed('verify');
  await Promise.all([requireReady(frontend, 'frontend'), requireReady(`${api}/ready`, 'API readiness')]);
  process.stdout.write('E2E preflight passed; no browser test was run.\n');
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
