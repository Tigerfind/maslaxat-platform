const { expect, test } = require('../fixtures/test');
const { authenticatePage, registrationEmail, totpCode } = require('../helpers/auth');

test('registers and logs in a synthetic member', async ({ page, seedState }, testInfo) => {
  const email = registrationEmail(seedState.runId, testInfo.project.name, testInfo.retry);
  await page.goto('/register');
  await page.getByLabel(/имя|full name/i).fill('E2E Registered Member');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^пароль|password$/i).fill('E2e-pass-123!');
  await page.getByLabel(/подтверд|confirm/i).fill('E2e-pass-123!');
  await page.getByRole('button', { name: /регистра|создать|register/i }).click();
  await expect(page).toHaveURL(/dashboard/);
});

test('switches client and lawyer modes only after server confirmation', async ({ page, request, apiUrl, seedState }) => {
  await authenticatePage(page, request, apiUrl, seedState.actors.dualMember, 'client');
  await page.goto('/dashboard');
  const lawyerMode = page.getByRole('button', { name: 'Режим: Юрист' });
  await expect(lawyerMode).toBeVisible();
  await lawyerMode.click();
  await expect(page).toHaveURL(/\/lawyer\//);
  await expect(lawyerMode).toHaveAttribute('aria-pressed', 'true');
});

test('completes 2FA before entering an operational lawyer session', async ({ page, seedState }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(seedState.actors.mfaLawyer.email);
  await page.getByLabel(/пароль|password/i).fill(seedState.actors.mfaLawyer.password);
  await page.getByRole('button', { name: /войти|login/i }).click();
  await expect(page.getByLabel(/код|code/i)).toBeVisible();
  await page.getByLabel(/код|code/i).fill(totpCode(seedState.actors.mfaLawyer.totpSecret));
  await page.getByRole('button', { name: /подтверд|войти|submit|check/i }).click();
  await expect(page).toHaveURL(/\/lawyer\//);
});

test('keeps applicant out of operational pages', async ({ page, request, apiUrl, seedState }) => {
  await authenticatePage(page, request, apiUrl, seedState.actors.applicant, 'lawyer');
  await page.goto('/lawyer/promotions');
  await expect(page).toHaveURL(/\/lawyer\/onboarding/);
  await expect(page.getByRole('heading', { name: /профиль.*не допущен/i })).toBeVisible();
});
