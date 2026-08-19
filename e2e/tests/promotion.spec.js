const { expect, test } = require('../fixtures/test');
const { authHeaders, authenticatePage, loginActor } = require('../helpers/auth');

test('creates one sandbox checkout on retry with the same idempotency key', async ({ request, apiUrl, seedState }, testInfo) => {
  const session = await loginActor(request, apiUrl, seedState.actors.otherLawyer);
  const headers = { ...authHeaders(session, 'lawyer'), 'Idempotency-Key': `${seedState.runId}:${testInfo.project.name}:top` };
  const data = { packageId: seedState.resources.packageId, specialization: 'Гражданское право', location: 'Самарканд' };
  const first = await request.post(`${apiUrl}/lawyer/promotions/checkout`, { headers, data });
  const second = await request.post(`${apiUrl}/lawyer/promotions/checkout`, { headers, data });
  expect([200, 201]).toContain(first.status());
  expect(second.status()).toBe(200);
  expect((await second.json()).paymentId).toBe((await first.json()).paymentId);
});

test('shows sponsored catalog placement with a visible advertising label', async ({ page }) => {
  await page.goto('/lawyers?specialization=Гражданское%20право&location=Ташкент');
  await expect(page.getByText(/продвигается|реклама|sponsored/i).first()).toBeVisible();
});

test('shows campaign analytics for the owning lawyer', async ({ page, request, apiUrl, seedState }) => {
  await authenticatePage(page, request, apiUrl, seedState.actors.lawyer, 'lawyer');
  await page.goto('/lawyer/promotions');
  await expect(page.getByRole('heading', { name: /история|history/i })).toBeVisible();
  await expect(page.getByText(/показы|impressions/i).first()).toBeVisible();
});

test('requests a provider-confirmed refund without fabricating local success', async ({ request, apiUrl, seedState }) => {
  const session = await loginActor(request, apiUrl, seedState.actors.admin);
  const response = await request.post(`${apiUrl}/admin/promotions/${seedState.resources.refundPromotionId}/refund`, {
    headers: authHeaders(session, 'admin'), data: { reason: 'E2E provider-confirmed refund check' },
  });
  expect(response.status()).toBe(202);
  const body = await response.json();
  expect(body.promotion.status).toBe('refund_pending');
  expect(body.payment.status).toBe('refund_pending');
  expect(body.outcome).toBe('refund_requested');
});
