const { io } = require('socket.io-client');
const { expect, test } = require('../fixtures/test');
const { authHeaders, loginActor } = require('../helpers/auth');

test('rejects API IDOR for imports documents consultations chat and promotions', async ({ request, apiUrl, seedState }) => {
  const client = await loginActor(request, apiUrl, seedState.actors.client);
  const importer = await loginActor(request, apiUrl, seedState.actors.importer);
  const otherLawyer = await loginActor(request, apiUrl, seedState.actors.otherLawyer);
  const attempts = [
    request.get(`${apiUrl}/lawyer/imports/${seedState.resources.importId}`, { headers: authHeaders(importer, 'lawyer') }),
    request.get(`${apiUrl}/documents/${seedState.resources.documentId}/download`, { headers: authHeaders(client, 'client') }),
    request.get(`${apiUrl}/consultations/${seedState.resources.otherConsultationId}`, { headers: authHeaders(client, 'client') }),
    request.get(`${apiUrl}/chat/${seedState.resources.otherConsultationId}/messages`, { headers: authHeaders(client, 'client') }),
    request.get(`${apiUrl}/lawyer/promotions/${seedState.resources.promotionId}`, { headers: authHeaders(otherLawyer, 'lawyer') }),
  ];
  const responses = await Promise.all(attempts);
  for (const response of responses) {
    expect([403, 404]).toContain(response.status());
    expect(JSON.stringify(await response.json().catch(() => ({})))).not.toContain(seedState.actors.otherClient.email);
  }
});

test('rejects socket IDOR without joining or leaking room metadata', async ({ request, apiUrl, seedState }) => {
  const session = await loginActor(request, apiUrl, seedState.actors.client);
  const owner = await loginActor(request, apiUrl, seedState.actors.otherClient);
  const callee = await loginActor(request, apiUrl, seedState.actors.otherLawyer);
  const ownerHeaders = authHeaders(owner, 'client');
  const calleeHeaders = authHeaders(callee, 'lawyer');
  const beforeMessages = await request.get(`${apiUrl}/chat/${seedState.resources.otherConsultationId}/messages`, { headers: ownerHeaders });
  const beforeNotifications = await request.get(`${apiUrl}/notifications`, { headers: calleeHeaders });
  expect(beforeMessages.status()).toBe(200);
  expect(beforeNotifications.status()).toBe(200);
  const socketUrl = apiUrl.replace(/\/api$/, '');
  const result = await new Promise((resolve, reject) => {
    const socket = io(socketUrl, { transports: ['websocket'], forceNew: true, auth: { token: session.token, mode: 'client' } });
    const timer = setTimeout(() => { socket.disconnect(); reject(new Error('Socket IDOR assertion timed out')); }, 5000);
    const denied = [];
    socket.on('connect', () => {
      socket.emit('send-message', { consultationId: seedState.resources.otherConsultationId, text: 'forbidden' });
      socket.emit('call-user', { consultationId: seedState.resources.otherConsultationId });
      socket.emit('join-chat', { consultationId: seedState.resources.otherConsultationId });
    });
    socket.on('error', (payload) => {
      denied.push(payload);
      if (denied.length === 1) socket.emit('join-room', { consultationId: seedState.resources.otherConsultationId });
      else {
        clearTimeout(timer); socket.disconnect(); resolve(denied);
      }
    });
    socket.on('connect_error', (error) => { clearTimeout(timer); socket.disconnect(); reject(error); });
  });
  expect(result).toEqual([{ message: 'Access denied' }, { message: 'Access denied' }]);
  expect(JSON.stringify(result)).not.toContain(seedState.resources.otherConsultationId);
  const afterMessages = await request.get(`${apiUrl}/chat/${seedState.resources.otherConsultationId}/messages`, { headers: ownerHeaders });
  const afterNotifications = await request.get(`${apiUrl}/notifications`, { headers: calleeHeaders });
  expect(await afterMessages.json()).toEqual(await beforeMessages.json());
  const beforeIds = (await beforeNotifications.json()).notifications.map(({ id }) => id);
  const newNotifications = (await afterNotifications.json()).notifications.filter(({ id }) => !beforeIds.includes(id));
  expect(newNotifications).toEqual([]);
});
