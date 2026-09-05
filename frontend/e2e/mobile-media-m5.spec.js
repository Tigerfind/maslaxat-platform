const { test, expect } = require('@playwright/test');
const { login, CHAT_CONSULTATION_ID, VIDEO_CONSULTATION_ID } = require('./helpers');

for (const width of [320, 375]) {
  test(`chat composer stays reachable after focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await login(page, 'client');
    await page.goto(`/consultations/chat/${CHAT_CONSULTATION_ID}`);
    const composer = page.getByPlaceholder('Сообщение…');
    await composer.focus();
    await expect(composer).toBeVisible();
    const bounds = await composer.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(701);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test('WebRTC camera failure requires explicit audio-only fallback', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    let requests = 0;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async (constraints) => {
        requests += 1;
        window.__mediaRequests = requests;
        if (constraints.video) throw new DOMException('camera missing', 'NotFoundError');
        return originalGetUserMedia({ audio: true, video: false });
      },
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Microphone' }],
      addEventListener: () => {}, removeEventListener: () => {},
    } });
  });
  await login(page, 'client');
  await page.goto(`/consultations/video/${VIDEO_CONSULTATION_ID}`);
  await expect(page.getByRole('alert')).toContainText('Камера не найдена');
  expect(await page.evaluate(() => window.__mediaRequests)).toBe(1);
  await page.getByRole('button', { name: 'Продолжить только с аудио' }).click();
  await expect(page.getByText('Аудиоконсультация')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти в звонок' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Включить или выключить камеру' })).toHaveCount(0);
});

test('Zoom audio-only fallback is explicit and explains SDK camera controls', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.addInitScript(() => {
    let requests = 0;
    const audioStream = () => {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      return context.createMediaStreamDestination().stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async (constraints) => {
        requests += 1;
        window.__zoomMediaRequests = requests;
        if (constraints.video) throw new DOMException('camera busy', 'NotReadableError');
        return audioStream();
      },
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Microphone' }],
      addEventListener: () => {}, removeEventListener: () => {},
    } });
  });
  await login(page, 'client');
  await page.goto('/consultations/zoom/44444444-4444-4444-8444-444444444444');
  await page.getByRole('button', { name: 'Повторить проверку' }).click();
  await expect(page.getByRole('alert')).toContainText('Камера занята');
  expect(await page.evaluate(() => window.__zoomMediaRequests)).toBe(1);
  await page.getByRole('button', { name: 'Продолжить только с аудио' }).click();
  await expect(page.getByTestId('zoom-audio-only-preview')).toBeVisible();
  await expect(page.getByText(/Meeting SDK не гарантирует/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть в Zoom' })).toBeVisible();
});

test('incoming call uses a trapped dialog and Escape does not decline', async ({ browser }) => {
  const options = { baseURL: 'http://127.0.0.1:3100', serviceWorkers: 'block' };
  const callerContext = await browser.newContext(options);
  const receiverContext = await browser.newContext(options);
  await callerContext.grantPermissions(['camera', 'microphone'], { origin: 'http://127.0.0.1:3100' });
  const caller = await callerContext.newPage();
  const receiver = await receiverContext.newPage();
  await receiver.setViewportSize({ width: 320, height: 700 });
  try {
    await login(caller, 'client');
    await login(receiver, 'lawyer');
    await caller.goto(`/consultations/video/${VIDEO_CONSULTATION_ID}`);
    await caller.getByRole('button', { name: 'Войти в звонок' }).click();
    const dialog = receiver.getByRole('dialog', { name: 'Входящий видеозвонок' });
    await expect(dialog).toBeVisible();
    await receiver.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Принять' })).toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Отклонить' })).toBeVisible();
  } finally {
    await callerContext.close();
    await receiverContext.close();
  }
});
