const { test, expect } = require('@playwright/test');
const { login, VIDEO_CONSULTATION_ID, REFUND_CONSULTATION_ID } = require('./helpers');

test('клиент видит server counts, payment tab и открывает детали консультации', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/consultations');

  await expect(page.getByRole('tab', { name: /Ожидают оплаты \([1-9]\d*\)/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Предстоящие \([1-9]\d*\)/ })).toBeVisible();

  await page.getByRole('tab', { name: /Ожидают оплаты/ }).click();
  await expect(page).toHaveURL(/tab=payment_pending/);
  const paymentCard = page.getByTestId(`consultation-${REFUND_CONSULTATION_ID}`);
  await expect(paymentCard.getByText('Ожидает оплаты', { exact: true }).first()).toBeVisible();
  await expect(paymentCard.getByRole('button', { name: 'Оплатить' })).toBeVisible();

  await page.getByRole('tab', { name: /Предстоящие \([1-9]\d*\)/ }).click();
  await page.getByTestId(`consultation-${VIDEO_CONSULTATION_ID}`).getByRole('button', { name: 'Подробнее' }).click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${VIDEO_CONSULTATION_ID}$`));
  await expect(page.getByRole('heading', { name: 'Статус оплаты' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш вопрос' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История статусов' })).toBeVisible();
});

test('mobile consultation tabs and actions do not overflow the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'client');
  await page.goto('/consultations?tab=upcoming');
  await expect(page.getByRole('tab', { name: /Предстоящие/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`consultation-${VIDEO_CONSULTATION_ID}`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

for (const width of [320, 375, 768, 1024, 1440]) {
  test(`consultation list and detail remain accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
    await login(page, 'client');
    await page.goto('/consultations?tab=upcoming');

    const activeTab = page.getByRole('tab', { name: /Предстоящие/ });
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await activeTab.press('End');
    await expect(page.getByRole('tab', { name: /Архив/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /Предстоящие/ }).click();

    const card = page.getByTestId(`consultation-${VIDEO_CONSULTATION_ID}`);
    await expect(card).toBeVisible();
    const actions = card.locator('.consultation-action');
    for (let index = 0; index < await actions.count(); index += 1) {
      const box = await actions.nth(index).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await card.getByRole('button', { name: 'Подробнее' }).click();
    await expect(page).toHaveURL(new RegExp(`/consultations/${VIDEO_CONSULTATION_ID}$`));
    await expect(page.getByRole('heading', { name: 'Статус оплаты' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    if (width < 900) {
      const nav = page.getByRole('button', { name: 'Консультации' });
      await expect(nav).toHaveAttribute('aria-current', 'page');
      expect((await nav.boundingBox()).height).toBeGreaterThanOrEqual(44);
      const paddingBottom = await page.locator('.screen').evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));
      expect(paddingBottom).toBeGreaterThanOrEqual(88);
    }
  });
}
