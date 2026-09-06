const { test, expect } = require('@playwright/test');

const documents = [
  ['/terms', 'Публичная оферта и условия использования'],
  ['/privacy', 'Политика конфиденциальности'],
  ['/refund-policy', 'Правила отмены и возврата'],
];

for (const [path, title] of documents) {
  test(`${path} открывается напрямую`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(/Контакт: support@maslaxat\.uz/)).toBeVisible();
  });
}

test('footer содержит все юридические ссылки', async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(page.locator('footer').getByRole('link', { name: 'Условия' })).toHaveAttribute('href', '/terms');
  await expect(page.locator('footer').getByRole('link', { name: 'Конфиденциальность' })).toHaveAttribute('href', '/privacy');
  await expect(page.locator('footer').getByRole('link', { name: 'Возвраты' })).toHaveAttribute('href', '/refund-policy');
});
