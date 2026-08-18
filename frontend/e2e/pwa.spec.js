const { test, expect } = require('@playwright/test');

test('production build регистрирует активный service worker и manifest', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3100',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  try {
    await page.goto('/');
    let workerUrl = '';
    await expect.poll(async () => {
      try {
        workerUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '');
        return workerUrl;
      } catch {
        return '';
      }
    }, { timeout: 15000 }).toMatch(/\/sw\.js$/);
    expect(workerUrl).toMatch(/\/sw\.js$/);
    const manifest = await context.request.get('/manifest.json');
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).name).toBeTruthy();
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(async () => {
      await Promise.allSettled([fetch('/api/private-cache-probe'), fetch('/uploads/private-cache-probe')]);
    });
    const privateCacheEntries = await page.evaluate(async () => {
      const api = await caches.match('/api/private-cache-probe');
      const upload = await caches.match('/uploads/private-cache-probe');
      return { api: Boolean(api), upload: Boolean(upload) };
    });
    expect(privateCacheEntries).toEqual({ api: false, upload: false });
  } finally {
    await context.close();
  }
});
