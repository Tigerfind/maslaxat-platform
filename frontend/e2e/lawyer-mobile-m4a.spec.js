const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const routes = [
  { path: '/lawyer/dashboard', nav: 'Главная', action: (page) => page.getByRole('button', { name: /Принимаю заявки|Не принимаю заявки/ }).first() },
  { path: '/lawyer/consultations', nav: 'Консультации', action: (page) => page.getByRole('button', { name: /Все/ }).first() },
  { path: '/lawyer/schedule', nav: 'Расписание', action: (page) => page.getByRole('button', { name: /Сохранить часы/ }) },
  { path: '/lawyer/analytics', nav: 'Аналитика', action: (page) => page.getByRole('button', { name: /Запросить вывод/ }) },
  { path: '/lawyer/profile/edit', nav: 'Профиль', action: (page) => page.getByRole('button', { name: /Сохранить изменения/ }) },
  { path: '/lawyer/reviews', action: (page) => page.getByRole('tab', { name: 'Все' }) },
  { path: '/settings', action: (page) => page.getByRole('button', { name: /Сохранить изменения/ }) },
];

async function expectNoPageOverflow(page) {
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))).toEqual(expect.objectContaining({
    documentWidth: page.viewportSize().width,
    viewportWidth: page.viewportSize().width,
  }));
}

async function expectTouchTarget(locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await locator.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(43.9);
  return box;
}

for (const width of [320, 375, 768]) {
  test(`M4A lawyer routes fit and retain reachable actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 812 });
    await login(page, 'lawyer');

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator('main.screen')).toBeVisible();
      const nav = page.getByTestId('mobile-bottom-nav');
      await expect(nav).toBeVisible();
      await expectNoPageOverflow(page);
      const actionBox = await expectTouchTarget(route.action(page));
      const navBox = await nav.boundingBox();
      expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(navBox.y + 1);

      if (route.nav) {
        const active = nav.getByRole('button', { name: route.nav, exact: true });
        await expect(active).toHaveAttribute('aria-current', 'page');
        await expectTouchTarget(active);
      }
    }
  });
}

test('M4A calendar and analytics keep wide visualizations inside labelled scrollers', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await login(page, 'lawyer');

  await page.goto('/lawyer/schedule');
  const calendar = page.getByRole('region', { name: /Расписание:/ });
  await expect(calendar).toBeVisible();
  await expect(calendar.getByRole('button', { pressed: true })).toHaveCount(1);
  expect(await calendar.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true);
  await expectNoPageOverflow(page);

  await page.goto('/lawyer/analytics');
  const chart = page.getByRole('region', { name: 'Доход по месяцам' });
  await expect(chart).toBeVisible();
  expect(await chart.evaluate((element) => element.scrollWidth >= element.clientWidth)).toBe(true);
  await expectNoPageOverflow(page);
});

test('M4A onboarding is a keyboard-accessible full-height mobile dialog', async ({ page, request }) => {
  const suffix = Date.now();
  const email = `mobile-onboarding.${suffix}@example.uz`;
  const password = 'Onboarding123!';
  const registration = await request.post('http://127.0.0.1:3101/api/auth/register', {
    data: {
      name: 'Mobile Lawyer', email, password, role: 'lawyer',
      specializations: ['Гражданское право'], acceptedTerms: true, legalVersion: '2026-08-13',
    },
  });
  expect(registration.status()).toBe(201);

  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/Пароль/i).fill(password);
  await page.locator('form').getByRole('button', { name: /^Войти$/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tablist')).toBeVisible();
  await expectTouchTarget(dialog.getByRole('tab').first());
  const titleInput = dialog.getByRole('textbox', { name: /Профессиональное звание/ });
  expect(await titleInput.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await expectNoPageOverflow(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
});
