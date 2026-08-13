const { resetDb, models, makeClient, makeLawyer } = require('./helpers');
const { reconcileLawyerMetrics } = require('../src/services/ratingService');

const { Review, Consultation, LawyerProfile } = models;

beforeAll(async () => {
  await resetDb();
});

test('публичные метрики пересчитываются только из реальных записей', async () => {
  const client = await makeClient('metrics-client@test.uz');
  const { user: lawyer, lp } = await makeLawyer('metrics-lawyer@test.uz', {
    rating: 4.9,
    reviewsCount: 142,
    completedCases: 289,
  });

  const completed = await Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'q1', status: 'completed',
  });
  await Consultation.create({
    clientId: client.id, lawyerId: lawyer.id, question: 'q2', status: 'accepted',
  });
  await Review.create({
    clientId: client.id, lawyerId: lawyer.id, consultationId: completed.id, rating: 4,
  });

  await reconcileLawyerMetrics();

  await lp.reload();
  expect(lp.rating).toBe(4);
  expect(lp.reviewsCount).toBe(1);
  expect(lp.completedCases).toBe(1);
});
