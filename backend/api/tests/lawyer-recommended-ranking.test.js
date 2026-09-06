const request = require('supertest');
const app = require('../src/server');
const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const presence = require('../src/services/presenceService');

const catalog = (query = '') => request(app).get(`/api/lawyers${query}`);

beforeEach(async () => {
  await resetDb();
  presence.resetForTests();
});

test('полный профиль с проверенным документом выше пустого при нулевых рейтингах', async () => {
  const { user: weak } = await makeLawyer('recommended-weak@test.uz', {
    rating: 0, reviewsCount: 0, experience: 0, description: '', schedule: {},
    specialization: 'Не указана', specializations: [], price: 0, isAvailable: true,
  });
  const { user: strong } = await makeLawyer('recommended-strong@test.uz', {
    rating: 0, reviewsCount: 0, experience: 8, isAvailable: true,
  });
  await models.LawyerDocument.create({
    userId: strong.id, type: 'license', name: 'license.pdf', path: '/private/license.pdf',
    verifiedAt: new Date(),
  });

  const implicit = await catalog();
  const explicit = await catalog('?sortBy=recommended');
  expect(implicit.body.lawyers.map((item) => item.id)).toEqual(explicit.body.lawyers.map((item) => item.id));
  expect(implicit.body.lawyers.map((item) => item.id)).toEqual([strong.id, weak.id]);
  expect(JSON.stringify(implicit.body)).not.toContain('recommendationScore');
});

test('реальный нескрытый отзыв влияет на рекомендацию, скрытый — нет', async () => {
  const { user: first } = await makeLawyer('recommended-first@test.uz', { experience: 5, isAvailable: true });
  const { user: reviewed } = await makeLawyer('recommended-reviewed@test.uz', { experience: 5, isAvailable: true });
  const client = await makeClient('recommended-client@test.uz');
  const consultation = await models.Consultation.create({ clientId: client.id, lawyerId: reviewed.id, question: 'q', status: 'completed' });
  await models.Review.create({ clientId: client.id, lawyerId: reviewed.id, consultationId: consultation.id, rating: 5, isHidden: false });

  const result = await catalog('?sortBy=recommended');
  expect(result.body.lawyers[0].id).toBe(reviewed.id);

  await models.Review.update({ isHidden: true }, { where: { consultationId: consultation.id } });
  const tied = await catalog('?sortBy=recommended');
  expect(tied.body.lawyers.map((item) => item.id)).toEqual([first.id, reviewed.id].sort());
});

test('явная сортировка по рейтингу сохранена', async () => {
  const { user: low } = await makeLawyer('recommended-low-rating@test.uz', { rating: 1, isAvailable: true });
  const { user: high } = await makeLawyer('recommended-high-rating@test.uz', { rating: 5, isAvailable: true });
  const result = await catalog('?sortBy=rating');
  expect(result.body.lawyers.map((item) => item.id)).toEqual([high.id, low.id]);
});

test('malformed legacy schedule не роняет весь каталог', async () => {
  await makeLawyer('recommended-malformed@test.uz', { schedule: ['legacy', 'value'], isAvailable: true });
  const result = await catalog('?sortBy=recommended');
  expect(result.status).toBe(200);
  expect(result.body.total).toBe(1);
});
