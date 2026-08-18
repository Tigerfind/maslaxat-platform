const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('каталог обновляет online по подключению и отключению socket юриста', async ({ page, browser }) => {
  const lawyerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3100', serviceWorkers: 'block' });
  const lawyerPage = await lawyerContext.newPage();
  let lawyerClosed = false;

  try {
    await login(page, 'client');
    await page.goto('/lawyers');
    await expect(page.getByText('E2E Lawyer').first()).toBeVisible();
    await expect(page.getByText('Онлайн', { exact: true })).toHaveCount(0);

    await login(lawyerPage, 'lawyer');
    await expect(page.getByText('Онлайн', { exact: true })).toBeVisible();

    const onlineFilter = page.getByRole('button', { name: /Онлайн сейчас/ });
    await expect(onlineFilter).toBeEnabled();
    await onlineFilter.click();
    await expect(page.getByText('E2E Lawyer').first()).toBeVisible();

    await lawyerContext.close();
    lawyerClosed = true;
    await expect(page.getByText('Онлайн', { exact: true })).toHaveCount(0);
    await expect(page.getByText('E2E Lawyer')).toHaveCount(0);
  } finally {
    if (!lawyerClosed) await lawyerContext.close();
  }
});
