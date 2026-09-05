const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const roleNav = {
  client: [
    ['Главная', '/dashboard'], ['Юристы', '/lawyers'], ['Консультации', '/consultations'],
    ['Документы', '/documents'], ['Профиль', '/profile'],
  ],
  lawyer: [
    ['Главная', '/lawyer/dashboard'], ['Консультации', '/lawyer/consultations'],
    ['Расписание', '/lawyer/schedule'], ['Аналитика', '/lawyer/analytics'], ['Профиль', '/lawyer/profile/edit'],
  ],
  admin: [
    ['Главная', '/admin/dashboard'], ['Управление пользователями', '/admin/users'],
    ['Управление юристами', '/admin/lawyers'], ['Финансы', '/admin/finance'], ['Настройки', '/settings'],
  ],
};

for (const role of Object.keys(roleNav)) {
  test(`mobile ${role} shell has one role-aware bottom navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, role);

    const nav = page.getByTestId('mobile-bottom-nav');
    await expect(nav).toHaveCount(1);
    for (const [label] of roleNav[role]) {
      const target = nav.getByRole('button', { name: label, exact: true });
      await expect(target).toBeVisible();
      expect((await target.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }

    const active = roleNav[role][0];
    await expect(nav.getByRole('button', { name: active[0], exact: true })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('button', { name: roleNav[role][1][0], exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${roleNav[role][1][1].replaceAll('/', '\\/')}$`));
    await expect(page.getByTestId('mobile-bottom-nav')).toHaveCount(1);
  });
}

for (const width of [320, 375]) {
  test(`notification panel stays within the ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await login(page, 'client');
    await page.getByRole('button', { name: 'Уведомления' }).click();

    const panel = page.getByRole('region', { name: 'Уведомления' });
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
  });
}

test('fullscreen consultation routes do not mount mobile shell navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'client');
  await page.goto('/consultations/chat/11111111-1111-4111-8111-111111111111');
  await expect(page.getByTestId('mobile-bottom-nav')).toHaveCount(0);
});
