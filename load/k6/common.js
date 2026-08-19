import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const DEFAULT_PRODUCTION_HOSTS = 'maslaxat.uz,www.maslaxat.uz,app.maslaxat.uz,api.maslaxat.uz';

export const REQUEST_WEIGHTS = Object.freeze({
  catalog: 43,
  dashboards: 14,
  authProfile: 13,
  consultations: 14,
  chatHistory: 10,
  checkoutSandbox: 6,
});

export const THRESHOLDS = Object.freeze({
  'http_req_failed{phase:measure}': ['rate<0.01'],
  'read_duration{phase:measure}': ['p(95)<500'],
  'write_duration{phase:measure}': ['p(95)<1000'],
  'catalog_duration{phase:measure}': ['p(95)<500'],
  'auth_duration{phase:measure}': ['p(95)<800'],
  'consultation_create_duration{phase:measure}': ['p(95)<1000'],
  'chat_duration{phase:measure}': ['p(95)<500'],
  'checkout_sandbox_duration{phase:measure}': ['p(95)<1000'],
  'checkout_duplicates': ['count==0'],
  'verification_failures': ['count==0'],
  'cleanup_failures': ['count==0'],
});

const readDuration = new Trend('read_duration', true);
const writeDuration = new Trend('write_duration', true);
const catalogDuration = new Trend('catalog_duration', true);
const authDuration = new Trend('auth_duration', true);
const consultationCreateDuration = new Trend('consultation_create_duration', true);
const chatDuration = new Trend('chat_duration', true);
const checkoutDuration = new Trend('checkout_sandbox_duration', true);
const checkoutDuplicates = new Counter('checkout_duplicates');
const verificationFailures = new Counter('verification_failures');
const cleanupFailures = new Counter('cleanup_failures');
let clientToken;

function required(name) {
  const value = String(__ENV[name] || '').trim();
  if (!value) fail(`${name} is required`);
  return value;
}

function hostSet(value) {
  return new Set(String(value || '').split(',').map(normalizeHost).filter(Boolean));
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

function isDeniedHost(host, deniedHosts) {
  for (const denied of deniedHosts) {
    if (host === denied || host.endsWith(`.${denied}`)) return true;
  }
  return false;
}

export function assertApprovedTarget() {
  if (__ENV.APP_ENV !== 'staging') fail('APP_ENV must be staging');
  if (__ENV.LOAD_TEST_ENABLED !== 'true') fail('LOAD_TEST_ENABLED must be true');
  if (__ENV.K6_LOAD_APPROVED !== 'true') fail('K6_LOAD_APPROVED must be true');
  if (__ENV.PAYMENT_SANDBOX_ENABLED !== 'true') fail('PAYMENT_SANDBOX_ENABLED must be true');

  const target = new URL(required('BASE_URL'));
  if (target.protocol !== 'https:') fail('BASE_URL must use HTTPS');
  const allowed = hostSet(required('LOAD_TEST_ALLOWED_HOSTS'));
  const production = new Set([
    ...hostSet(DEFAULT_PRODUCTION_HOSTS),
    ...hostSet(__ENV.LOAD_TEST_PRODUCTION_HOSTS),
  ]);
  const host = normalizeHost(target.hostname);
  if (!allowed.has(host)) fail('BASE_URL host is not in LOAD_TEST_ALLOWED_HOSTS');
  if (isDeniedHost(host, production)) fail('Production hosts are forbidden');
  return target.origin;
}

function loadManifest() {
  const manifestPath = required('LOAD_TEST_MANIFEST');
  return JSON.parse(open(manifestPath));
}

const manifest = loadManifest();

function requestParams(token, name, phase) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Maslaxat-Mode': 'client',
    },
    tags: { endpoint: name, phase: phase || (exec.scenario.name === 'warmup' ? 'warmup' : 'measure') },
  };
}

function recordRead(response, metric) {
  const phase = exec.scenario.name === 'warmup' ? 'warmup' : 'measure';
  readDuration.add(response.timings.duration, { phase });
  metric.add(response.timings.duration, { phase });
  check(response, { 'read succeeded': (result) => result.status >= 200 && result.status < 300 });
}

