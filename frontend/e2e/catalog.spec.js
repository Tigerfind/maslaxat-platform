const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('клиент видит каталог и может открыть бронирование', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/lawyers');
  await expect(page.getByText('E2E Lawyer').first()).toBeVisible();
  await page.getByRole('button', { name: 'Записаться', exact: true }).first().click();
  await expect(page.getByText('Запись на консультацию')).toBeVisible();
});

test('поиск debounce, цена, бюджет и сброс передают точные параметры API', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/lawyers');
  await expect(page.getByText('E2E Lawyer').first()).toBeVisible();

  const searchRequests = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.endsWith('/api/client/lawyers') && url.searchParams.get('search')) {
      searchRequests.push(url.searchParams.get('search'));
    }
  });
  const input = page.getByPlaceholder('Поиск по имени или специализации...');
  const finalSearch = page.waitForRequest((req) => new URL(req.url()).searchParams.get('search') === 'E2E');
  await input.pressSequentially('E2E', { delay: 40 });
  await finalSearch;
  expect(searchRequests).toEqual(['E2E']);

  const clearRequest = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return url.pathname.endsWith('/api/client/lawyers') && !url.searchParams.get('search');
  });
  await page.getByRole('button', { name: 'Очистить поиск' }).click();
  await clearRequest;

  const minRequest = page.waitForRequest((req) => new URL(req.url()).searchParams.get('minPrice') === '50000');
  await page.getByRole('slider').first().press('ArrowRight');
  await minRequest;

  const maxRequest = page.waitForRequest((req) => new URL(req.url()).searchParams.get('maxPrice') === '9950000');
  await page.getByRole('slider').nth(1).press('ArrowLeft');
  await maxRequest;

  const resetRequest = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return url.pathname.endsWith('/api/client/lawyers')
      && !url.searchParams.has('minPrice') && url.searchParams.get('maxPrice') === '10000000';
  });
  await page.getByRole('button', { name: 'Сбросить фильтры' }).first().click();
  await resetRequest;

  const sortRequest = page.waitForRequest((req) => new URL(req.url()).searchParams.get('sortBy') === 'price_low');
  await page.getByRole('combobox').last().click();
  await page.getByRole('option', { name: /По цене \(возр\.\)/ }).click();
  await sortRequest;

  const cheapButton = page.getByRole('button', { name: /Недорого/ });
  await expect(cheapButton).toBeEnabled();
  const budgetRequest = page.waitForRequest((req) => {
    const value = Number(new URL(req.url()).searchParams.get('maxPrice'));
    return value > 0 && value < 10000000;
  });
  await cheapButton.click();
  await budgetRequest;
});

test('профиль показывает честное AI-действие и не обещает прямой чат', async ({ page, request }) => {
  await login(page, 'client');
  const lawyers = await request.get('http://127.0.0.1:3101/api/lawyers?limit=1');
  const lawyer = (await lawyers.json()).lawyers[0];
  await page.goto(`/lawyers/${lawyer.id}`);

  await expect(page.getByRole('heading', { name: 'E2E Lawyer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Спросить AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Написать' })).toHaveCount(0);
  await expect(page.getByText('Проверенный юрист')).toBeVisible();
  await expect(page.getByText('Тариф за 60 минут').first()).toBeVisible();
  if (process.env.PROFILE_SCREENSHOTS === '1') {
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/lawyer-profile-desktop.png', fullPage: true });
  }
  await page.getByRole('tab', { name: 'Опыт работы' }).click();
  await expect(page.getByText('E2E Legal')).toBeVisible();
  await page.getByRole('tab', { name: 'Образование' }).click();
  await expect(page.getByText('ТГЮУ')).toBeVisible();
  await page.getByRole('tab', { name: 'Отзывы' }).click();
  await expect(page.getByText('Полезная и понятная консультация')).toBeVisible();
  await expect(page.getByText('Подтверждённая консультация').first()).toBeVisible();
});

