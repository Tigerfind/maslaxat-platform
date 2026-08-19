const base = require('@playwright/test');
const { authenticatePage } = require('../helpers/auth');
const { installFakeMedia } = require('../helpers/fake-media');
const { validateSeedState } = require('./contracts');
const { allocateRemoteFixture, cleanupRemoteFixture } = require('../helpers/remote-fixtures');

const remoteConfig = (apiUrl) => ({
  apiUrl,
  runId: process.env.E2E_RUN_ID,
  cleanupToken: process.env.E2E_FIXTURE_CLEANUP_TOKEN,
  token: process.env.E2E_TEST_API_TOKEN,
  secret: process.env.E2E_TEST_API_SECRET,
  nonce: process.env.E2E_SAFETY_ATTESTATION_NONCE,
});

const test = base.test.extend({
  seedState: async ({ request, apiUrl }, use, testInfo) => {
    if (process.env.E2E_TEST_API_ENABLED === '1') {
      const config = remoteConfig(apiUrl);
      const fixture = await allocateRemoteFixture(request, config, testInfo);
      try {
        await use(validateSeedState(fixture.seedState));
      } finally {
        await cleanupRemoteFixture(request, config, fixture.scope);
      }
      return;
    }
    let state;
    try { state = JSON.parse(process.env.E2E_SEED_STATE || ''); }
    catch { throw new Error('E2E blocked: global seed state is missing or malformed'); }
    await use(validateSeedState(state));
  },
  apiUrl: async ({}, use) => use((process.env.E2E_API_URL || 'http://127.0.0.1:3001/api').replace(/\/$/, '')),
  _fakeMedia: [async ({ context }, use) => { await installFakeMedia(context); await use(); }, { auto: true }],
  participants: async ({ browser, apiUrl, seedState }, use) => {
    const create = async (actorName, mode) => {
      const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
      await installFakeMedia(context);
      const page = await context.newPage();
      await authenticatePage(page, context.request, apiUrl, seedState.actors[actorName], mode);
      return { context, page };
    };
    const client = await create('client', 'client');
    const lawyer = await create('lawyer', 'lawyer');
    try { await use({ client, lawyer }); }
    finally { await Promise.all([client.context.close(), lawyer.context.close()]); }
  },
});

module.exports = { expect: base.expect, test };
