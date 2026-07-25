const { resetDb, models } = require('./helpers');
const { validatePromo } = require('../src/services/promoService');

const { Promo } = models;

beforeAll(async () => {
  await resetDb();
});

describe('promoService.validatePromo', () => {
  test('валидный код — считает скидку от суммы', async () => {
    await Promo.create({ code: 'SAVE10', discountPercent: 10, isActive: true });
    const r = await validatePromo('save10', 200000); // регистр не важен
    expect(r.valid).toBe(true);
    expect(r.code).toBe('SAVE10');
    expect(r.discountPercent).toBe(10);
    expect(r.discountAmount).toBe(20000);
  });

  test('неизвестный код → notfound', async () => {
    const r = await validatePromo('NOPE', 200000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('notfound');
  });

  test('пустой код → empty', async () => {
    const r = await validatePromo('', 200000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('empty');
  });

  test('неактивный код → notfound', async () => {
    await Promo.create({ code: 'OFF', discountPercent: 20, isActive: false });
    const r = await validatePromo('OFF', 200000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('notfound');
  });

  test('истёкший код → expired', async () => {
    await Promo.create({ code: 'OLD', discountPercent: 15, isActive: true, expiresAt: new Date('2020-01-01') });
    const r = await validatePromo('OLD', 200000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('expired');
  });

  test('исчерпан лимит использований → limit', async () => {
    await Promo.create({ code: 'LIM', discountPercent: 10, isActive: true, usageLimit: 2, usedCount: 2 });
    const r = await validatePromo('LIM', 200000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('limit');
  });

  test('сумма меньше минимальной → min', async () => {
    await Promo.create({ code: 'MIN', discountPercent: 10, isActive: true, minAmount: 100000 });
    const r = await validatePromo('MIN', 50000);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('min');
    expect(r.minAmount).toBe(100000);
  });
});
