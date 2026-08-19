const { authHeaders, loginActor } = require('./auth');

async function requireCleanupResponse(response, operation) {
  if (!response.ok()) throw new Error(`${operation} failed with HTTP ${response.status()}`);
  return response;
}

async function cleanupPrivateResources({ request, apiUrl, state, login = loginActor }) {
  for (const actor of Object.values(state.actors || {})) {
    if (actor.accountType === 'admin' || actor.role === 'admin') continue;
    let session;
    try {
      session = await login(request, apiUrl, actor);
    } catch (error) {
      if (error.status === 401 || /HTTP (?:401|404)/.test(error.message)) continue;
      throw error;
    }
    const mode = actor.preferredMode || 'client';
    const headers = authHeaders(session, mode);
    if (mode === 'lawyer') {
      const current = await request.get(`${apiUrl}/lawyer/imports/current`, { headers });
      if (current.ok()) {
        const importId = (await current.json()).import?.id;
        if (importId) {
          await requireCleanupResponse(
            await request.delete(`${apiUrl}/lawyer/imports/${importId}`, { headers }),
            `Import ${importId} cleanup`
          );
        }
      } else if (![403, 404].includes(current.status())) {
        await requireCleanupResponse(current, 'Import discovery');
      }
    }
    const documents = await request.get(`${apiUrl}/documents`, { headers });
    if (!documents.ok()) {
      if ([403, 404].includes(documents.status())) continue;
      await requireCleanupResponse(documents, 'Document discovery');
    }
    for (const document of await documents.json()) {
      await requireCleanupResponse(
        await request.delete(`${apiUrl}/documents/${document.id}`, { headers }),
        `Document ${document.id} cleanup`
      );
    }
  }
}

module.exports = { cleanupPrivateResources };
