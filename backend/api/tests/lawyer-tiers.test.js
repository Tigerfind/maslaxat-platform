const request = require('supertest');
const app = require('../src/server');
const { resetDb, makeLawyer } = require('./helpers');
const tiers = require('../src/services/lawyerTiers');

const catalog = (query = '') => request(app).get(`/api/lawyers${query}`);

beforeAll(async () => {
  await resetDb();

  // Разброс по цене и «весу» юриста: три ценовых сегмента и три ступени статуса
  // должны реально делить каталог, а не схлопываться в один.
  const fixtures = [
    // топ: рейтинг 4.8+ и много отзывов
    { email: 't1@tier.uz', price: 500000, rating: 4.9, reviewsCount: 140, experience: 16 },
    { email: 't2@tier.uz', price: 450000, rating: 4.8, reviewsCount: 60, experience: 12 },
    // эксперт: стаж 10+, но отзывов мало / рейтинг ниже
    { email: 'e1@tier.uz', price: 300000, rating: 4.4, reviewsCount: 8, experience: 14 },
    { email: 'e2@tier.uz', price: 250000, rating: 4.9, reviewsCount: 25, experience: 4 },
    // практик: без стажа и без истории отзывов
    { email: 'p1@tier.uz', price: 120000, rating: 4.2, reviewsCount: 3, experience: 2 },
    { email: 'p2@tier.uz', price: 90000, rating: 0, reviewsCount: 0, experience: 1 },
  ];
  for (const f of fixtures) {
    await makeLawyer(f.email, {
      price: f.price, rating: f.rating, reviewsCount: f.reviewsCount, experience: f.experience,
    });
  }
});

describe('подбор по статусу', () => {
  test('ступени взаимоисключающие и в сумме дают весь каталог', async () => {
    const { body } = await catalog();
    const segs = Object.fromEntries(body.facets.statusSegments.map((s) => [s.key, s.count]));
    expect(segs.top + segs.expert + segs.practitioner).toBe(body.facets.total);
    // Каждая ступень непустая — иначе подбор бессмыслен
    expect(segs.top).toBe(2);
    expect(segs.expert).toBe(2);
    expect(segs.practitioner).toBe(2);
  });

  test('«топ» требует и рейтинга, и подтверждения отзывами', async () => {
    const { body } = await catalog('?status=top');
    expect(body.total).toBe(2);
    body.lawyers.forEach((l) => {
      expect(Number(l.profile.rating)).toBeGreaterThanOrEqual(4.8);
      expect(Number(l.profile.reviewsCount)).toBeGreaterThanOrEqual(30);
    });
    // Юрист с рейтингом 4.9, но 25 отзывами в «топ» не попадает
    expect(body.lawyers.some((l) => Number(l.profile.reviewsCount) === 25)).toBe(false);
  });

  test('«практик» — те, у кого нет ни стажа, ни истории', async () => {
    const { body } = await catalog('?status=practitioner');
    expect(body.total).toBe(2);
    body.lawyers.forEach((l) => {
      expect(Number(l.profile.experience)).toBeLessThan(10);
      expect(Number(l.profile.reviewsCount)).toBeLessThan(20);
    });
  });

  test('счётчик сегмента совпадает с фактической выдачей', async () => {
    const { body } = await catalog();
    for (const seg of body.facets.statusSegments) {
      const res = await catalog(`?status=${seg.key}&limit=50`);
      expect(res.body.total).toBe(seg.count);
    }
  });

  test('карточка и фильтр считают ступень одинаково', async () => {
    const { body } = await catalog('?limit=50');
    body.lawyers.forEach((l) => {
      expect(l.profile.status).toBe(tiers.statusOf(l.profile));
    });
    const top = await catalog('?status=top&limit=50');
    top.body.lawyers.forEach((l) => expect(l.profile.status).toBe('top'));
  });
});

describe('подбор по карману', () => {
  test('три ценовых сегмента делят каталог без пересечений', async () => {
    const { body } = await catalog();
    const segs = body.facets.priceSegments;
    expect(segs).toHaveLength(3);
    expect(segs.reduce((s, x) => s + x.count, 0)).toBe(body.facets.total);
  });

  test('границы берутся из реальных цен, а не из константы', async () => {
    const { body } = await catalog();
    const [eco, std, prem] = body.facets.priceSegments;
    expect(eco.from).toBeNull();
    expect(prem.to).toBeNull();
    expect(eco.to).toBeLessThan(prem.from + 1);
    expect(std.from).toBe(eco.to);
  });

  test('эконом отбирает самых доступных', async () => {
    const { body } = await catalog();
    const eco = body.facets.priceSegments.find((s) => s.key === 'economy');
    const res = await catalog('?budget=economy&limit=50');
    expect(res.body.total).toBe(eco.count);
    res.body.lawyers.forEach((l) => expect(Number(l.profile.price)).toBeLessThanOrEqual(eco.to));
  });

  test('премиум отбирает верхнюю треть', async () => {
    const { body } = await catalog();
    const prem = body.facets.priceSegments.find((s) => s.key === 'premium');
    const res = await catalog('?budget=premium&limit=50');
    expect(res.body.total).toBe(prem.count);
    res.body.lawyers.forEach((l) => expect(Number(l.profile.price)).toBeGreaterThan(prem.from));
  });
});

describe('подбор: карман + статус вместе', () => {
  test('условия складываются, а не заменяют друг друга', async () => {
    const res = await catalog('?budget=premium&status=top&limit=50');
    expect(res.status).toBe(200);
    res.body.lawyers.forEach((l) => {
      expect(l.profile.status).toBe('top');
      expect(Number(l.profile.price)).toBeGreaterThan(0);
    });
    // Топ в эконом-сегменте на этих данных не существует — и это честный ноль,
    // а не ошибка
    const cheapTop = await catalog('?budget=economy&status=top');
    expect(cheapTop.body.total).toBe(0);
  });

  test('неизвестные значения игнорируются, а не обнуляют каталог', async () => {
    const res = await catalog('?budget=luxury&status=legend');
    expect(res.body.total).toBe(6);
  });
});
