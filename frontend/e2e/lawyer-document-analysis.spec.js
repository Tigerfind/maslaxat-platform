const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('назначенный юрист разбирает документ дела и видит структурированную выжимку', async ({ page }) => {
  await page.route('**/api/consultations/*/documents', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        canAnalyze: true,
        writable: true,
        documents: [{ id: 'doc-ai-e2e', name: 'contract.pdf', mimeType: 'application/pdf', size: 2048, uploaderId: 'client-e2e', uploader: { name: 'E2E Client', role: 'client' }, analysisSupported: true }],
      }),
    });
  });
  await page.route('**/api/consultations/*/documents/doc-ai-e2e/ai-analysis', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ analysis: { id: 'analysis-e2e', status: 'completed', model: 'claude-sonnet', promptVersion: 'v1', completedAt: new Date().toISOString(), result: {
      documentType: 'Договор', parties: [{ name: 'ООО Заказчик', role: 'Заказчик' }], keyDates: [{ date: '20.09.2026', description: 'Срок оплаты' }], amounts: [{ amount: '1 000 000', currency: 'UZS', purpose: 'Оплата услуг' }], subject: 'Оказание услуг', obligations: ['Оплатить услуги в срок'], risks: ['Не определён порядок приёмки'], summary: 'Договор регулирует оказание услуг. Юристу следует проверить порядок приёмки результата.'
    } } }),
  }));

  await login(page, 'lawyer');
  await page.goto('/lawyer/consultations');
  await page.getByRole('button', { name: /Документы по делу/ }).first().click();
  await page.getByRole('button', { name: 'Разобрать документ contract.pdf' }).click();
  await expect(page.getByRole('heading', { name: 'Тип документа' })).toBeVisible();
  await expect(page.getByText('ООО Заказчик')).toBeVisible();
  await expect(page.getByText('Не определён порядок приёмки')).toBeVisible();
  await expect(page.getByText(/Договор регулирует оказание услуг/)).toBeVisible();
});
