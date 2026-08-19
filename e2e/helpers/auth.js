const crypto = require('node:crypto');

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...String(value).replace(/=+$/g, '').toUpperCase()]
    .map((character) => alphabet.indexOf(character).toString(2).padStart(5, '0')).join('');
  return Buffer.from((bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)));
}

function totpCode(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}

async function bodyOrError(response, operation) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${operation} failed with HTTP ${response.status()}: ${body.code || body.error || 'unknown error'}`);
  return body;
}

async function loginActor(request, apiUrl, actor) {
  const primary = await bodyOrError(await request.post(`${apiUrl}/auth/login`, {
    data: { email: actor.email, password: actor.password },
  }), 'Primary login');
  if (!primary.twoFactorRequired) return primary;
  const code = actor.totpSecret ? totpCode(actor.totpSecret) : actor.backupCode;
  return bodyOrError(await request.post(`${apiUrl}/auth/login/2fa`, {
    data: { tempToken: primary.tempToken, code },
  }), 'MFA login');
}

function authHeaders(session, mode) {
  return {
    Authorization: `Bearer ${session.token}`,
    ...(mode ? { 'X-Maslaxat-Mode': mode } : {}),
  };
}

function registrationEmail(runId, project, retry) {
  const values = [runId, project, `r${retry}`];
  if (values.some((value) => !/^[A-Za-z0-9._-]+$/.test(String(value)))) throw new Error('Unsafe registration identity');
  return `${runId}.registration.${project}.r${retry}@e2e.maslaxat.invalid`.toLowerCase();
}

async function authenticatePage(page, request, apiUrl, actor, mode = actor.preferredMode) {
  const session = await loginActor(request, apiUrl, actor);
  await page.addInitScript(({ token, activeMode }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('language', 'ru');
    if (activeMode) localStorage.setItem('maslaxatMode', activeMode);
  }, { token: session.token, activeMode: mode });
  return session;
}

module.exports = { authHeaders, authenticatePage, loginActor, registrationEmail, totpCode };
