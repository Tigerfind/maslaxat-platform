const crypto = require('node:crypto');
const defaultSeedModule = require('../seeds/e2e-seed');

const CAPABILITIES = [
  'auth.modeSwitch', 'auth.twoFactor', 'applicant.workflow', 'linkedin.import',
  'linkedin.staleDraft', 'linkedin.provenance', 'promotion.sandboxCheckout',
  'promotion.idempotency', 'promotion.catalog', 'promotion.analytics', 'promotion.refund',
  'chat.bidirectional', 'documents.private', 'webrtc.twoContext',
  'security.apiIdor', 'security.socketIdor',
];

function createE2EFixtureRuntime({ env = process.env, models, seedModule = defaultSeedModule } = {}) {
  const allocations = new Map();
  const tokenFor = (runId) => crypto.createHmac('sha256', env.E2E_TEST_API_SECRET)
    .update(`e2e-run:${runId}`).digest('hex');
  const scopedEnv = (runId) => ({
    ...env,
    DATABASE_URL: env.E2E_DATABASE_URL,
    E2E_CONFIRM_DATABASE: env.E2E_TEST_DB_CONFIRM,
    E2E_RUN_ID: runId,
  });
  const assertToken = (runId, token) => {
    const expected = Buffer.from(tokenFor(runId));
    const actual = Buffer.from(String(token || ''));
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      const error = new Error('Invalid E2E run token');
      error.status = 403;
      error.code = 'INVALID_RUN_TOKEN';
      throw error;
    }
  };
  const fixturesFor = (state) => ({
    clientUserId: state.actors.client.id,
    lawyerUserId: state.actors.lawyer.id,
    attackerUserId: state.actors.otherClient.id,
    adminUserId: state.actors.admin.id,
    privateDocumentId: state.resources.documentId,
    privateConsultationId: state.resources.otherConsultationId,
    chatConsultationId: state.resources.consultationId,
    callConsultationId: state.resources.consultationId,
    importId: state.resources.importId,
    promotionPlanId: state.resources.packageId,
  });

  return {
    async capabilities(runId) {
      const state = seedModule.dataset(runId);
      return {
        schemaVersion: 1,
        targetEnv: String(env.NODE_ENV).toLowerCase(),
        runId,
        capabilities: Object.fromEntries(CAPABILITIES.map((name) => [name, true])),
        fixtures: { ...fixturesFor(state), cleanupToken: tokenFor(runId) },
        prerequisites: {},
      };
    },
    async allocate(runId, input, token) {
      assertToken(runId, token);
      const { scope, ownerMarker } = input || {};
      if (!scope?.startsWith(`${runId}-`) || ownerMarker !== `e2e:${runId}:${scope}`) {
        const error = new Error('Scoped fixture ownership does not match the run');
        error.status = 403;
        error.code = 'OWNERSHIP_MISMATCH';
        throw error;
      }
      const key = `${runId}:${scope}`;
      if (allocations.has(key)) return { created: false, fixture: allocations.get(key) };
      const state = await seedModule.seed({ env: scopedEnv(scope), models });
      const fixture = { scope, ownerMarker, ...fixturesFor(state), seedState: state };
      allocations.set(key, fixture);
      return { created: true, fixture };
    },
    async cleanupScope(runId, scope, token) {
      assertToken(runId, token);
      const key = `${runId}:${scope}`;
      await seedModule.cleanup({ env: scopedEnv(scope), models });
      allocations.delete(key);
      return { cleaned: true };
    },
    async cleanupRun(runId, token) {
      assertToken(runId, token);
      for (const key of [...allocations.keys()]) {
        if (!key.startsWith(`${runId}:`)) continue;
        const scope = key.slice(runId.length + 1);
        await seedModule.cleanup({ env: scopedEnv(scope), models });
        allocations.delete(key);
      }
      return { cleaned: true };
    },
  };
}

module.exports = { CAPABILITIES, createE2EFixtureRuntime };
