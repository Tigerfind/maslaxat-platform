const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('клиент видит каталог и может открыть бронирование', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/lawyers');
  await expect(page.getByText('E2E Lawyer')).toBeVisible();
  await page.getByRole('button', { name: 'Записаться', exact: true }).click();
  await expect(page.getByText('Запись на консультацию')).toBeVisible();
});

test('API бронирования требует consent и сохраняет корректную бронь', async ({ page, request }) => {
  await login(page, 'client');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const lawyers = await request.get('http://127.0.0.1:3101/api/lawyers?limit=1');
  const lawyer = (await lawyers.json()).lawyers[0];
  const headers = { Authorization: `Bearer ${token}` };

  const denied = await request.post(`http://127.0.0.1:3101/api/client/lawyers/${lawyer.id}/book`, {
    headers, data: { question: 'Проверка согласия' },
  });
  expect(denied.status()).toBe(400);

  const accepted = await request.post(`http://127.0.0.1:3101/api/client/lawyers/${lawyer.id}/book`, {
    headers,
    data: {
      question: 'Проверка Playwright', consultationType: 'video',
      acceptedTerms: true, legalVersion: '2026-08-13',
    },
  });
  expect(accepted.status()).toBe(201);
  expect((await accepted.json()).consultation.legalVersion).toBe('2026-08-13');
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('нижняя навигация доступна и открывает каталог', async ({ page }) => {
    await login(page, 'client');
    await expect(page.getByRole('button', { name: 'Юристы' })).toBeVisible();
    await page.getByRole('button', { name: 'Юристы' }).click();
    await expect(page).toHaveURL(/\/lawyers$/);
    await expect(page.getByText('E2E Lawyer')).toBeVisible();
  });
});
