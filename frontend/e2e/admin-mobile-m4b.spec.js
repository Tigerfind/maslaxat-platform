const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.setTimeout(120000);

const now = '2026-09-04T09:00:00.000Z';

async function mockAdminData(page) {
  await page.route('**/api/admin/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const path = new URL(route.request().url()).pathname;
    const responses = {
      '/api/admin/dashboard/stats': { totalUsers: 3, totalLawyers: 1, totalClients: 1, activeConsultations: 1, totalConsultations: 2, monthlyRevenue: 120000, totalRevenue: 520000 },
      '/api/admin/activity/recent': [{ id: 'activity-1', type: 'user_registration', role: 'client', userName: 'Mobile Client', createdAt: now }],
      '/api/admin/dashboard/reports': { monthlyRevenue: [{ month: '2026-04', revenue: 10000 }, { month: '2026-05', revenue: 20000 }, { month: '2026-06', revenue: 30000 }, { month: '2026-07', revenue: 40000 }, { month: '2026-08', revenue: 50000 }, { month: '2026-09', revenue: 60000 }], usersGrowth: [{ month: '2026-04', clients: 1, lawyers: 1 }, { month: '2026-05', clients: 2, lawyers: 1 }, { month: '2026-06', clients: 3, lawyers: 1 }, { month: '2026-07', clients: 4, lawyers: 2 }, { month: '2026-08', clients: 5, lawyers: 2 }, { month: '2026-09', clients: 6, lawyers: 3 }], topLawyers: [{ name: 'Mobile Lawyer', completedCases: 4, rating: 5 }], consultationsByStatus: { accepted: 1, completed: 1 } },
      '/api/admin/specializations': [{ id: 'spec-1', name: 'Гражданское право', nameUz: 'Fuqarolik huquqi', nameEn: 'Civil law', lawyerCount: 1, isActive: true }],
      '/api/admin/promos': [{ id: 'promo-1', code: 'MOBILE10', discountPercent: 10, minAmount: 50000, usedCount: 2, usageLimit: 20, expiresAt: '2027-01-01T00:00:00.000Z', isActive: true }],
      '/api/admin/reviews': { reviews: [{ id: 'review-1', lawyer: { name: 'Mobile Lawyer' }, client: { name: 'Mobile Client' }, rating: 5, text: 'Полезная консультация', createdAt: now, isHidden: false }], totalPages: 1 },
      '/api/admin/support': { tickets: [{ id: 'ticket-1', user: { name: 'Mobile Client', email: 'very.long.mobile.client@example.uz' }, subject: 'Оплата консультации', message: 'Нужна помощь с проверкой статуса платежа.', response: '', status: 'open', createdAt: now }], counts: { all: 1, open: 1, in_progress: 0, closed: 0 }, totalPages: 1 },
      '/api/admin/withdrawals': { withdrawals: [{ id: 'withdrawal-1', lawyer: { name: 'Mobile Lawyer', email: 'mobile.lawyer@example.uz' }, amount: 150000, status: 'pending', note: '', createdAt: now }], counts: { pending: 1, pendingAmount: 150000, paid: 0 }, totalPages: 1 },
      '/api/admin/payments': { payments: [{ id: 'payment-1', user: { name: 'Mobile Client', email: 'mobile.client@example.uz' }, amount: 120000, provider: 'payme', status: 'paid', createdAt: now }], counts: { paid: 1, paidAmount: 120000 }, totalPages: 1 },
    };

    if (path === '/api/admin/users') return route.fulfill({ json: { users: [{ id: 'user-1', name: 'Mobile Client', email: 'very.long.mobile.client@example.uz', role: 'client', isActive: true, isVerified: true, createdAt: now }], counts: { all: 1, clients: 1, lawyers: 0, blocked: 0 }, totalPages: 1 } });
    if (path === '/api/admin/lawyers') return route.fulfill({ json: { lawyers: [{ id: 'lawyer-1', name: 'Mobile Lawyer', email: 'very.long.mobile.lawyer@example.uz', createdAt: now, profile: { specialization: 'Гражданское право', verificationStatus: 'pending_review' }, profileCompleteness: { complete: true, missing: [] } }], counts: { all: 1, approved: 0, pending: 1, rejected: 0 }, totalPages: 1 } });
    if (path === '/api/admin/consultations') return route.fulfill({ json: { consultations: [{ id: 'consultation-1', client: { name: 'Mobile Client', email: 'mobile.client@example.uz' }, lawyer: { name: 'Mobile Lawyer', profile: { specialization: 'Гражданское право' } }, scheduledDate: now, scheduledTime: '14:00', price: 120000, status: 'accepted', meetingProvider: 'zoom', createdAt: now }], total: 1, totalPages: 1 } });
    if (responses[path]) return route.fulfill({ json: responses[path] });
    return route.continue();
  });
}

