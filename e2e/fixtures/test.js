const base = require('@playwright/test');
const { authenticatePage } = require('../helpers/auth');
const { installFakeMedia } = require('../helpers/fake-media');
const { validateSeedState } = require('./contracts');

const test = base.test.extend({
  seedState: async ({}, use) => {
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
