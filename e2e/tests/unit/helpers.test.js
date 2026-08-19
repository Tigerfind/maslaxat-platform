const assert = require('node:assert/strict');
const test = require('node:test');

test('service URLs must be local HTTP or explicit HTTPS staging URLs', () => {
  const { validatedServiceUrl } = require('../../helpers/http');
  assert.equal(validatedServiceUrl('http://127.0.0.1:3001', 'API'), 'http://127.0.0.1:3001');
  assert.equal(validatedServiceUrl('https://staging.example.test/', 'API'), 'https://staging.example.test');
  assert.throws(() => validatedServiceUrl('ftp://example.test', 'API'), /HTTP/i);
  assert.throws(() => validatedServiceUrl('http://public.example.test', 'API'), /HTTPS/i);
});

test('target safety refuses production-like hosts before readiness', () => {
  const { assertSafeTarget } = require('../../helpers/http');
  assert.throws(() => assertSafeTarget({
    frontendUrl: 'https://production.maslaxat.example',
    apiUrl: 'https://api.production.maslaxat.example/api',
    env: { E2E_TARGET_ENV: 'staging', E2E_CONFIRM_TARGET: 'staging:https://production.maslaxat.example:https://api.production.maslaxat.example' },
  }), /production/i);
});

test('target safety refuses production hosts even when exact confirmation matches', () => {
  const { assertSafeTarget } = require('../../helpers/http');
  assert.throws(() => assertSafeTarget({
    frontendUrl: 'https://emaslaxat.uz',
    apiUrl: 'https://api.emaslaxat.uz/api',
    env: {
      E2E_TARGET_ENV: 'staging',
      E2E_CONFIRM_TARGET: 'staging:https://emaslaxat.uz:https://api.emaslaxat.uz',
    },
  }), /test, e2e, or staging label/i);
});

test('target safety requires a safe label and exact origin confirmation', () => {
  const { assertSafeTarget } = require('../../helpers/http');
  const input = {
    frontendUrl: 'https://pilot-staging.example.test',
    apiUrl: 'https://api-staging.example.test/api',
  };
  assert.throws(() => assertSafeTarget({ ...input, env: { E2E_TARGET_ENV: 'preview' } }), /test, e2e, or staging/i);
  assert.throws(() => assertSafeTarget({ ...input, env: { E2E_TARGET_ENV: 'staging', E2E_CONFIRM_TARGET: 'wrong' } }), /exactly match/i);
  assert.deepEqual(assertSafeTarget({
    ...input,
    env: { E2E_TARGET_ENV: 'staging', E2E_CONFIRM_TARGET: 'staging:https://pilot-staging.example.test:https://api-staging.example.test' },
  }), {
    label: 'staging',
    frontend: 'https://pilot-staging.example.test',
    api: 'https://api-staging.example.test/api',
  });
});

test('registration identity changes for every retry and remains run-owned', () => {
  const { registrationEmail } = require('../../helpers/auth');
  assert.equal(registrationEmail('run-1', 'chromium', 0), 'run-1.registration.chromium.r0@e2e.maslaxat.invalid');
  assert.equal(registrationEmail('run-1', 'chromium', 1), 'run-1.registration.chromium.r1@e2e.maslaxat.invalid');
});

test('readiness failures are reported as blocked rather than skipped', async () => {
  const { requireReady } = require('../../helpers/http');
  await assert.rejects(
    requireReady('http://127.0.0.1:3001/api/health', 'API', async () => { throw new Error('offline'); }),
    /E2E blocked: API is not reachable/
  );
});

test('readiness rejects a reachable service that does not expose the expected endpoint', async () => {
  const { requireReady } = require('../../helpers/http');
  await assert.rejects(
    requireReady('https://staging.example.test/api/ready', 'API', async () => ({ status: 404 })),
    /HTTP 404/
  );
});

