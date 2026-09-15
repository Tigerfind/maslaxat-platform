const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('регистрация требует legal consent и создаёт клиента', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Полное имя').fill('Playwright Client');
  await page.getByLabel('Email').fill(`playwright.${Date.now()}@example.uz`);
  await page.getByLabel('Пароль', { exact: true }).fill('Playwright123!');
  await page.getByLabel('Подтвердите пароль').fill('Playwright123!');

  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('alert')).toContainText('Примите условия');

  await page.getByRole('checkbox', { name: 'Примите условия и политику конфиденциальности' }).check();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: 'Подтвердите email' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Письмо не отправлено');
  await page.getByRole('button', { name: 'Отправить новый код' }).click();
  await expect(page.getByRole('alert')).toContainText('Отправка email временно недоступна');
});

test('полная регистрация юриста требует специализацию и показывает подтверждение email', async ({ page }) => {
  await page.goto('/register?role=lawyer');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Полное имя').fill('Playwright Lawyer');
  await page.getByLabel('Email').fill(`playwright.lawyer.${Date.now()}@example.uz`);
  await page.getByLabel('Пароль', { exact: true }).fill('Playwright123!');
  await page.getByLabel('Подтвердите пароль').fill('Playwright123!');
  await page.getByRole('checkbox', { name: 'Примите условия и политику конфиденциальности' }).check();
  await page.getByRole('button', { name: 'Далее' }).click();

  await page.getByRole('button', { name: 'Зарегистрироваться как юрист' }).click();
  await expect(page.getByRole('alert')).toContainText('Укажите специализацию');
  await page.getByRole('button', { name: 'Гражданское право' }).click();
  await page.getByRole('button', { name: 'Зарегистрироваться как юрист' }).click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: 'Подтвердите email' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Письмо не отправлено');
});

test('регистрация нормализует пробелы и показывает понятную ошибку занятого email', async ({ page, playwright }) => {
  const email = `duplicate.${Date.now()}@example.uz`;
  const api = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3101' });
  const created = await api.post('/api/auth/register', { data: {
    name: 'Existing Client', email, password: 'Playwright123!', role: 'client',
    acceptedTerms: true, legalVersion: '2026-08-13',
  } });
  expect(created.status()).toBe(201);
  await api.dispose();

  await page.goto('/register');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.getByLabel('Полное имя').fill('  New Client  ');
  await page.getByLabel('Email').fill(`  ${email.toUpperCase()}  `);
  await page.getByLabel('Пароль', { exact: true }).fill('Playwright123!');
  await page.getByLabel('Подтвердите пароль').fill('Playwright123!');
  await page.getByRole('checkbox', { name: 'Примите условия и политику конфиденциальности' }).check();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

  await expect(page.getByRole('alert')).toContainText('Этот email уже зарегистрирован');
  await expect(page).toHaveURL(/\/register/);
});

test('регистрация доступна с клавиатуры и не переполняет мобильный экран', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/register?role=lawyer');
  await expect(page.getByRole('radio', { name: /Юрист/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Клиент/ })).toBeVisible();
  await page.getByRole('radio', { name: /Клиент/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: /Клиент/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Далее' }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

for (const role of ['client', 'lawyer', 'admin']) {
  test(`вход роли ${role} ведёт в правильный кабинет`, async ({ page }) => {
    await login(page, role);
  });
}