function recordWrite(response, metric) {
  const phase = exec.scenario.name === 'warmup' ? 'warmup' : 'measure';
  writeDuration.add(response.timings.duration, { phase });
  metric.add(response.timings.duration, { phase });
  check(response, { 'write succeeded': (result) => result.status >= 200 && result.status < 300 });
}

function chooseClient() {
  return manifest.clients[(exec.vu.idInTest - 1) % manifest.clients.length];
}

function login(baseUrl, client, phase = 'setup') {
  const response = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({
    email: client.email,
    password: required('LOAD_TEST_PASSWORD'),
  }), { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login', phase } });
  check(response, { 'login succeeded': (result) => result.status === 200 && Boolean(result.json('token')) });
  return response.json('token');
}

function attestTargetDatabase(baseUrl) {
  const expectedFingerprint = required('LOAD_TARGET_DB_FINGERPRINT').toLowerCase();
  const nonce = required('LOAD_DB_ATTESTATION_NONCE');
  const runId = required('E2E_RUN_ID');
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) fail('LOAD_TARGET_DB_FINGERPRINT is invalid');
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(nonce)) fail('LOAD_DB_ATTESTATION_NONCE is invalid');
  const response = http.get(
    `${baseUrl}/api/e2e/integrations/status?runId=${encodeURIComponent(runId)}&nonce=${encodeURIComponent(nonce)}`,
    {
      headers: {
        Authorization: `Bearer ${required('E2E_TEST_API_TOKEN')}`,
        'x-e2e-test-secret': required('E2E_TEST_API_SECRET'),
        'x-e2e-safety-nonce': nonce,
      },
      tags: { endpoint: 'database-attestation', phase: 'preflight' },
    },
  );
  let body;
  try { body = response.json(); } catch (error) { fail('Target database attestation returned invalid JSON'); }
  if (response.status !== 200
    || body.databaseFingerprint !== expectedFingerprint
    || body.safe !== true
    || body.integrations?.payme !== 'disabled'
    || body.integrations?.claude !== 'disabled'
    || body.integrations?.smtp !== 'stubbed'
    || body.integrations?.push !== 'disabled'
    || body.integrations?.jobs !== 'disabled') {
    fail('Target database attestation failed');
  }
}

export function setupHarness(profile) {
  const baseUrl = assertApprovedTarget();
  const runId = required('LOAD_TEST_RUN_ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{5,39}$/.test(runId)) fail('LOAD_TEST_RUN_ID is invalid');
  if (manifest.clients.length !== 200 || manifest.lawyers.length !== 50 || manifest.consultations.length !== 1000) {
    fail('LOAD_TEST_MANIFEST does not contain the exact audited dataset');
  }
  if (manifest.clients.some((client) => client.checkoutConsultationIds.length !== 1)) {
    fail('Every load client must have exactly one checkout consultation');
  }
  attestTargetDatabase(baseUrl);
  const preflightToken = login(baseUrl, manifest.clients[0], 'preflight');
  if (!preflightToken) fail('Load preflight authentication failed');
  const preflightResponse = http.get(
    `${baseUrl}/api/load-test/preflight?profile=${encodeURIComponent(profile)}`,
    requestParams(preflightToken, 'load-preflight', 'preflight'),
  );
  const preflight = preflightResponse.status === 200 ? preflightResponse.json() : null;
  if (!preflight || preflight.safe !== true || preflight.profile !== profile) {
    fail(`Load preflight refused ${profile}: insufficient effective rate-limit capacity`);
  }
  return { baseUrl, runId, profile, preflight };
}

export function teardownHarness(data) {
  const client = manifest.clients[0];
  const token = login(data.baseUrl, client, 'verify');
  if (!token) {
    verificationFailures.add(1);
    cleanupFailures.add(1);
    return;
  }
  const response = http.get(
    `${data.baseUrl}/api/load-test/verify?runId=${encodeURIComponent(data.runId)}`,
    requestParams(token, 'checkout-verification', 'verify'),
  );
  const validResponse = response.status === 200
    && Number.isInteger(response.json('duplicateBusinessObjects'));
  if (validResponse) {
    verificationFailures.add(0);
    checkoutDuplicates.add(response.json('duplicateBusinessObjects'));
  } else {
    verificationFailures.add(1);
  }

  const cleanupResponse = http.del(
    `${data.baseUrl}/api/load-test/runs/${encodeURIComponent(data.runId)}`,
    null,
    requestParams(token, 'load-cleanup', 'verify'),
  );
  const cleanup = cleanupResponse.status === 200 ? cleanupResponse.json() : null;
  cleanupFailures.add(cleanup && cleanup.runId === data.runId ? 0 : 1);
}

function artifactDirectory() {
  const directory = required('LOAD_TEST_ARTIFACT_DIR');
  if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/.test(directory)) {
    fail('LOAD_TEST_ARTIFACT_DIR is invalid');
  }
  return directory.replace(/\/$/, '');
}