test('каталог и профиль не выходят за экран на контрольных ширинах', async ({ page, request }) => {
  await login(page, 'client');
  const lawyers = await request.get('http://127.0.0.1:3101/api/lawyers?limit=1');
  const lawyer = (await lawyers.json()).lawyers[0];

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/lawyers');
    await expect(page.getByText('E2E Lawyer').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width <= 768) {
      const openFilters = page.getByRole('button', { name: 'Открыть фильтры' });
      expect((await openFilters.boundingBox()).height).toBeGreaterThanOrEqual(43.9);
      await openFilters.click();
      await expect(page.getByRole('button', { name: 'Показать результаты' })).toBeVisible();
      const drawer = page.locator('.MuiDrawer-paperAnchorBottom');
      expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.getByRole('button', { name: 'Показать результаты' }).click();
      await expect(page.getByRole('button', { name: 'Показать результаты' })).toBeHidden();
    }
    if (width === 320) {
      const favorite = page.getByRole('button', { name: /избранн/i }).first();
      const booking = page.getByRole('button', { name: 'Записаться', exact: true }).first();
      expect((await favorite.boundingBox()).height).toBeGreaterThanOrEqual(43.9);
      expect((await booking.boundingBox()).height).toBeGreaterThanOrEqual(43.9);
    }

    await page.goto(`/lawyers/${lawyer.id}`);
    await expect(page.getByRole('heading', { name: 'E2E Lawyer' })).toBeVisible();
    if (width === 375 && process.env.PROFILE_SCREENSHOTS === '1') {
      await page.waitForTimeout(400);
      await page.screenshot({ path: 'test-results/lawyer-profile-mobile.png', fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 320) {
      const aboutTab = page.getByRole('tab', { name: 'О юристе' });
      expect((await aboutTab.boundingBox()).height).toBeGreaterThanOrEqual(43.9);
      await aboutTab.focus();
      await aboutTab.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Опыт работы' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toBeVisible();
      const stickyBooking = page.locator('.lpv2-mobile-book');
      await expect(stickyBooking).toBeVisible();
      const bookingBox = await stickyBooking.boundingBox();
      expect(bookingBox.height).toBeGreaterThanOrEqual(43.9);
      expect(bookingBox.y + bookingBox.height).toBeLessThanOrEqual(844 - 64 + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});

test('профиль сохраняет тёмную тему и отключает анимации по системной настройке', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'client');
  const lawyers = await request.get('http://127.0.0.1:3101/api/lawyers?limit=1');
  const lawyer = (await lawyers.json()).lawyers[0];
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.goto(`/lawyers/${lawyer.id}`);
  await expect(page.getByRole('heading', { name: 'E2E Lawyer' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.lpv2-panel').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});

test('API бронирования требует consent и сохраняет корректную бронь', async ({ page, request }) => {
  await login(page, 'client');
  const token = await page.evaluate(() => localStorage.getItem('token'));
  const lawyers = await request.get('http://127.0.0.1:3101/api/lawyers?limit=1');
  const lawyer = (await lawyers.json()).lawyers[0];
  const headers = { Authorization: `Bearer ${token}` };

  const denied = await request.post(`http://127.0.0.1:3101/api/client/lawyers/${lawyer.id}/book`, {
    headers, data: { question: 'Проверка согласия' },
  });
  expect(denied.status()).toBe(400);

  const accepted = await request.post(`http://127.0.0.1:3101/api/client/lawyers/${lawyer.id}/book`, {
    headers,
    data: {
      question: 'Проверка Playwright', consultationType: 'chat',
      acceptedTerms: true, legalVersion: '2026-08-13',
    },
  });
  expect(accepted.status()).toBe(201);
  expect((await accepted.json()).consultation.legalVersion).toBe('2026-08-13');
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('нижняя навигация доступна и открывает моих юристов', async ({ page }) => {
    await login(page, 'client');
    await expect(page.getByRole('button', { name: 'Мои юристы' })).toBeVisible();
    await page.getByRole('button', { name: 'Мои юристы' }).click();
    await expect(page).toHaveURL(/\/my-lawyers$/);
    await expect(page.getByText('E2E Lawyer').first()).toBeVisible();
  });
});
