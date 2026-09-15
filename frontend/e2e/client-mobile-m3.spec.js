const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const routes = [
  { path: '/dashboard', action: (page) => page.getByRole('button', { name: /AI-помощник/i }) },
  { path: '/ai-chat', action: (page) => page.getByPlaceholder(/юридический вопрос/i) },
  { path: '/documents', action: (page) => page.getByRole('button', { name: /Загрузить документ/i }).first() },
  { path: '/portfolio', action: (page) => page.locator('main.screen').getByRole('button', { name: 'Документы', exact: true }) },
  { path: '/my-lawyers', action: (page) => page.getByRole('button', { name: /Профиль|Записаться снова/i }).first() },
  { path: '/payments', action: (page) => page.getByText(/Платежей пока нет|Консультация|Подписка/i).first() },
  { path: '/profile', action: (page) => page.getByRole('button', { name: /Редактировать/i }) },
  { path: '/settings', action: (page) => page.getByRole('button', { name: /Сохранить изменения/i }) },
  { path: '/help', action: (page) => page.getByRole('button', { name: /Создать обращение/i }) },
];

async function expectNoHorizontalOverflow(page) {
  await expect.poll(() => page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))).toEqual(expect.objectContaining({ documentWidth: page.viewportSize().width, viewportWidth: page.viewportSize().width }));
}

async function expectAboveBottomNav(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const [targetBox, navBox] = await Promise.all([
    locator.boundingBox(),
    page.getByTestId('mobile-bottom-nav').boundingBox(),
  ]);
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(navBox.y + 1);
}

for (const width of [320, 375, 768]) {
  test(`M3 client routes fit and keep actions above bottom navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 812 });
    await login(page, 'client');

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator('main.screen')).toBeVisible();
      await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAboveBottomNav(page, route.action(page));
    }
  });
}

test('M3 booking is a keyboard-accessible full-height mobile flow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, 'client');
  await page.goto('/lawyers');
  await page.getByRole('button', { name: 'Фильтры' }).click();
  await expect(page.getByRole('button', { name: 'Показать результаты' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть фильтры' }).last().click();
  await page.locator('main.screen').getByRole('button', { name: 'Профиль', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Записаться на консультацию' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Назад к каталогу' }).click();
  const book = page.getByRole('button', { name: 'Записаться', exact: true }).first();
  await expect(book).toBeVisible();
  await book.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.height).toBeLessThanOrEqual(812);
  await expect(dialog.getByRole('button', { name: 'Далее' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Закрыть запись' })).toBeVisible();
  await expect(dialog.getByLabel('Шаги записи')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
