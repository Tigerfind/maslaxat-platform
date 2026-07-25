const { Review, LawyerProfile } = require('../models');

// Пересчитывает агрегат рейтинга юриста по НЕскрытым отзывам.
// Используется при новом отзыве и при модерации (скрытие/показ).
async function recomputeLawyerRating(lawyerId) {
  const reviews = await Review.findAll({ where: { lawyerId, isHidden: false }, attributes: ['rating'] });
  const count = reviews.length;
  const rating = count ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
  await LawyerProfile.update({ rating, reviewsCount: count }, { where: { userId: lawyerId } });
  return { rating, reviewsCount: count };
}

module.exports = { recomputeLawyerRating };
