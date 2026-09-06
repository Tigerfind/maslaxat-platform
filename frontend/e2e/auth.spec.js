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
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const role of ['client', 'lawyer', 'admin']) {
  test(`вход роли ${role} ведёт в правильный кабинет`, async ({ page }) => {
    await login(page, role);
  });
}
