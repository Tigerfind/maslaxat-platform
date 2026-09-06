const { fn, col } = require('sequelize');
const { sequelize, Review, Consultation, LawyerProfile } = require('../models');

// Пересчитывает агрегат рейтинга юриста по НЕскрытым отзывам.
// Используется при новом отзыве и при модерации (скрытие/показ).
async function recomputeLawyerRating(lawyerId) {
  const reviews = await Review.findAll({ where: { lawyerId, isHidden: false }, attributes: ['rating'] });
  const count = reviews.length;
  const rating = count ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
  await LawyerProfile.update({ rating, reviewsCount: count }, { where: { userId: lawyerId } });
  return { rating, reviewsCount: count };
}

// Восстанавливает публичные агрегаты из фактических записей. Это не даёт старым
// сидам или ручным правкам показывать клиентам несуществующие отзывы и дела.
async function reconcileLawyerMetrics() {
  const [profiles, reviewRows, consultationRows] = await Promise.all([
    LawyerProfile.findAll({ attributes: ['userId'], raw: true }),
    Review.findAll({
      where: { isHidden: false },
      attributes: ['lawyerId', [fn('COUNT', col('id')), 'count'], [fn('AVG', col('rating')), 'rating']],
      group: ['lawyerId'],
      raw: true,
    }),
    Consultation.findAll({
      where: { status: 'completed' },
      attributes: ['lawyerId', [fn('COUNT', col('id')), 'count']],
      group: ['lawyerId'],
      raw: true,
    }),
  ]);

  const reviewsByLawyer = new Map(reviewRows.map((row) => [row.lawyerId, row]));
  const casesByLawyer = new Map(consultationRows.map((row) => [row.lawyerId, Number(row.count)]));

  await sequelize.transaction(async (transaction) => {
    // Одна транзакция использует одно pg-соединение: запросы должны идти
    // последовательно, иначе pg предупреждает о concurrent client.query().
    for (const { userId } of profiles) {
      const reviews = reviewsByLawyer.get(userId);
      const rating = reviews ? Math.round(Number(reviews.rating) * 10) / 10 : 0;
      await LawyerProfile.update({
        rating,
        reviewsCount: reviews ? Number(reviews.count) : 0,
        completedCases: casesByLawyer.get(userId) || 0,
      }, { where: { userId }, transaction });
    }
  });

  return { profiles: profiles.length };
}

module.exports = { recomputeLawyerRating, reconcileLawyerMetrics };
