const { expect, test } = require('../fixtures/test');
const { authHeaders, authenticatePage, loginActor } = require('../helpers/auth');

test('sends chat between participants and renders the delivered message', async ({ participants, seedState }) => {
  const target = `/consultations/chat/${seedState.resources.consultationId}`;
  await Promise.all([participants.client.page.goto(target), participants.lawyer.page.goto(target)]);
  await Promise.all([
    expect(participants.client.page.getByText('E2E seeded message')).toBeVisible(),
    expect(participants.lawyer.page.getByText('E2E seeded message')).toBeVisible(),
  ]);
  const clientMessage = `Client to lawyer ${seedState.runId}`;
  const lawyerMessage = `Lawyer to client ${seedState.runId}`;
  const clientField = participants.client.page.getByPlaceholder(/сообщение|message/i);
  const lawyerField = participants.lawyer.page.getByPlaceholder(/сообщение|message/i);
  await clientField.fill(clientMessage);
  await clientField.press('Enter');
  await expect(participants.lawyer.page.getByText(clientMessage)).toBeVisible();
  await lawyerField.fill(lawyerMessage);
  await lawyerField.press('Enter');
  await expect(participants.client.page.getByText(lawyerMessage)).toBeVisible();
});

test('keeps private documents owner-only while allowing owner upload', async ({ request, apiUrl, seedState }, testInfo) => {
  const owner = await loginActor(request, apiUrl, seedState.actors.otherClient);
  const outsider = await loginActor(request, apiUrl, seedState.actors.client);
  const upload = await request.post(`${apiUrl}/documents/upload`, {
    headers: authHeaders(owner, 'client'),
    multipart: {
      file: { name: `${seedState.runId}-${testInfo.project.name}.txt`, mimeType: 'text/plain', buffer: Buffer.from('synthetic E2E legal document') },
      metadata: JSON.stringify({ category: 'Другое' }),
    },
  });
  expect(upload.status()).toBe(201);
  const documentId = (await upload.json()).id;
  try {
    const ownerResponse = await request.get(`${apiUrl}/documents/${documentId}/download`, { headers: authHeaders(owner, 'client') });
    const outsiderResponse = await request.get(`${apiUrl}/documents/${documentId}/download`, { headers: authHeaders(outsider, 'client') });
    expect(ownerResponse.status()).toBe(200);
    expect([403, 404]).toContain(outsiderResponse.status());
  } finally {
    await request.delete(`${apiUrl}/documents/${documentId}`, { headers: authHeaders(owner, 'client') });
  }
});

test('connects two call contexts with fake media', async ({ participants, seedState }) => {
  const target = `/consultations/video/${seedState.resources.consultationId}`;
  await Promise.all([participants.client.page.goto(target), participants.lawyer.page.goto(target)]);
  const clientJoin = participants.client.page.getByRole('button', { name: /войти.*звон|join.*call/i });
  const lawyerJoin = participants.lawyer.page.getByRole('button', { name: /войти.*звон|join.*call/i });
  await expect(clientJoin).toBeVisible();
  await expect(lawyerJoin).toBeVisible();
  await Promise.all([clientJoin.click(), lawyerJoin.click()]);
  const liveRemoteTracks = (page) => page.locator('video:not([muted])').evaluateAll((videos) => videos.some((video) => {
    const tracks = video.srcObject?.getTracks?.() || [];
    return tracks.some((track) => track.kind === 'audio' && track.readyState === 'live')
      && tracks.some((track) => track.kind === 'video' && track.readyState === 'live');
  }));
  await expect.poll(() => liveRemoteTracks(participants.client.page), { timeout: 15000 }).toBe(true);
  await expect.poll(() => liveRemoteTracks(participants.lawyer.page), { timeout: 15000 }).toBe(true);
  await expect(participants.client.page.getByText(/осталось|time left/i)).toBeVisible();
  await expect(participants.lawyer.page.getByText(/осталось|time left/i)).toBeVisible();
});
