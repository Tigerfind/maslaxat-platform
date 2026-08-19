const assert = require('node:assert/strict');
const test = require('node:test');

test('private cleanup deletes imports and documents through authorized application APIs', async () => {
  const { cleanupPrivateResources } = require('../../helpers/private-cleanup');
  const calls = [];
  const response = (status, body) => ({ status: () => status, ok: () => status >= 200 && status < 300, json: async () => body });
  const request = {
    get: async (url) => {
      calls.push(['get', url]);
      if (url.endsWith('/lawyer/imports/current')) return response(200, { import: { id: 'import-1' } });
      return response(200, [{ id: 'document-1' }]);
    },
    delete: async (url) => { calls.push(['delete', url]); return response(204, {}); },
  };
  await cleanupPrivateResources({
    request, apiUrl: 'https://api-staging.example.test/api',
    state: { actors: { importer: { preferredMode: 'lawyer' } } },
    login: async () => ({ token: 'token' }),
  });
  assert.deepEqual(calls, [
    ['get', 'https://api-staging.example.test/api/lawyer/imports/current'],
    ['delete', 'https://api-staging.example.test/api/lawyer/imports/import-1'],
    ['get', 'https://api-staging.example.test/api/documents'],
    ['delete', 'https://api-staging.example.test/api/documents/document-1'],
  ]);
});

test('private cleanup ignores absent synthetic users but fails on storage deletion errors', async () => {
  const { cleanupPrivateResources } = require('../../helpers/private-cleanup');
  const state = { actors: { importer: { preferredMode: 'lawyer' } } };
  await cleanupPrivateResources({
    request: {}, apiUrl: 'https://api-staging.example.test/api', state,
    login: async () => { const error = new Error('missing'); error.status = 401; throw error; },
  });
  await assert.rejects(cleanupPrivateResources({
    request: {
      get: async (url) => url.endsWith('/current')
        ? { ok: () => true, status: () => 200, json: async () => ({ import: { id: 'import-1' } }) }
        : { ok: () => true, status: () => 200, json: async () => [] },
      delete: async () => ({ ok: () => false, status: () => 503, json: async () => ({}) }),
    },
    apiUrl: 'https://api-staging.example.test/api', state,
    login: async () => ({ token: 'token' }),
  }), /HTTP 503/);
});
