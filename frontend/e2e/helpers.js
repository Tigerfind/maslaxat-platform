const { expect } = require('@playwright/test');

const ACCOUNTS = {
  client: { email: 'client.e2e@maslaxat.uz', password: 'E2eClient123!', path: '/dashboard' },
  lawyer: { email: 'lawyer.e2e@maslaxat.uz', password: 'E2eLawyer123!', path: '/lawyer/dashboard' },
  admin: { email: 'admin.e2e@maslaxat.uz', password: 'E2eAdmin123!', path: '/admin/dashboard' },
  refundLawyer: { email: 'refund-lawyer.e2e@maslaxat.uz', password: 'E2eRefund123!' },
};
const CHAT_CONSULTATION_ID = '11111111-1111-4111-8111-111111111111';
const VIDEO_CONSULTATION_ID = '22222222-2222-4222-8222-222222222222';
const REFUND_CONSULTATION_ID = '33333333-3333-4333-8333-333333333333';

async function login(page, role = 'client') {
  const account = ACCOUNTS[role];
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel(/Пароль/i).fill(account.password);
  await page.locator('form').getByRole('button', { name: /^Войти$/i }).click();
  await expect(page).toHaveURL(new RegExp(`${account.path.replace('/', '\\/')}$`));
}

module.exports = {
  ACCOUNTS, CHAT_CONSULTATION_ID, VIDEO_CONSULTATION_ID, REFUND_CONSULTATION_ID, login,
};
