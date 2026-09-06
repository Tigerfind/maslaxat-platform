const { Op } = require('sequelize');
const { LawyerProfile, User } = require('../models');

/**
 * Сегменты каталога: «по карману» (цена) и «по статусу» (уровень юриста).
 *
 * Зачем отдельный модуль: и выборка, и счётчики на кнопках, и бейдж на карточке
 * должны считать уровень ОДИНАКОВО. Если развести логику по местам, каталог
 * начнёт обещать одно, а показывать другое.
 */

// ── СТАТУС ───────────────────────────────────────────────────
// Пороги подобраны так, чтобы каждая ступень реально отсекала часть каталога,
// а не была почётным званием для всех сразу.
const TOP_RATING = 4.8;
const TOP_REVIEWS = 30;
const EXPERT_EXPERIENCE = 10;
const EXPERT_REVIEWS = 20;

/**
 * Условия Sequelize для каждой ступени. Ступени взаимоисключающие: юрист
 * попадает ровно в одну, иначе счётчики не сойдутся с выдачей.
 */
const STATUS_WHERE = {
  // Топ: высокий рейтинг, подтверждённый заметным числом отзывов.
  // Одного рейтинга мало — 5.0 по единственному отзыву это не «топ».
  top: {
    rating: { [Op.gte]: TOP_RATING },
    reviewsCount: { [Op.gte]: TOP_REVIEWS },
  },
  // Эксперт: стаж или наработанная история отзывов, но ещё не топ.
  expert: {
    [Op.and]: [
      { [Op.or]: [
        { experience: { [Op.gte]: EXPERT_EXPERIENCE } },
        { reviewsCount: { [Op.gte]: EXPERT_REVIEWS } },
      ] },
      { [Op.not]: { rating: { [Op.gte]: TOP_RATING }, reviewsCount: { [Op.gte]: TOP_REVIEWS } } },
    ],
  },
  // Практик: все остальные проверенные юристы. Обычно дешевле — с них
  // разумно начинать, если бюджет ограничен.
  practitioner: {
    [Op.and]: [
      { [Op.not]: { rating: { [Op.gte]: TOP_RATING }, reviewsCount: { [Op.gte]: TOP_REVIEWS } } },
      { experience: { [Op.lt]: EXPERT_EXPERIENCE } },
      { reviewsCount: { [Op.lt]: EXPERT_REVIEWS } },
    ],
  },
};

/**
 * Ступень конкретного юриста — тем же правилом, что и фильтр.
 * @param {Object} profile LawyerProfile (или plain-объект)
 * @returns {'top'|'expert'|'practitioner'}
 */
function statusOf(profile) {
  const rating = Number(profile?.rating) || 0;
  const reviews = Number(profile?.reviewsCount) || 0;
  const experience = Number(profile?.experience) || 0;
  if (rating >= TOP_RATING && reviews >= TOP_REVIEWS) return 'top';
  if (experience >= EXPERT_EXPERIENCE || reviews >= EXPERT_REVIEWS) return 'expert';
  return 'practitioner';
}

// ── ЦЕНА ─────────────────────────────────────────────────────

/**
 * Границы ценовых сегментов по терцилям РЕАЛЬНЫХ цен каталога.
 *
 * Константы тут не годятся: «до 200 000» — это премиум на одном рынке и эконом
 * на другом. Терцили держат сегменты осмысленными при любом уровне цен.
 *
 * @returns {{p33:number,p66:number}|null} null, если цен слишком мало для деления
 */
async function priceBands() {
  const rows = await LawyerProfile.findAll({
    where: { verificationStatus: 'approved' },
    attributes: ['price'],
    include: [{
      model: User,
      as: 'user',
      attributes: [],
      where: { role: 'lawyer', isActive: true },
      required: true,
    }],
    raw: true,
  });
  const prices = rows.map((r) => Number(r.price) || 0).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const at = (q) => prices[Math.min(prices.length - 1, Math.floor(prices.length * q))];
  const p33 = at(1 / 3);
  const p66 = at(2 / 3);
  // Если цены почти одинаковые, деление на сегменты вводит в заблуждение.
  return p33 === p66 ? null : { p33, p66 };
}

/**
 * Условие по ценовому сегменту.
 * @param {'economy'|'standard'|'premium'} key
 * @param {{p33:number,p66:number}} bands
 */
function priceWhere(key, bands) {
  if (!bands) return null;
  if (key === 'economy') return { price: { [Op.lte]: bands.p33 } };
  if (key === 'standard') return { price: { [Op.gt]: bands.p33, [Op.lte]: bands.p66 } };
  if (key === 'premium') return { price: { [Op.gt]: bands.p66 } };
  return null;
}

module.exports = {
  STATUS_WHERE,
  statusOf,
  priceBands,
  priceWhere,
  thresholds: { TOP_RATING, TOP_REVIEWS, EXPERT_EXPERIENCE, EXPERT_REVIEWS },
};
