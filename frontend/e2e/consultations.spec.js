const { test, expect } = require('@playwright/test');
const { login, VIDEO_CONSULTATION_ID } = require('./helpers');

test('клиент видит server counts, payment tab и открывает детали консультации', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/consultations');

  await expect(page.getByRole('button', { name: /Ожидают оплаты \(1\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Предстоящие \([1-9]\d*\)/ })).toBeVisible();

  await page.getByRole('button', { name: /Ожидают оплаты \(1\)/ }).click();
  await expect(page.getByText('Ожидает оплаты', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оплатить' })).toBeVisible();

  await page.getByRole('button', { name: /Предстоящие \([1-9]\d*\)/ }).click();
  await page.getByText('E2E video call').click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${VIDEO_CONSULTATION_ID}$`));
  await expect(page.getByRole('heading', { name: 'Статус оплаты' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ваш вопрос' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История статусов' })).toBeVisible();
});
