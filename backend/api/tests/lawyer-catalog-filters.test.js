const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeLawyer } = require('./helpers');
const presence = require('../src/services/presenceService');

// Каталог публичный — токен не нужен.
const catalog = (query = '') => request(app).get(`/api/lawyers${query}`);

beforeAll(async () => {
  await resetDb();
  presence.resetForTests();

  // Разброс по рейтингу, цене, опыту и доступности — чтобы каждый фильтр
  // реально что-то отсекал.
  const fixtures = [
    { email: 'top@cat.uz', rating: 4.9, price: 400000, experience: 16, isAvailable: true },
    { email: 'good@cat.uz', rating: 4.6, price: 250000, experience: 12, isAvailable: false },
    { email: 'mid@cat.uz', rating: 4.0, price: 150000, experience: 7, isAvailable: true },
    { email: 'low@cat.uz', rating: 3.2, price: 100000, experience: 3, isAvailable: false },
    { email: 'fresh@cat.uz', rating: 0, price: 90000, experience: 1, isAvailable: true },
  ];
  for (const f of fixtures) {
    const created = await makeLawyer(f.email, {
      rating: f.rating, price: f.price, experience: f.experience, isAvailable: f.isAvailable,
    });
    if (f.isAvailable) presence.registerSocket({ id: `socket-${f.email}`, data: { userId: created.user.id, userRole: 'lawyer' } });
  }
});

describe('каталог юристов: базовая выдача', () => {
  test('minRating=0 не должен опустошать каталог', async () => {
    // Регрессия: фронт шлёт minRating=0 по умолчанию, бэкенд считал строку "0"
    // истинной и фильтровал рейтинг −0.5…0.5 → каталог был пуст у всех клиентов.
    const withZero = await catalog('?minRating=0');
    const without = await catalog();
    expect(withZero.status).toBe(200);
    expect(withZero.body.total).toBe(without.body.total);
    expect(withZero.body.total).toBeGreaterThan(0);
  });

  test('пустые строки в параметрах не сужают выдачу', async () => {
    const res = await catalog('?specialization=&search=&location=&language=&experience=&sortBy=rating');
    expect(res.body.total).toBe(5);
  });
});

describe('каталог юристов: минимальный рейтинг = именно минимум', () => {
  test('«от 4 звёзд» включает 4.9, а не прячет его', async () => {
    const res = await catalog('?minRating=4');
    const ratings = res.body.lawyers.map((l) => Number(l.profile.rating));
    expect(ratings).toContain(4.9);
    expect(ratings.every((r) => r >= 4)).toBe(true);
    expect(ratings).not.toContain(3.2);
  });

  test('«высокий рейтинг» (4.5+) отбирает только топ', async () => {
    const res = await catalog('?minRating=4.5');
    expect(res.body.total).toBe(2);
    expect(res.body.lawyers.every((l) => Number(l.profile.rating) >= 4.5)).toBe(true);
  });
});

describe('каталог юристов: опыт (фильтр был декоративным)', () => {
  test('диапазон 5-10 отбирает по годам', async () => {
    const res = await catalog('?experience=5-10');
    expect(res.body.total).toBe(1);
    expect(Number(res.body.lawyers[0].profile.experience)).toBe(7);
  });

  test('открытый диапазон 10+ = «опытные»', async () => {
    const res = await catalog('?experience=10%2B');
    expect(res.body.total).toBe(2);
    expect(res.body.lawyers.every((l) => Number(l.profile.experience) >= 10)).toBe(true);
  });

  test('мусорное значение игнорируется, а не обнуляет выдачу', async () => {
    const res = await catalog('?experience=abc');
    expect(res.body.total).toBe(5);
  });
});

describe('каталог юристов: быстрые фильтры комбинируются', () => {
  test('онлайн + высокий рейтинг применяются вместе (И, а не ИЛИ)', async () => {
    const res = await catalog('?onlineOnly=true&minRating=4.5');
    expect(res.body.total).toBe(1);
    const l = res.body.lawyers[0];
    expect(l.presence.online).toBe(true);
    expect(Number(l.profile.rating)).toBeGreaterThanOrEqual(4.5);
  });

  test('опытные + недорого могут дать пустой результат — это валидно', async () => {
    const res = await catalog('?experience=10%2B&maxPrice=100000');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });
});

describe('каталог юристов: фасеты для чипов', () => {
  test('счётчики соответствуют реальным данным', async () => {
    const { body } = await catalog();
    expect(body.facets.total).toBe(5);
    expect(body.facets.online).toBe(3);
    expect(body.facets.highRating).toEqual({ from: 4.5, count: 2 });
    expect(body.facets.experienced).toEqual({ from: 10, count: 2 });
  });

  test('порог «недорого» берётся из реальных цен, а не из константы', async () => {
    const { body } = await catalog();
    const { maxPrice, count } = body.facets.budget;
    expect(maxPrice).toBeGreaterThan(0);
    // Порог не должен покрывать весь каталог — иначе чип бессмысленный
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(body.facets.total);

    // И он действительно отбирает столько же, сколько обещает
    const filtered = await catalog(`?maxPrice=${maxPrice}`);
    expect(filtered.body.total).toBe(count);
  });

  test('фасеты не зависят от текущих фильтров (показывают, что есть вообще)', async () => {
    const filtered = await catalog('?minRating=4.9');
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.facets.total).toBe(5);
  });
});

describe('каталог юристов: непроверенные не видны', () => {
  test('юрист на модерации не попадает ни в выдачу, ни в фасеты', async () => {
    const before = (await catalog()).body.facets.total;
    const { user } = await makeLawyer('pending@cat.uz', { verificationStatus: 'pending', isAvailable: true });

    const res = await catalog();
    expect(res.body.lawyers.some((l) => l.id === user.id)).toBe(false);
    expect(res.body.facets.total).toBe(before);
    expect(await models.User.count({ where: { role: 'lawyer' } })).toBeGreaterThan(before);
  });
});
