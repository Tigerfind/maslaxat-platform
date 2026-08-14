const { expect } = require('@playwright/test');

const ACCOUNTS = {
  client: { email: 'client.e2e@maslaxat.uz', password: 'E2eClient123!', path: '/dashboard' },
  lawyer: { email: 'lawyer.e2e@maslaxat.uz', password: 'E2eLawyer123!', path: '/lawyer/dashboard' },
  admin: { email: 'admin.e2e@maslaxat.uz', password: 'E2eAdmin123!', path: '/admin/dashboard' },
};

async function login(page, role = 'client') {
  const account = ACCOUNTS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel(/Пароль/i).fill(account.password);
  await page.locator('form').getByRole('button', { name: /^Войти$/i }).click();
  await expect(page).toHaveURL(new RegExp(`${account.path.replace('/', '\\/')}$`));
}

module.exports = { ACCOUNTS, login };
