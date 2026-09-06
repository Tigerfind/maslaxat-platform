const request = require('supertest');
const { DateTime } = require('luxon');
const app = require('../src/server');
const { resetDb, makeLawyer } = require('./helpers');

const catalog = (q = '') => request(app).get(`/api/lawyers${q}`);

// Расписание «работает прямо сейчас» и «не работает никогда» — чтобы тест не
// зависел от того, в какое время суток его запустили.
const zone = 'Asia/Tashkent';
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function scheduleOpenNow() {
  const now = DateTime.now().setZone(zone);
  const today = DAYS[now.weekday - 1];
  const week = {};
  DAYS.forEach((d) => { week[d] = { enabled: false, from: '09:00', to: '18:00' }; });
  week[today] = { enabled: true, from: '00:00', to: '23:59' };
  return week;
}
function scheduleClosed() {
  const week = {};
  DAYS.forEach((d) => { week[d] = { enabled: false, from: '09:00', to: '18:00' }; });
  return week;
}

beforeAll(async () => {
  await resetDb();
  await makeLawyer('open@chips.uz', {
    schedule: scheduleOpenNow(), timezone: zone, isAvailable: true,
    languages: ['Русский', 'Английский'], rating: 0, reviewsCount: 0,
  });
  await makeLawyer('closed@chips.uz', {
    schedule: scheduleClosed(), timezone: zone, isAvailable: true,
    languages: ['Русский'], rating: 0, reviewsCount: 0,
  });
  await makeLawyer('paused@chips.uz', {
    schedule: scheduleOpenNow(), timezone: zone, isAvailable: false,
    languages: ['Русский', 'Английский'], rating: 0, reviewsCount: 0,
  });
});

describe('чип «Доступен сейчас»', () => {
  test('считает по часам приёма, а не только по socket-присутствию', async () => {
    const { body } = await catalog();
    // Никто не подключён сокетом, но один юрист внутри рабочего окна
    expect(body.facets.online).toBe(0);
    expect(body.facets.availableNow).toBe(1);
  });

  test('фильтр отдаёт ровно тех, кого обещает счётчик', async () => {
    const { body } = await catalog('?availableNow=true');
    expect(body.total).toBe(body.facets.availableNow);
    expect(body.lawyers).toHaveLength(1);
    expect(body.lawyers[0].email || body.lawyers[0].name).toBeDefined();
  });

  test('юрист, закрывший приём, не считается доступным даже в рабочее окно', async () => {
    const { body } = await catalog('?availableNow=true');
    const names = body.lawyers.map((l) => l.name);
    // paused@chips.uz имеет открытое расписание, но isAvailable=false
    expect(body.total).toBe(1);
    expect(names).toHaveLength(1);
  });
});

describe('чип рейтинга подменяется, пока оценок нет', () => {
  test('hasRatings=false, когда ни у кого нет оценки', async () => {
    const { body } = await catalog();
    expect(body.facets.hasRatings).toBe(false);
    expect(body.facets.highRating.count).toBe(0);
  });

  test('английский язык — рабочая замена: делит каталог, а не выбирает всех', async () => {
    const { body } = await catalog();
    expect(body.facets.english.count).toBeGreaterThan(0);
    expect(body.facets.english.count).toBeLessThan(body.facets.total);
  });

  test('фильтр по языку совпадает со счётчиком', async () => {
    const { body: base } = await catalog();
    const { body } = await catalog('?language=%D0%90%D0%BD%D0%B3%D0%BB%D0%B8%D0%B9%D1%81%D0%BA%D0%B8%D0%B9');
    expect(body.total).toBe(base.facets.english.count);
  });

  test('как только появляется оценка, hasRatings становится true', async () => {
    const { models } = require('./helpers');
    await models.LawyerProfile.update({ rating: 4.9, reviewsCount: 40 }, { where: {}, limit: 1 });
    const { body } = await catalog();
    expect(body.facets.hasRatings).toBe(true);
  });
});
