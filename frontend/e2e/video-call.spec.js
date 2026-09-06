const { test, expect } = require('@playwright/test');
const { login, VIDEO_CONSULTATION_ID } = require('./helpers');

const APP_ORIGIN = 'http://127.0.0.1:3100';

async function createMediaContext(browser) {
  const context = await browser.newContext({ baseURL: APP_ORIGIN, serviceWorkers: 'block' });
  await context.grantPermissions(['camera', 'microphone'], { origin: APP_ORIGIN });
  return context;
}

async function hasVideoTrack(locator) {
  return locator.evaluate((video) => {
    const stream = video.srcObject;
    return Boolean(stream?.getVideoTracks().length);
  });
}

test('client и lawyer устанавливают WebRTC видеосоединение', async ({ browser, request }) => {
  test.setTimeout(60_000);
  const clientContext = await createMediaContext(browser);
  const lawyerContext = await createMediaContext(browser);
  const clientPage = await clientContext.newPage();
  const lawyerPage = await lawyerContext.newPage();

  try {
    await login(clientPage, 'client');
    await login(lawyerPage, 'lawyer');
    await Promise.all([
      clientPage.goto(`/consultations/video/${VIDEO_CONSULTATION_ID}`),
      lawyerPage.goto(`/consultations/video/${VIDEO_CONSULTATION_ID}`),
    ]);

    await expect(clientPage.getByText('Подготовка к звонку')).toBeVisible();
    await expect(lawyerPage.getByText('Подготовка к звонку')).toBeVisible();
    await expect.poll(() => hasVideoTrack(clientPage.getByTestId('lobby-video'))).toBe(true);
    await expect.poll(() => hasVideoTrack(lawyerPage.getByTestId('lobby-video'))).toBe(true);

    await clientPage.getByRole('button', { name: 'Войти в звонок' }).click();
    await lawyerPage.getByRole('button', { name: 'Войти в звонок' }).click();

    await expect.poll(() => hasVideoTrack(clientPage.getByTestId('remote-video'))).toBe(true);
    await expect.poll(() => hasVideoTrack(lawyerPage.getByTestId('remote-video'))).toBe(true);

    await clientPage.getByRole('button', { name: 'toggle-camera' }).click();
    await expect(lawyerPage.getByText('Камера выключена').first()).toBeVisible();
    await clientPage.getByRole('button', { name: 'toggle-camera' }).click();
    await expect(lawyerPage.getByText('Камера выключена')).toHaveCount(0);

    const token = await clientPage.evaluate(() => localStorage.getItem('token'));
    const consultation = await request.get(
      `http://127.0.0.1:3101/api/consultations/${VIDEO_CONSULTATION_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(consultation.status()).toBe(200);
    expect((await consultation.json()).consultation.status).toBe('in_progress');
  } finally {
    await clientContext.close();
    await lawyerContext.close();
  }
});
