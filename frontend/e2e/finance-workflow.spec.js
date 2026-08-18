const { test, expect } = require('@playwright/test');
const { ACCOUNTS, REFUND_CONSULTATION_ID, login } = require('./helpers');

const API = 'http://127.0.0.1:3101/api';

async function apiLogin(request, role) {
  const { email, password } = ACCOUNTS[role];
  const response = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(response.status()).toBe(200);
  return (await response.json()).token;
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('refund request и withdrawal проходят финансовые workflow', async ({ page, request }) => {
  test.setTimeout(60_000);
  const clientToken = await apiLogin(request, 'client');
  const refundLawyerToken = await apiLogin(request, 'refundLawyer');

  let paymentsResponse = await request.get(`${API}/payments/my`, { headers: auth(clientToken) });
  expect(paymentsResponse.status()).toBe(200);
  let payment = (await paymentsResponse.json()).find((item) => item.consultationId === REFUND_CONSULTATION_ID);
  if (!payment) {
    const paymentResponse = await request.post(`${API}/payments/simulate`, {
      headers: auth(clientToken), data: { consultationId: REFUND_CONSULTATION_ID },
    });
    expect(paymentResponse.status()).toBe(200);
    const creditedBalance = await request.get(`${API}/payments/balance`, { headers: auth(refundLawyerToken) });
    expect((await creditedBalance.json()).pendingBalance).toBe(120000);
    const cancelResponse = await request.post(`${API}/consultations/${REFUND_CONSULTATION_ID}/cancel`, {
      headers: auth(clientToken), data: { reason: 'E2E cancellation' },
    });
    expect(cancelResponse.status()).toBe(200);
    paymentsResponse = await request.get(`${API}/payments/my`, { headers: auth(clientToken) });
    payment = (await paymentsResponse.json()).find((item) => item.consultationId === REFUND_CONSULTATION_ID);
  }
  expect(payment).toMatchObject({ status: 'paid', refundStatus: 'requested', escrowReleased: false });
  const refundBalance = await request.get(`${API}/payments/balance`, { headers: auth(refundLawyerToken) });
  expect((await refundBalance.json()).pendingBalance).toBe(0);

  const lawyerToken = await apiLogin(request, 'lawyer');
  let withdrawalsResponse = await request.get(`${API}/payments/withdrawals`, { headers: auth(lawyerToken) });
  let withdrawals = await withdrawalsResponse.json();
  let withdrawal = withdrawals.find((item) => item.destinationSnapshot?.accountMask === '**** 4242');
  if (!withdrawal) {
    await login(page, 'lawyer');
    await page.getByRole('button', { name: 'Вывести средства' }).click();
    await page.getByPlaceholder('Сумма, сум').fill('120000');
    await page.getByLabel('Имя владельца счёта').fill('E2E Lawyer');
    await page.getByLabel('Последние 4 цифры счёта/карты').fill('4242');
    await page.getByRole('button', { name: 'Вывести', exact: true }).click();
    await expect(page.getByText(/Заявка на вывод.*принята/)).toBeVisible();
    withdrawalsResponse = await request.get(`${API}/payments/withdrawals`, { headers: auth(lawyerToken) });
    withdrawals = await withdrawalsResponse.json();
    withdrawal = withdrawals.find((item) => item.destinationSnapshot?.accountMask === '**** 4242');
  }
  expect(withdrawal).toMatchObject({ amount: '120000.00' });
  const withdrawalId = withdrawal.id;

  if (withdrawal.status !== 'paid') {
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await login(page, 'admin');
    await page.goto('/admin/finance');
    const row = page.getByTestId(`withdrawal-${withdrawalId}`);
    await expect(row).toContainText('E2E Lawyer');
    if (withdrawal.status === 'pending') {
      await row.getByRole('button', { name: 'Взять в обработку' }).click();
      await expect(row.getByRole('button', { name: 'Отметить выплаченной' })).toBeVisible();
    }
    await row.getByRole('button', { name: 'Отметить выплаченной' }).click();
    await page.getByLabel('ID банковской операции').fill('e2e-bank-transaction');
    await page.getByLabel('Банковский reference').fill('e2e-bank-reference');
    await page.getByRole('dialog').getByRole('button', { name: 'Отметить выплаченной' }).click();
    await expect(row).toContainText('Выплачено');
  }

  withdrawalsResponse = await request.get(`${API}/payments/withdrawals`, { headers: auth(lawyerToken) });
  withdrawals = await withdrawalsResponse.json();
  expect(withdrawals.find((item) => item.id === withdrawalId)).toMatchObject({
    status: 'paid', provider: 'manual_bank', providerTransactionId: 'e2e-bank-transaction',
    providerReference: 'e2e-bank-reference',
  });
});
