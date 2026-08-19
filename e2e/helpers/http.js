function validatedServiceUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL must be a valid HTTP URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} URL must use HTTP or HTTPS`);
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error(`${label} URL must use HTTPS outside localhost`);
  }
  return url.toString().replace(/\/$/, '');
}

function assertSafeTarget({ frontendUrl, apiUrl, env = process.env }) {
  const label = String(env.E2E_TARGET_ENV || '').trim().toLowerCase();
  if (!['test', 'e2e', 'staging'].includes(label)) {
    throw new Error('E2E target label must be test, e2e, or staging');
  }
  const frontend = validatedServiceUrl(frontendUrl, 'frontend');
  const api = validatedServiceUrl(apiUrl, 'API');
  const productionLike = /(?:^|[.-])(prod|production|live)(?:[.-]|$)/i;
  const testLike = /(?:^|[.-])(test|e2e|staging)(?:[.-]|$)/i;
  const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
  for (const target of [new URL(frontend), new URL(api)]) {
    if (productionLike.test(target.hostname)) throw new Error('E2E refuses a production-like target host');
    if (!loopback.has(target.hostname) && !testLike.test(target.hostname)) {
      throw new Error('Every non-loopback E2E target hostname must contain a distinct test, e2e, or staging label');
    }
  }
  const expected = `${label}:${new URL(frontend).origin}:${new URL(api).origin}`;
  if (env.E2E_CONFIRM_TARGET !== expected) {
    throw new Error(`E2E_CONFIRM_TARGET must exactly match ${expected}`);
  }
  return { label, frontend, api };
}

async function requireReady(url, label, fetchImpl = fetch) {
  const target = validatedServiceUrl(url, label);
  let response;
  try {
    response = await fetchImpl(target, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
  } catch (error) {
    throw new Error(`E2E blocked: ${label} is not reachable at ${target}: ${error.message}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`E2E blocked: ${label} returned HTTP ${response.status} at ${target}`);
  }
  return target;
}

module.exports = { assertSafeTarget, requireReady, validatedServiceUrl };
