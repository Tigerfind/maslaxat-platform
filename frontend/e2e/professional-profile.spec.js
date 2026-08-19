const { test, expect } = require('@playwright/test');

test('черновик профессионального профиля переживает reload', async ({ page, request }) => {
  const suffix = Date.now();
  const email = `onboarding.${suffix}@example.uz`;
  const password = 'Onboarding123!';
  const registration = await request.post('http://127.0.0.1:3101/api/auth/register', {
    data: {
      name: 'Onboarding Lawyer', email, password, role: 'lawyer',
      acceptedTerms: true, legalVersion: '2026-08-13',
    },
  });
  expect(registration.status()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Пароль/i).fill(password);
  await page.locator('form').getByRole('button', { name: /^Войти$/i }).click();
  await expect(page).toHaveURL(/\/lawyer\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Заполните профессиональный профиль' })).toBeVisible();

  await page.getByPlaceholder('Адвокат по семейному праву').fill('Адвокат по договорному праву');
  await page.getByPlaceholder('Расскажите о вашем опыте').fill('Практикующий адвокат с опытом сопровождения договорных споров и судебных процессов в Узбекистане.');
  await page.getByPlaceholder('Город').fill('Ташкент');
  await page.getByPlaceholder('+998...').fill('+998901234568');
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.getByText(/Сохранено/)).toBeVisible();

  await page.reload();
  await expect(page.getByPlaceholder('Адвокат по семейному праву')).toHaveValue('Адвокат по договорному праву');
  await expect(page.getByPlaceholder('Город')).toHaveValue('Ташкент');
});

test('без credentials LinkedIn и Zoom остаются честно выключенными', async ({ page }) => {
  await page.goto('/register?role=lawyer');
  await expect(page.getByRole('button', { name: /LinkedIn/i })).toHaveCount(0);
});
