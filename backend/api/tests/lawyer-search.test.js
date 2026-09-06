const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeLawyer } = require('./helpers');

const catalog = (params) => request(app).get(`/api/lawyers?${new URLSearchParams(params).toString()}`);

let expectedIds;

beforeAll(async () => {
  await resetDb();

  const byName = await makeLawyer('search-name@test.uz', {
    specialization: 'Гражданское право',
    specializations: ['Гражданское право'],
    location: 'SearchCity',
  });
  await byName.user.update({ name: 'Адвокат КИРИЛЛТЕСТ' });

  const byPrimary = await makeLawyer('search-primary@test.uz', {
    specialization: 'КИРИЛЛТЕСТ договорное право',
    specializations: [],
    location: 'SearchCity',
  });

  const byArray = await makeLawyer('search-array@test.uz', {
    specialization: 'Семейное право',
    specializations: ['Семейное право', 'КИРИЛЛТЕСТ налоги'],
    location: 'SearchCity',
  });

  const pending = await makeLawyer('search-pending@test.uz', {
    specialization: 'КИРИЛЛТЕСТ скрытый',
    specializations: ['КИРИЛЛТЕСТ скрытый'],
    location: 'SearchCity',
    verificationStatus: 'pending',
  });
  await pending.user.update({ name: 'КИРИЛЛТЕСТ скрытый' });

  const quoted = await makeLawyer('search-quote@test.uz', { location: 'QuoteCity' });
  await quoted.user.update({ name: "Адвокат О'Коннор" });

  expectedIds = [byName.user.id, byPrimary.user.id, byArray.user.id].sort();
});

test('ищет без учёта регистра по имени и обеим формам специализации', async () => {
  const page1 = await catalog({ search: 'кириллтест', location: 'SearchCity', page: '1', limit: '2' });
  const page2 = await catalog({ search: 'кириллтест', location: 'SearchCity', page: '2', limit: '2' });

  expect(page1.status).toBe(200);
  expect(page2.status).toBe(200);
  expect(page1.body.total).toBe(3);
  expect(page2.body.total).toBe(3);
  expect(page1.body.totalPages).toBe(2);

  const ids = [...page1.body.lawyers, ...page2.body.lawyers].map((lawyer) => lawyer.id).sort();
  expect(ids).toEqual(expectedIds);
});

test('безопасно обрабатывает апостроф и SQL-подобный ввод', async () => {
  const quoted = await catalog({ search: "о'коннор" });
  expect(quoted.status).toBe(200);
  expect(quoted.body.total).toBe(1);

  const injection = await catalog({ search: "%' OR TRUE --" });
  expect(injection.status).toBe(200);
  expect(injection.body.total).toBe(0);

  const wildcard = await catalog({ search: '%' });
  expect(wildcard.status).toBe(200);
  expect(wildcard.body.total).toBe(0);
  expect(await models.User.count()).toBe(5);
});

test('нормализует невалидную пагинацию и ограничивает размер страницы', async () => {
  const invalid = await catalog({ page: '0', limit: 'abc' });
  expect(invalid.status).toBe(200);
  expect(invalid.body.page).toBe(1);
  expect(invalid.body.totalPages).toBe(1);

  const oversized = await catalog({ page: '-5', limit: '10000' });
  expect(oversized.status).toBe(200);
  expect(oversized.body.page).toBe(1);
  expect(oversized.body.lawyers).toHaveLength(4);
});
