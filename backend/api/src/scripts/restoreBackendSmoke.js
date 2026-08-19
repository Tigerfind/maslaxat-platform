'use strict';

const http = require('http');

function requestJson(baseUrl, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}${pathname}`, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (_error) {
          reject(new Error(`${pathname} returned invalid JSON`));
          return;
        }
        resolve({ statusCode: response.statusCode, payload });
      });
    });
    request.once('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error(`${pathname} timeout`)));
  });
}

async function probeApplication(baseUrl) {
  const live = await requestJson(baseUrl, '/api/live');
  if (live.statusCode !== 200 || live.payload.status !== 'live') throw new Error('live probe failed');
  const ready = await requestJson(baseUrl, '/api/ready');
  if (ready.statusCode !== 200 || ready.payload.status !== 'ready') throw new Error('ready dependency probe failed');
  const core = await requestJson(baseUrl, '/api/lawyers?limit=1');
  if (core.statusCode !== 200 || !core.payload || typeof core.payload !== 'object') throw new Error('core API probe failed');
  return { live: 'live', ready: 'ready', core: 'ok' };
}

async function runRestoreBackendSmoke({
  databaseUrl,
  loadRuntime = () => require('../server'),
}) {
  if (!databaseUrl) throw new Error('RESTORE_DATABASE_URL is required');
  const runtime = loadRuntime();
  let started = false;
  try {
    const state = await runtime.start({ restoreSmoke: true, databaseUrl });
    started = true;
    await probeApplication(state.baseUrl);
    return {
      migrationState: 'ok',
      readiness: 'ok',
      apiSmoke: 'ok',
      appliedCount: state.migrationState.appliedCount,
    };
  } finally {
    if (started) await runtime.shutdown('RESTORE_SMOKE');
  }
}

if (require.main === module) {
  runRestoreBackendSmoke({ databaseUrl: process.env.RESTORE_DATABASE_URL })
    .then((result) => {
      process.stdout.write(`migration_state=${result.migrationState}\n`);
      process.stdout.write(`readiness=${result.readiness}\n`);
      process.stdout.write(`api_smoke=${result.apiSmoke}\n`);
      process.stdout.write(`applied_count=${result.appliedCount}\n`);
    })
    .catch((error) => {
      process.stderr.write(`restore backend smoke failed: ${error.code || error.name || 'error'}\n`);
      process.exit(1);
    });
}

module.exports = { probeApplication, runRestoreBackendSmoke };
