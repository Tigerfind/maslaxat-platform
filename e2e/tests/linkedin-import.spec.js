const path = require('node:path');
const { expect, test } = require('../fixtures/test');
const { authHeaders, authenticatePage, loginActor } = require('../helpers/auth');

test('uploads a LinkedIn PDF and reaches deterministic draft review', async ({ page, request, apiUrl, seedState }) => {
  const session = await authenticatePage(page, request, apiUrl, seedState.actors.importer, 'lawyer');
  try {
    await page.goto('/lawyer/imports');
    const input = page.locator('input[type=file]');
    await input.setInputFiles(path.resolve(__dirname, '../../backend/api/tests/fixtures/linkedin-en.pdf'));
    await expect(page.getByRole('heading', { name: /провер|review/i })).toBeVisible({ timeout: 30000 });
  } finally {
    const current = await request.get(`${apiUrl}/lawyer/imports/current`, { headers: authHeaders(session, 'lawyer') });
    if (current.ok()) {
      const importId = (await current.json()).import?.id;
      if (importId) await request.delete(`${apiUrl}/lawyer/imports/${importId}`, { headers: authHeaders(session, 'lawyer') });
    }
  }
});

test('rejects a stale draft without overwriting the current import', async ({ request, apiUrl, seedState }) => {
  const session = await loginActor(request, apiUrl, seedState.actors.applicant);
  const response = await request.patch(`${apiUrl}/lawyer/imports/${seedState.resources.importId}/draft`, {
    headers: authHeaders(session, 'lawyer'),
    data: { version: 0, draft: { headline: 'stale write' } },
  });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ code: 'STALE_IMPORT_VERSION' });
});

test('confirms selected LinkedIn fields and records self-reported provenance', async ({ request, apiUrl, seedState }) => {
  const session = await loginActor(request, apiUrl, seedState.actors.applicant);
  const response = await request.post(`${apiUrl}/lawyer/imports/${seedState.resources.importId}/confirm`, {
    headers: authHeaders(session, 'lawyer'),
    data: { version: 1, acceptedPaths: ['headline', 'education'], profileRevision: 1 },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.profile.profileSources.headline.verificationLevel).toBe('self_reported');
  expect(body.import.confirmedFromVersion).toBe(1);
});

test('shows provenance on the public lawyer profile', async ({ page, seedState }) => {
  await page.goto(`/lawyers/${seedState.actors.lawyer.id}`);
  await expect(page.getByText(/предоставлено юристом|self.reported/i)).toBeVisible();
});

test('lets an admin inspect the source through an audited endpoint', async ({ request, apiUrl, seedState }) => {
  const session = await loginActor(request, apiUrl, seedState.actors.admin);
  const response = await request.get(`${apiUrl}/lawyer/imports/${seedState.resources.importId}`, {
    headers: authHeaders(session, 'admin'),
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.import).toMatchObject({ id: seedState.resources.importId, source: 'linkedin_pdf' });
  expect(body.import.parsedData).toBeUndefined();
});

test('lets an admin verify an imported profile field with an approved supporting document', async ({ request, apiUrl, seedState }) => {
  const applicant = await loginActor(request, apiUrl, seedState.actors.applicant);
  await request.post(`${apiUrl}/lawyer/imports/${seedState.resources.importId}/confirm`, {
    headers: authHeaders(applicant, 'lawyer'),
    data: { version: 1, acceptedPaths: ['headline', 'education'], profileRevision: 1 },
  });
  const admin = await loginActor(request, apiUrl, seedState.actors.admin);
  const response = await request.patch(`${apiUrl}/admin/lawyers/${seedState.actors.applicant.id}/profile-fields/education/verify`, {
    headers: authHeaders(admin, 'admin'), data: { documentId: seedState.resources.applicantDocumentId },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).provenance).toMatchObject({
    verificationLevel: 'document_checked',
    documentId: seedState.resources.applicantDocumentId,
  });
});