test('seed subprocess environment strips every external provider credential', () => {
  const { seedEnvironment } = require('../../helpers/seed-process');
  const result = seedEnvironment({
    NODE_ENV: 'test', DB_NAME: 'emaslaxat_e2e', E2E_RUN_ID: 'run-1',
    E2E_CONFIRM_DATABASE: 'emaslaxat_e2e', PAYME_KEY: 'secret', ANTHROPIC_API_KEY: 'secret',
    SMTP_PASS: 'secret', GOOGLE_CLIENT_ID: 'secret', R2_SECRET_ACCESS_KEY: 'secret',
  });
  assert.equal(result.DB_NAME, 'emaslaxat_e2e');
  assert.equal(result.E2E_RUN_ID, 'run-1');
  assert.equal(result.PAYME_KEY, undefined);
  assert.equal(result.ANTHROPIC_API_KEY, undefined);
  assert.equal(result.SMTP_PASS, undefined);
  assert.equal(result.GOOGLE_CLIENT_ID, undefined);
  assert.equal(result.R2_SECRET_ACCESS_KEY, undefined);
});

test('seed state rejects missing actors instead of creating partial fixtures', () => {
  const { validateSeedState } = require('../../fixtures/contracts');
  assert.throws(() => validateSeedState({ runId: 'run-1', actors: {} }), /client/i);
});

test('seed state accepts complete deterministic actor credentials', () => {
  const { validateSeedState } = require('../../fixtures/contracts');
  const actor = (role) => ({ id: `${role}-id`, email: `${role}@e2e.maslaxat.invalid`, password: 'E2e-pass-123!' });
  const state = {
    runId: 'run-1',
    actors: {
      client: actor('client'), otherClient: actor('other-client'), lawyer: actor('lawyer'),
      otherLawyer: actor('other-lawyer'), applicant: actor('applicant'), importer: actor('importer'), dualMember: actor('dual'),
      mfaLawyer: { ...actor('mfa'), backupCode: 'TASK-7001', totpSecret: 'JBSWY3DPEHPK3PXP' },
      admin: { ...actor('admin'), totpSecret: 'JBSWY3DPEHPK3PXP' },
    },
    resources: {
      consultationId: 'consultation-id', otherConsultationId: 'other-consultation-id',
      promotionId: 'promotion-id', refundPromotionId: 'refund-promotion-id', refundPaymentId: 'refund-payment-id',
      importId: 'import-id', documentId: 'document-id', applicantDocumentId: 'applicant-document-id', packageId: 'package-id',
    },
  };
  assert.equal(validateSeedState(state), state);
});

test('login helper completes primary and MFA login without leaking credentials', async () => {
  const { loginActor } = require('../../helpers/auth');
  const calls = [];
  const request = {
    post: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/login')) return { ok: () => true, json: async () => ({ twoFactorRequired: true, tempToken: 'temporary' }) };
      return { ok: () => true, json: async () => ({ token: 'mfa-token', capabilities: ['lawyer'] }) };
    },
  };
  const result = await loginActor(request, 'https://staging.example.test/api', {
    email: 'lawyer@e2e.maslaxat.invalid', password: 'pw', backupCode: 'BACKUP', preferredMode: 'lawyer',
  });
  assert.equal(result.token, 'mfa-token');
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://staging.example.test/api/auth/login',
    'https://staging.example.test/api/auth/login/2fa',
  ]);
});

test('accessible selector contracts use role and label locators', () => {
  const { byButton, byField } = require('../../helpers/selectors');
  const calls = [];
  const page = {
    getByRole: (role, options) => { calls.push(['role', role, options]); return 'button'; },
    getByLabel: (label) => { calls.push(['label', label]); return 'field'; },
  };
  assert.equal(byButton(page, /sign in/i), 'button');
  assert.equal(byField(page, 'Email'), 'field');
  assert.deepEqual(calls, [
    ['role', 'button', { name: /sign in/i }],
    ['label', 'Email'],
  ]);
});