async function expectNoPageOverflow(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

async function expectTouchTarget(locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const box = await locator.evaluate((element) => {
    const target = element.matches('input[type="checkbox"]') ? element.closest('label') || element : element;
    const bounds = target.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(box.height).toBeGreaterThanOrEqual(43.9);
}

const routes = [
  { path: '/admin/dashboard', nav: 'Главная', action: (page) => page.getByRole('main').getByRole('button', { name: 'Управление пользователями' }), data: true },
  { path: '/admin/users', nav: 'Управление пользователями', action: (page) => page.getByRole('button', { name: 'Заблокировать' }), data: true },
  { path: '/admin/lawyers', nav: 'Управление юристами', action: (page) => page.getByRole('button', { name: 'Документы' }), data: true },
  { path: '/admin/specializations', action: (page) => page.getByRole('button', { name: 'Добавить специализацию' }), data: true },
  { path: '/admin/consultations', action: (page, width) => page.getByRole('button', { name: width < 600 ? 'Открыть диагностику' : 'Открыть' }), data: true },
  { path: '/admin/finance', nav: 'Финансы', action: (page) => page.getByRole('tab', { name: 'Заявки на вывод' }), data: true },
  { path: '/admin/promos', action: (page) => page.getByRole('button', { name: 'Добавить промокод' }), data: true },
  { path: '/admin/reviews', action: (page) => page.getByRole('checkbox', { name: /Виден/ }), data: true },
  { path: '/admin/support', action: (page) => page.getByRole('button', { name: /Ответить: Оплата консультации/ }), data: true },
];

for (const width of [320, 375, 768]) {
  test(`M4B admin route sweep at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 812 });
    await mockAdminData(page);
    await login(page, 'admin');

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator('main.screen')).toBeVisible();
      const nav = page.getByTestId('mobile-bottom-nav');
      await expect(nav).toBeVisible();
      await expectNoPageOverflow(page);
      await expectTouchTarget(route.action(page, width));

      if (route.nav) await expect(nav.getByRole('button', { name: route.nav, exact: true })).toHaveAttribute('aria-current', 'page');
      if (width < 600 && route.data) {
        await expect(page.getByTestId('responsive-data-cards')).toBeVisible();
        await expect(page.getByTestId('responsive-data-cards').getByRole('article').first()).toBeVisible();
        await expect(page.getByTestId('responsive-data-table')).toBeHidden();
      } else if (route.data) {
        await expect(page.getByTestId('responsive-data-table')).toBeVisible();
        await expect(page.getByTestId('responsive-data-cards')).toBeHidden();
      }
    }
  });
}

test('M4B promo dialog is reachable and mobile safe without mutating data', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await mockAdminData(page);
  await login(page, 'admin');
  await page.goto('/admin/promos');
  await page.getByRole('button', { name: 'Добавить промокод' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.width).toBeLessThanOrEqual(320);
  expect(box.height).toBeLessThanOrEqual(812);
  await expectTouchTarget(dialog.getByRole('button', { name: 'Отмена' }));
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(dialog).toBeHidden();
  await expectNoPageOverflow(page);
});
