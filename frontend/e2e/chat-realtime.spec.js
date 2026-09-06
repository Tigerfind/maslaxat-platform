const { test, expect } = require('@playwright/test');
const { login, CHAT_CONSULTATION_ID } = require('./helpers');

test('client и lawyer получают сообщения realtime и история сохраняется', async ({ browser, request }) => {
  const options = { baseURL: 'http://127.0.0.1:3100', serviceWorkers: 'block' };
  const clientContext = await browser.newContext(options);
  const lawyerContext = await browser.newContext(options);
  const clientPage = await clientContext.newPage();
  const lawyerPage = await lawyerContext.newPage();

  try {
    await login(clientPage, 'client');
    await login(lawyerPage, 'lawyer');
    await Promise.all([
      clientPage.goto(`/consultations/chat/${CHAT_CONSULTATION_ID}`),
      lawyerPage.goto(`/consultations/chat/${CHAT_CONSULTATION_ID}`),
    ]);

    await expect(clientPage.getByText('E2E Lawyer').first()).toBeVisible();
    await expect(lawyerPage.getByText('E2E Client').first()).toBeVisible();

    const clientInput = clientPage.getByPlaceholder('Сообщение…');
    const lawyerInput = lawyerPage.getByPlaceholder('Сообщение…');
    await expect(async () => {
      await clientInput.fill(`typing-${Math.random().toString(36).slice(2, 7)}`);
      await expect(lawyerPage.getByText('печатает…', { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await clientInput.fill('');

    const suffix = Math.random().toString(36).slice(2, 9);
    const clientMessage = `client-message-${suffix}`;
    await clientInput.fill(clientMessage);
    await clientInput.press('Enter');
    await expect(clientPage.getByText(clientMessage, { exact: true })).toBeVisible();
    await expect(lawyerPage.getByText(clientMessage, { exact: true })).toBeVisible();

    const lawyerMessage = `lawyer-message-${suffix}`;
    await lawyerInput.fill(lawyerMessage);
    await lawyerInput.press('Enter');
    await expect(clientPage.getByText(lawyerMessage, { exact: true })).toBeVisible();
    await expect(lawyerPage.getByText(lawyerMessage, { exact: true })).toBeVisible();

    const token = await clientPage.evaluate(() => localStorage.getItem('token'));
    const history = await request.get(`http://127.0.0.1:3101/api/chat/${CHAT_CONSULTATION_ID}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(history.status()).toBe(200);
    const texts = (await history.json()).map((message) => message.text);
    expect(texts).toEqual(expect.arrayContaining([clientMessage, lawyerMessage]));
  } finally {
    await clientContext.close();
    await lawyerContext.close();
  }
});
