const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('Zoom lobby показывает оборудование, роль, время и официальный fallback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await login(page, 'client');
  await page.goto('/consultations/zoom/44444444-4444-4444-8444-444444444444');
  await expect(page.getByRole('heading', { name: 'Проверка оборудования' })).toBeVisible();
  await expect(page.getByText('Вы участник')).toBeVisible();
  await expect(page.getByText('30 минут')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть в Zoom' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('Zoom lobby объясняет запрет камеры и предлагает повторить проверку', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); },
      enumerateDevices: async () => [],
    } });
  });
  await login(page, 'client');
  await page.goto('/consultations/zoom/44444444-4444-4444-8444-444444444444');
  await page.getByRole('button', { name: 'Повторить проверку' }).click();
  await expect(page.getByRole('alert')).toContainText('Доступ к камере или микрофону запрещён');
  await expect(page.getByRole('button', { name: 'Разрешить доступ' })).toBeVisible();
});
