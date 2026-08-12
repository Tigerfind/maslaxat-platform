const { LawyerProfile, sequelize } = require('../models');

/**
 * Реальное число юристов по каждой специализации.
 *
 * Колонка Specialization.lawyerCount не поддерживается: сид проставляет в неё
 * литерал 1 и больше её никто не трогает. Поэтому и публичный каталог, и
 * админка считают счётчик запросом, а колонку не читают.
 *
 * @returns {Promise<Object>} { 'Гражданское право': 3, … }
 */
const getLawyerCountsBySpecialization = async () => {
  const counts = await LawyerProfile.findAll({
    attributes: ['specialization', [sequelize.fn('COUNT', sequelize.col('id')), 'cnt']],
    group: ['specialization'],
    raw: true,
  });
  const map = {};
  counts.forEach((c) => { map[c.specialization] = parseInt(c.cnt, 10) || 0; });
  return map;
};

/**
 * Дополняет список специализаций честным lawyerCount.
 * @param {Array} specializations модели Specialization
 */
const withLawyerCounts = async (specializations) => {
  const map = await getLawyerCountsBySpecialization();
  return specializations.map((s) => ({
    ...(typeof s.toJSON === 'function' ? s.toJSON() : s),
    lawyerCount: map[s.name] || 0,
  }));
};

module.exports = { getLawyerCountsBySpecialization, withLawyerCounts };
