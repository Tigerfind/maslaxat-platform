const { test, expect } = require('@playwright/test');

const APP_ORIGIN = 'http://127.0.0.1:3100';

test('mocked Chromium install prompt can install and dismiss accessibly', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__installPromptCalls = 0;
    const event = new Event('beforeinstallprompt');
    event.prompt = () => { window.__installPromptCalls += 1; return Promise.resolve(); };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
  const prompt = page.getByTestId('install-prompt');
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: /Установить/i }).click();
  await expect(prompt).toBeHidden();
  expect(await page.evaluate(() => window.__installPromptCalls)).toBe(1);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: /Закрыть предложение/i }).click();
  await expect(prompt).toBeHidden();
});

for (const width of [320, 375]) {
  test(`connectivity banner fits ${width}px above mobile safe area`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: APP_ORIGIN, viewport: { width, height: 720 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto('/');
    await context.setOffline(true);
    const banner = page.getByTestId('connectivity-status');
    await expect(banner).toBeVisible();
    const box = await banner.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await context.close();
  });
}

test('200% text, reduced motion, and skip link remain usable', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: APP_ORIGIN,
    viewport: { width: 375, height: 760 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.locator('body')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).not.toBe('smooth');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: /основному содержанию/i });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await context.close();
});

test('service worker serves static offline fallback and never caches private paths', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
  await page.evaluate(async () => {
    await Promise.allSettled([fetch('/api/m6-private'), fetch('/uploads/m6-private')]);
  });
  expect(await page.evaluate(async () => ({
    api: Boolean(await caches.match('/api/m6-private')),
    upload: Boolean(await caches.match('/uploads/m6-private')),
    shell: Boolean(await caches.match('/index.html')),
    fallback: Boolean(await caches.match('/offline.html')),
  }))).toEqual({ api: false, upload: false, shell: true, fallback: true });
  await context.setOffline(true);
  await page.goto('/m6-offline-check');
  await expect(page.locator('h1')).toContainText('Нет подключения');
  await context.close();
});