export function summaryHarness(summary, profile) {
  const runId = required('LOAD_TEST_RUN_ID');
  const commitSha = required('LOAD_TEST_COMMIT_SHA');
  const startedAt = required('LOAD_TEST_STARTED_AT');
  if (!/^[A-Fa-f0-9]{7,40}$/.test(commitSha)) fail('LOAD_TEST_COMMIT_SHA is invalid');
  if (Number.isNaN(Date.parse(startedAt))) fail('LOAD_TEST_STARTED_AT is invalid');
  const metadata = {
    schemaVersion: 1,
    runId,
    profile,
    seedVersion: manifest.seedVersion,
    commitSha,
    targetOrigin: new URL(required('BASE_URL')).origin,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
  };
  const artifact = JSON.stringify({ metadata, summary }, null, 2);
  return {
    stdout: `${JSON.stringify(metadata)}\n`,
    [`${artifactDirectory()}/${runId}-${profile}-summary.json`]: `${artifact}\n`,
  };
}

export function runWeightedRequest(data) {
  const client = chooseClient();
  if (!clientToken) clientToken = login(data.baseUrl, client);
  const token = clientToken;
  const params = requestParams(token, 'load-test');
  const roll = Math.floor(Math.random() * 100) + 1;

  if (roll <= 43) {
    const response = http.get(`${data.baseUrl}/api/lawyers?page=1&limit=20`, requestParams(token, 'catalog'));
    recordRead(response, catalogDuration);
    return;
  }
  if (roll <= 57) {
    const response = http.get(`${data.baseUrl}/api/dashboard/client/stats`, requestParams(token, 'dashboard'));
    recordRead(response, readDuration);
    return;
  }
  if (roll <= 70) {
    const response = http.get(`${data.baseUrl}/api/auth/me`, requestParams(token, 'auth-profile'));
    recordRead(response, authDuration);
    return;
  }
  if (roll <= 84) {
    if (roll % 2 === 0) {
      const response = http.get(`${data.baseUrl}/api/consultations?page=1&limit=20`, requestParams(token, 'consultation-list'));
      recordRead(response, readDuration);
    } else {
      const key = `load:${data.runId}:consultation:${client.id}:${exec.scenario.iterationInTest}`;
      const response = http.post(`${data.baseUrl}/api/load-test/consultations`, JSON.stringify({
        lawyerId: manifest.lawyers[exec.scenario.iterationInTest % manifest.lawyers.length].id,
      }), { ...params, headers: { ...params.headers, 'Idempotency-Key': key } });
      recordWrite(response, consultationCreateDuration);
    }
    return;
  }
  const consultationId = client.consultationIds[exec.scenario.iterationInTest % client.consultationIds.length];
  if (roll <= 94) {
    const response = http.get(`${data.baseUrl}/api/chat/${consultationId}/messages`, requestParams(token, 'chat-history'));
    recordRead(response, chatDuration);
    return;
  }

  const checkoutId = client.checkoutConsultationIds[exec.scenario.iterationInTest % client.checkoutConsultationIds.length];
  const response = http.post(`${data.baseUrl}/api/load-test/checkouts`, JSON.stringify({ consultationId: checkoutId }), {
    ...params,
    headers: { ...params.headers, 'Idempotency-Key': `load:${data.runId}:checkout:${client.id}:${checkoutId}` },
  });
  recordWrite(response, checkoutDuration);
  if (response.status >= 200 && response.status < 300 && response.json('businessObjectCount') !== 1) {
    checkoutDuplicates.add(1);
  }
}
