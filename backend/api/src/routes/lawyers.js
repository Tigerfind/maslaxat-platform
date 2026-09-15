const router = require('express').Router();
const { Op, fn, col, literal, where: sqlWhere } = require('sequelize');
const { DateTime } = require('luxon');
const {
  sequelize, User, LawyerProfile, LawyerExperience, LawyerEducation, LawyerCertificate,
  ZoomConnection, Review, Consultation,
} = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');
const tiers = require('../services/lawyerTiers');
const presenceService = require('../services/presenceService');
const availabilityService = require('../services/availabilityService');
const { recommendedScoreSql } = require('../services/lawyerRecommendation');
const { verifiedTypesByUserIds } = require('../services/lawyerDocumentTrust');
const { responseTimesByLawyerIds } = require('../services/lawyerResponseTime');

// Пороги быстрых фильтров каталога. Держим в одном месте, чтобы подпись чипа
// («Опытные») и условие выборки не разъезжались.
const HIGH_RATING_FROM = 4.5;
const EXPERIENCED_FROM = 10;
const PUBLIC_PROFILE_ATTRIBUTES = [
  'professionalTitle', 'specialization', 'specializations', 'description', 'experience', 'price',
  'rating', 'reviewsCount', 'completedCases', 'location', 'languages',
  'region', 'linkedinUrl', 'licenseNumber', 'licenseIssuer', 'licenseIssuedAt', 'licenseExpiresAt',
  'consultationFormats', 'consultationDurations', 'durationPrices', 'timezone', 'isAvailable',
];
const CATALOG_PROFILE_ATTRIBUTES = [
  'professionalTitle', 'specialization', 'specializations', 'experience', 'price',
  'rating', 'reviewsCount', 'completedCases', 'location', 'region', 'languages',
  'education', 'consultationFormats', 'consultationDurations', 'durationPrices', 'isAvailable',
];
const PUBLIC_REVIEW_ATTRIBUTES = [
  'id', 'rating', 'text', 'replyText', 'repliedAt', 'helpfulCount', 'createdAt',
];
const PUBLIC_REVIEW_QUERY_ATTRIBUTES = [...PUBLIC_REVIEW_ATTRIBUTES, 'consultationId'];
const anonymizeReviewer = (review) => {
  const plain = review?.toJSON ? review.toJSON() : review;
  if (!plain?.client) return plain;
  const parts = String(plain.client.name || '').trim().split(/\s+/).filter(Boolean);
  const name = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : 'Клиент';
  return { ...plain, client: { name, avatar: null } };
};
const serializePublicReview = (review) => {
  const plain = anonymizeReviewer(review);
  const verifiedConsultation = Boolean(plain?.consultationId);
  if (plain) delete plain.consultationId;
  return { ...plain, verifiedConsultation };
};

/**
 * Разбирает фильтр опыта: '0-5' | '5-10' | '10-15' | '15+' | '10+'.
 * @returns {Object|null} условие Sequelize для profile.experience
 */
function parseExperienceRange(value) {
  if (!value || typeof value !== 'string') return null;
  const openEnded = value.match(/^(\d+)\+$/);
  if (openEnded) return { [Op.gte]: Number(openEnded[1]) };
  const range = value.match(/^(\d+)-(\d+)$/);
  if (range) return { [Op.gte]: Number(range[1]), [Op.lte]: Number(range[2]) };
  return null;
}

/**
 * Фасеты каталога: сколько юристов попадает под каждый быстрый фильтр и какой
 * порог считать «недорого». Порог не константа: берём нижнюю треть реальных цен,
 * иначе на дешёвом или дорогом рынке чип показывает либо всех, либо никого.
 *
 * Считается по базовому каталогу (одобренные, активные) без учёта уже выбранных
 * фильтров — чипы должны показывать, что вообще есть, а не «сколько осталось».
 */
async function catalogFacets(baseUserWhere, onlineUserIds = []) {
  const approved = { verificationStatus: 'approved' };
  const withProfile = (where) => ({
    where: baseUserWhere,
    include: [{ model: LawyerProfile, as: 'profile', where: { ...approved, ...where }, required: true }],
  });

  const prices = await LawyerProfile.findAll({
    where: approved,
    attributes: ['price'],
    include: [{
      model: User,
      as: 'user',
      attributes: [],
      where: baseUserWhere,
      required: true,
    }],
    raw: true,
  });
  const sorted = prices.map((p) => Number(p.price) || 0).filter((p) => p > 0).sort((a, b) => a - b);
  // 33-й перцентиль; при пустом каталоге порога нет — чип будет отключён.
  const budgetThreshold = sorted.length ? sorted[Math.max(0, Math.floor(sorted.length / 3) - (sorted.length % 3 === 0 ? 1 : 0))] : null;

  const [total, online, highRating, experienced, budget] = await Promise.all([
    User.count(withProfile({})),
    onlineUserIds.length
      ? User.count({ ...withProfile({}), where: { ...baseUserWhere, id: { [Op.in]: onlineUserIds } } })
      : 0,
    User.count(withProfile({ rating: { [Op.gte]: HIGH_RATING_FROM } })),
    User.count(withProfile({ experience: { [Op.gte]: EXPERIENCED_FROM } })),
    budgetThreshold ? User.count(withProfile({ price: { [Op.lte]: budgetThreshold } })) : 0,
  ]);

  // Подбор «по карману» и «по статусу»: клиенту нужно видеть не только названия
  // сегментов, но и границы цен и сколько юристов в каждом — иначе выбор вслепую.
  const bands = await tiers.priceBands();
  const priceSegments = bands ? await Promise.all(
    ['economy', 'standard', 'premium'].map(async (key) => ({
      key,
      from: key === 'economy' ? null : (key === 'standard' ? bands.p33 : bands.p66),
      to: key === 'premium' ? null : (key === 'economy' ? bands.p33 : bands.p66),
      count: await User.count(withProfile(tiers.priceWhere(key, bands))),
    })),
  ) : [];

  const statusSegments = await Promise.all(
    ['top', 'expert', 'practitioner'].map(async (key) => ({
      key,
      count: await User.count(withProfile(tiers.STATUS_WHERE[key])),
    })),
  );

  // «Доступен сейчас»: живое соединение ИЛИ рабочее время юриста. Одного
  // socket-присутствия мало — юрист, не держащий вкладку открытой, всё равно
  // принимает записи, и клиенту важно именно это.
  const openNowProfiles = await LawyerProfile.findAll({
    where: { ...approved, isAvailable: true },
    attributes: ['userId', 'schedule', 'timezone'],
  });
  const onlineSet = new Set(onlineUserIds);
  const availableNowIds = openNowProfiles
    .filter((p) => onlineSet.has(p.userId) || isWithinWorkingHours(p))
    .map((p) => p.userId);
  const availableNow = availableNowIds.length
    ? await User.count({ ...withProfile({}), where: { ...baseUserWhere, id: { [Op.in]: availableNowIds } } })
    : 0;

  // Английский язык — рабочий фильтр для юридического рынка (бизнес, ВЭД,
  // иностранные клиенты). Показываем его как замену рейтингу, пока оценок
  // нет ни у кого: мёртвый чип «Высокий рейтинг» выбрать никого не может.
  const withEnglish = await User.count(withProfile({
    languages: { [Op.overlap]: ['Английский', 'English', 'en'] },
  }));

  // Есть ли в каталоге хоть одна оценка. Пока нет — фильтр по рейтингу
  // бессмысленен, и фронт покажет вместо него работающий чип.
  const ratedCount = await User.count(withProfile({ rating: { [Op.gt]: 0 } }));

  return {
    total,
    online,
    availableNow,
    hasRatings: ratedCount > 0,
    english: { count: withEnglish },
    highRating: { from: HIGH_RATING_FROM, count: highRating },
    experienced: { from: EXPERIENCED_FROM, count: experienced },
    budget: { maxPrice: budgetThreshold, count: budget },
    priceSegments,
    statusSegments,
    statusRules: tiers.thresholds,
  };
}

// Юрист «доступен сейчас», если принимает записи и текущее время попадает в его
// часы приёма. Раньше чип «Онлайн сейчас» опирался только на живое
// socket-соединение — для юриста, который просто не держит вкладку открытой,
// это всегда ноль, и фильтр был мёртвым по построению.
const DAY_KEYS_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function isWithinWorkingHours(profile, now = DateTime.now()) {
  const schedule = profile?.schedule;
  if (!schedule || typeof schedule !== 'object') return false;
  const zone = profile.timezone || 'Asia/Tashkent';
  const local = now.setZone(zone);
  const day = schedule[DAY_KEYS_SHORT[local.weekday - 1]];
  if (!day?.enabled || !day.from || !day.to) return false;
  const [fh, fm] = String(day.from).split(':').map(Number);
  const [th, tm] = String(day.to).split(':').map(Number);
  const minutes = local.hour * 60 + local.minute;
  return minutes >= (fh * 60 + fm) && minutes < (th * 60 + tm);
}

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { specialization, search, minRating, minExperience, sortBy, location, language, minPrice, maxPrice, onlineOnly, availableNow, availableOnly, zoomAvailable, experience, budget, status, page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const offset = (pageNumber - 1) * limitNumber;

    const profileWhere = {};
    const addProfileCondition = (condition) => {
      profileWhere[Op.and] = [...(profileWhere[Op.and] || []), condition];
    };
    // Фильтр по специализации: клиент может выбрать НЕСКОЛЬКО областей (через запятую).
    // Юрист подходит, если ведёт ХОТЯ БЫ ОДНУ из выбранных (Op.overlap = массивы пересекаются).
    if (specialization) {
      const specs = String(specialization).split(',').map((s) => s.trim()).filter(Boolean);
      if (specs.length) profileWhere.specializations = { [Op.overlap]: specs };
    }
    if (location) profileWhere.location = location;
    // Фильтр по цене консультации (profile.price).
    const priceFilter = {};
    if (minPrice !== undefined && !Number.isNaN(Number(minPrice))) priceFilter[Op.gte] = Number(minPrice);
    if (maxPrice !== undefined && !Number.isNaN(Number(maxPrice))) priceFilter[Op.lte] = Number(maxPrice);
    if (Object.getOwnPropertySymbols(priceFilter).length) profileWhere.price = priceFilter;
    // languages — JSONB-массив; фильтруем по вхождению языка (Postgres @>)
    if (language) profileWhere.languages = { [Op.contains]: [language] };
    // Минимальный рейтинг — именно МИНИМУМ (>=), как и написано на фильтре.
    //
    // Было две проблемы. Во-первых, `if (minRating)` пропускало строку "0",
    // которую фронт шлёт по умолчанию, и каталог фильтровался по диапазону
    // −0.5…0.5 — то есть был пуст у всех клиентов. Во-вторых, прежняя логика
    // «корзины звёзд» (4★ = 3.5–4.49) прятала юриста с рейтингом 4.9 при выборе
    // «от 4 звёзд», что противоречит подписи фильтра.
    const ratingFrom = parseFloat(minRating);
    if (Number.isFinite(ratingFrom) && ratingFrom > 0) {
      profileWhere.rating = { [Op.gte]: ratingFrom };
    }

    // Опыт: '0-5' | '5-10' | '10-15' | '15+' | '10+'. Раньше параметр не читался
    // вообще — пилюли «Опыт» в сайдбаре были декоративными.
    const expRange = parseExperienceRange(experience);
    if (expRange) profileWhere.experience = expRange;
    if (!expRange && Number.isFinite(Number(minExperience)) && Number(minExperience) >= 0) {
      profileWhere.experience = { [Op.gte]: Number(minExperience) };
    }
    if (availableOnly === 'true' || availableOnly === true) profileWhere.isAvailable = true;
    if (zoomAvailable === 'true' || zoomAvailable === true) {
      profileWhere.consultationFormats = { [Op.contains]: ['zoom'] };
    }

    // Подбор «по карману»: сегмент цены считается от терцилей реальных цен
    // каталога, а не от константы.
    const bands = await tiers.priceBands();
    const bandWhere = tiers.priceWhere(budget, bands);
    if (bandWhere) addProfileCondition(bandWhere);

    // Подбор «по статусу»: ступень юриста (топ / эксперт / практик).
    if (tiers.STATUS_WHERE[status]) addProfileCondition(tiers.STATUS_WHERE[status]);

    // Безопасный режим: в каталоге показываем ТОЛЬКО одобренных админом юристов.
    // Непроверенные (pending) и отклонённые (rejected) клиентам не видны.
    profileWhere.verificationStatus = 'approved';

    // «Онлайн»: только юристы с активным authenticated socket.
    const onlyOnline = onlineOnly === 'true' || onlineOnly === true;

    const userWhere = { role: 'lawyer', isActive: true };
    const presenceSnapshot = await presenceService.getSnapshot('lawyer');
    const { onlineUserIds } = presenceSnapshot;
    if (onlyOnline && presenceSnapshot.degraded) {
      return res.status(503).json({ error: 'Статус онлайн временно недоступен' });
    }
    if (onlyOnline) userWhere.id = { [Op.in]: onlineUserIds.length ? onlineUserIds : [null] };

    // «Доступен сейчас» — принимает записи И сейчас его рабочее время (или он
    // реально в сети). Чисто socket-присутствие для этого не годится: юрист,
    // не держащий вкладку открытой, всё равно принимает записи.
    // Считаем в приложении: расписание — JSONB со своим часовым поясом.
    const wantAvailableNow = availableNow === 'true' || availableNow === true;
    if (wantAvailableNow) {
      const candidates = await LawyerProfile.findAll({
        where: { verificationStatus: 'approved', isAvailable: true },
        attributes: ['userId', 'schedule', 'timezone'],
      });
      const onlineSet = new Set(onlineUserIds);
      const ids = candidates
        .filter((p) => onlineSet.has(p.userId) || isWithinWorkingHours(p))
        .map((p) => p.userId);
      userWhere.id = { [Op.in]: ids.length ? ids : [null] };
    }
    const searchTerm = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    if (searchTerm) {
      const escapedTerm = searchTerm.replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escapedTerm}%`;
      profileWhere[Op.or] = [
        { specialization: { [Op.iLike]: pattern } },
        { professionalTitle: { [Op.iLike]: pattern } },
        sqlWhere(fn('array_to_string', col('profile.specializations'), ' '), { [Op.iLike]: pattern }),
        sqlWhere(col('User.name'), { [Op.iLike]: pattern }),
      ];
    }

    // Онлайн и доступность остаются первыми операционными сигналами. Внутри них
    // рекомендуем по проверяемому качеству, а не по нулевому рейтингу/случайной дате.
    const onlineFirst = onlineUserIds.length
      ? [[literal(`CASE WHEN "User"."id" IN (${onlineUserIds.map((id) => sequelize.escape(id)).join(',')}) THEN 0 ELSE 1 END`), 'ASC']]
      : [];
    const acceptingBookingsFirst = [[{ model: LawyerProfile, as: 'profile' }, 'isAvailable', 'DESC']];
    const orderPrefix = [...onlineFirst, ...acceptingBookingsFirst];
    let order = [...orderPrefix, [literal(recommendedScoreSql()), 'DESC']];
    if (sortBy === 'recommended') order = [...orderPrefix, [literal(recommendedScoreSql()), 'DESC']];
    if (sortBy === 'rating') order = [...orderPrefix, [{ model: LawyerProfile, as: 'profile' }, 'rating', 'DESC']];
    if (sortBy === 'price_low') order = [...orderPrefix, [{ model: LawyerProfile, as: 'profile' }, 'price', 'ASC']];
    if (sortBy === 'price_high') order = [...orderPrefix, [{ model: LawyerProfile, as: 'profile' }, 'price', 'DESC']];
    if (sortBy === 'experience') order = [...orderPrefix, [{ model: LawyerProfile, as: 'profile' }, 'experience', 'DESC']];
    order.push(['id', 'ASC']);

    // Never expose phone/email of lawyers to public/client searches
    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      attributes: ['id', 'name', 'avatar', 'role'],
      include: [{
        model: LawyerProfile,
        as: 'profile',
        attributes: CATALOG_PROFILE_ATTRIBUTES,
        where: profileWhere,
        required: true,
      }, {
        model: ZoomConnection,
        as: 'zoomConnection',
        attributes: ['id'],
        where: { status: 'connected' },
        required: zoomAvailable === 'true' || zoomAvailable === true,
      }],
      order,
      distinct: true,
      limit: limitNumber,
      offset,
    });

    // Фасеты нужны фронту, чтобы показать числа на чипах, отключить заведомо
    // пустые и взять порог «недорого» из реальных цен, а не из константы.
    const facets = await catalogFacets({ role: 'lawyer', isActive: true }, onlineUserIds);

    // Ступень считаем тем же правилом, что и фильтр: карточка и фильтр не должны
    // расходиться в том, кто «топ».
    const documentTypes = await verifiedTypesByUserIds(rows.map((user) => user.id));
    const responseTimes = await responseTimesByLawyerIds(rows.map((user) => user.id));
    const lawyers = rows.map((u) => {
      // User.toJSON копирует поля поверхностно, поэтому profile остаётся моделью
      // Sequelize: дописанное в неё поле терялось бы при сериализации ответа.
      const plain = u.toJSON();
      const profile = plain.profile && typeof plain.profile.toJSON === 'function'
        ? plain.profile.toJSON()
        : plain.profile;
      const hasZoom = Boolean(plain.zoomConnection);
      delete plain.zoomConnection;
      if (profile) plain.profile = {
        ...profile,
        status: tiers.statusOf(profile),
        zoomAvailable: hasZoom,
        consultationFormats: (profile.consultationFormats || []).filter((format) => format !== 'zoom' || hasZoom),
        verifiedDocumentTypes: documentTypes.get(u.id) || [],
        medianResponseMinutes: responseTimes.get(u.id),
      };
      plain.presence = presenceService.getPresenceFromSnapshot(u.id, presenceSnapshot);
      return plain;
    });

    res.json({
      lawyers,
      total: count,
      page: pageNumber,
      totalPages: Math.ceil(count / limitNumber),
      facets,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyers/filter-options — списки городов и языков для фильтров.
// ВАЖНО: объявлено ВЫШЕ '/:id', иначе 'filter-options' попадёт в параметр :id.
router.get('/filter-options', async (req, res, next) => {
  try {
    const profiles = await LawyerProfile.findAll({
      where: { verificationStatus: 'approved' },
      attributes: ['location', 'languages'],
      include: [{
        model: User,
        as: 'user',
        attributes: [],
        where: { role: 'lawyer', isActive: true },
        required: true,
      }],
      raw: true,
    });
    const locations = [...new Set(profiles.map((p) => p.location).filter(Boolean))].sort();
    const langSet = new Set();
    profiles.forEach((p) => (Array.isArray(p.languages) ? p.languages : []).forEach((l) => l && langSet.add(l)));
    res.json({ locations, languages: [...langSet].sort() });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/available-slots', async (req, res, next) => {
  try {
    return res.json(await availabilityService.listAvailableSlots(req.params.id, req.query));
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
});

// GET /api/lawyers/:id — профиль юриста
router.get('/:id', async (req, res, next) => {
  try {
    // Never expose phone/email to public profile viewers
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer', isActive: true },
      attributes: ['id', 'name', 'avatar', 'role'],
      include: [
        {
          model: LawyerProfile,
          as: 'profile',
          attributes: PUBLIC_PROFILE_ATTRIBUTES,
          where: { verificationStatus: 'approved' },
          required: true,
        },
        { model: LawyerExperience, as: 'lawyerExperiences', attributes: ['id', 'organization', 'position', 'startDate', 'endDate', 'isCurrent', 'description'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerEducation, as: 'lawyerEducations', attributes: ['id', 'university', 'faculty', 'specialty', 'degree', 'startYear', 'endYear', 'country', 'city'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerCertificate, as: 'lawyerCertificates', attributes: ['id', 'title', 'organization', 'issuedAt', 'credentialUrl'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: ZoomConnection, as: 'zoomConnection', attributes: ['id'], where: { status: 'connected' }, required: false },
        {
          model: Review,
          as: 'receivedReviews',
          attributes: PUBLIC_REVIEW_QUERY_ATTRIBUTES,
          where: { isHidden: false },
          required: false,
          include: [{ model: User, as: 'client', attributes: ['name'] }],
          order: [['createdAt', 'DESC']],
          limit: 20,
        },
      ],
    });

    // Безопасный режим: непроверенный/отклонённый профиль публично не показываем
    // (иначе клиент дошёл бы до него по прямой ссылке минуя каталог).
    if (!lawyer || !lawyer.profile) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    const plainLawyer = lawyer.toJSON();
    plainLawyer.receivedReviews = (plainLawyer.receivedReviews || []).map(serializePublicReview);
    const plainProfile = plainLawyer.profile && typeof plainLawyer.profile.toJSON === 'function'
      ? plainLawyer.profile.toJSON()
      : plainLawyer.profile;
    const hasZoom = Boolean(plainLawyer.zoomConnection);
    delete plainLawyer.zoomConnection;
    const documentTypes = await verifiedTypesByUserIds([lawyer.id]);
    const responseTimes = await responseTimesByLawyerIds([lawyer.id]);
    plainLawyer.profile = {
      ...plainProfile,
      zoomAvailable: hasZoom,
      consultationFormats: (plainProfile.consultationFormats || []).filter((format) => format !== 'zoom' || hasZoom),
      verifiedDocumentTypes: documentTypes.get(lawyer.id) || [],
      medianResponseMinutes: responseTimes.get(lawyer.id),
      isVerifiedLawyer: true,
    };
    const presenceSnapshot = await presenceService.getSnapshot('lawyer');
    plainLawyer.presence = presenceService.getPresenceFromSnapshot(lawyer.id, presenceSnapshot);
    res.json({ lawyer: plainLawyer });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyers/:id/reviews — отзывы конкретного юриста
router.get('/:id/reviews', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 6));
    const sort = req.query.sort === 'helpful' ? 'helpful' : 'newest';
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer', isActive: true },
      attributes: ['id'],
      include: [{ model: LawyerProfile, as: 'profile', attributes: ['rating', 'reviewsCount'], where: { verificationStatus: 'approved' }, required: true }],
    });
    if (!lawyer) return res.status(404).json({ error: 'Юрист не найден' });

    const { count, rows } = await Review.findAndCountAll({
      where: { lawyerId: req.params.id, isHidden: false },
      attributes: PUBLIC_REVIEW_QUERY_ATTRIBUTES,
      include: [{ model: User, as: 'client', attributes: ['name'] }],
      order: sort === 'helpful'
        ? [['helpfulCount', 'DESC'], ['createdAt', 'DESC'], ['id', 'ASC']]
        : [['createdAt', 'DESC'], ['id', 'ASC']],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
    });
    const distributionRows = await Review.findAll({
      where: { lawyerId: req.params.id, isHidden: false },
      attributes: ['rating', [fn('COUNT', col('id')), 'count']],
      group: ['rating'],
      raw: true,
    });
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distributionRows.forEach((item) => { distribution[Math.round(Number(item.rating))] = Number(item.count); });
    const reviewsCount = Object.values(distribution).reduce((sum, value) => sum + value, 0);
    const rating = reviewsCount
      ? Object.entries(distribution).reduce((sum, [stars, value]) => sum + Number(stars) * value, 0) / reviewsCount
      : 0;
    return res.json({
      reviews: rows.map(serializePublicReview),
      page,
      limit,
      total: count,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      sort,
      summary: {
        rating: Number(rating.toFixed(2)),
        reviewsCount,
        distribution,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/lawyers/:id/book — бронирование консультации
router.post('/:id/book', authenticate, authorize('client'), async (req, res, next) => {
  try {
    if (req.body.acceptedTerms !== true || req.body.legalVersion !== '2026-08-13') {
      return res.status(400).json({ error: 'Примите условия бронирования и возврата' });
    }
    // Анти-фрод: бронировать может только клиент с подтверждённым контактом
    // (email подтверждён ИЛИ регистрация по телефону-OTP → isVerified=true).
    // Отсекает фейковые аккаунты и пустые брони под модель оплаты B.
    const client = await User.findByPk(req.userId, { attributes: ['id', 'isVerified'] });
    if (!client || !client.isVerified) {
      return res.status(403).json({ error: 'Подтвердите email или телефон, чтобы бронировать', code: 'CONTACT_UNVERIFIED' });
    }

    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer', isActive: true },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }
    // Нельзя бронировать непроверенного или недоступного (offline) юриста
    if (!lawyer.profile || lawyer.profile.verificationStatus !== 'approved') {
      return res.status(400).json({ error: 'Этот юрист ещё не прошёл проверку' });
    }
    if (!lawyer.profile || lawyer.profile.isAvailable === false) {
      return res.status(400).json({ error: 'Юрист сейчас недоступен для записи' });
    }

    // Длительность (30/60/90 мин) масштабирует цену — считаем на сервере так же,
    // как показывает UI (base * duration / 60). Клиентской сумме не доверяем.
    const ALLOWED_DURATIONS = lawyer.profile.consultationDurations?.length
      ? lawyer.profile.consultationDurations : [30, 60, 90];
    let duration = parseInt(req.body.duration, 10);
    if (req.body.duration === undefined) duration = 60;
    if (!ALLOWED_DURATIONS.includes(duration)) return res.status(400).json({ error: 'Недопустимая длительность консультации' });

    // Валидация формата даты/времени, если переданы (как в reschedule) — иначе
    // мусорные значения молча игнорировались напоминаниями/календарём.
    const { preferredDate, preferredTime } = req.body;
    if (Boolean(preferredDate) !== Boolean(preferredTime)) return res.status(400).json({ error: 'Укажите и дату, и время консультации' });
    if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
      return res.status(400).json({ error: 'Неверный формат даты (YYYY-MM-DD)' });
    }
    if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
      return res.status(400).json({ error: 'Неверный формат времени (HH:mm)' });
    }

    let scheduledWindow = null;
    if (preferredDate && preferredTime) {
      try {
        scheduledWindow = availabilityService.validateWindow(lawyer.profile, preferredDate, preferredTime, duration);
      } catch (error) {
        return res.status(error.status || 400).json({ error: error.message, code: error.code, minLeadMinutes: error.minLeadMinutes });
      }
    }

    // Мультизапрос: список проблем в одной записи, у КАЖДОЙ своя категория права.
    // Каждая проблема → { text, category }. Принимаем и объекты (новый фронт), и строки
    // (legacy / старое одиночное question). question = текст первой (резюме для списков).
    const rawProblems = Array.isArray(req.body.problems)
      ? req.body.problems
      : (req.body.question ? [req.body.question] : []);
    const cleanCat = (c) => (typeof c === 'string' && c.trim() ? c.trim().slice(0, 50) : null);
    const problems = rawProblems
      .map((p) => {
        if (typeof p === 'string') return { text: p.trim(), categories: [] };
        if (p && typeof p === 'object') {
          const text = String(p.text || '').trim();
          // Новый формат: categories[]. Старый: одиночный category. Дедуп + макс 8.
          const raw = Array.isArray(p.categories)
            ? p.categories
            : (p.category != null ? [p.category] : []);
          const categories = [...new Set(raw.map(cleanCat).filter(Boolean))].slice(0, 8);
          return { text, categories };
        }
        return { text: '', categories: [] };
      })
      .filter((p) => p.text)
      .slice(0, 10);
    if (problems.length === 0) {
      return res.status(400).json({ error: 'Опишите хотя бы одну проблему' });
    }

    // Право на скидку/бесплатное ВСЕГДА пересчитываем на сервере (клиентскому флагу
    // не доверяем). Базовая (платная) цена — по длительности.
    const fullPrice = Math.round((lawyer.profile.price * duration) / 60);
    const requestedFormat = req.body.consultationType || 'webrtc';
    if (!['chat', 'audio', 'webrtc', 'video', 'zoom'].includes(requestedFormat)) return res.status(400).json({ error: 'Некорректный формат консультации' });
    const normalizedFormat = requestedFormat === 'video' ? 'webrtc' : requestedFormat;
    if (['zoom', 'webrtc', 'audio'].includes(normalizedFormat) && !scheduledWindow) return res.status(400).json({ error: 'Для звонка выберите свободное время' });
    if (!lawyer.profile.consultationFormats?.includes(normalizedFormat)) return res.status(400).json({ error: 'Юрист не поддерживает выбранный формат' });
    const assertZoomConnected = async (transaction) => {
      if (normalizedFormat !== 'zoom') return;
      await availabilityService.lockZoomConnection(lawyer.id, transaction);
      const zoom = await ZoomConnection.findOne({
        where: { userId: lawyer.id, status: 'connected' }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!zoom) throw availabilityService.slotError('ZOOM_NOT_CONNECTED', 'Zoom юриста не подключён', 409);
    };
    const baseFields = {
      clientId: req.userId,
      lawyerId: lawyer.id,
      type: normalizedFormat === 'chat' ? 'chat' : normalizedFormat === 'audio' ? 'phone' : 'video',
      meetingProvider: normalizedFormat === 'zoom' ? 'zoom' : normalizedFormat === 'webrtc' ? 'webrtc' : 'none',
      question: problems[0].text,
      problems,
      // Основная категория записи = первая категория первой проблемы (для фильтров/списков).
      specialization: problems[0].categories[0] || null,
      description: req.body.description,
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      duration,
      scheduledStartAt: scheduledWindow?.start.toJSDate() || null,
      scheduledEndAt: scheduledWindow?.end.toJSDate() || null,
      scheduleTimezone: scheduledWindow?.timezone || null,
      legalAcceptedAt: new Date(),
      legalVersion: req.body.legalVersion,
    };

    let price = fullPrice;
    let notes = req.body.notes || null;
    let appliedPromo = null;

    const wantsFree = Boolean(req.body.useFreePromo || req.body.useSubscriptionFree);
    let isFree = false;
    let freeSource = null;
    let consultation;

    // Все платные форматы используют один prepayment-flow. До подтверждения оплаты
    // заявка резервирует слот, но не показывается юристу как новая работа.
    const paidFields = () => ({
      ...baseFields, price, isFree: price === 0, freeSource: null, notes,
      promoCode: appliedPromo ? appliedPromo.code : null,
      promoReservedAt: appliedPromo ? new Date() : null,
      status: price > 0 ? 'payment_pending' : 'pending',
      lifecycleStatus: price > 0 ? 'pending_payment' : 'confirmed',
      billingStatus: 'none',
      paymentExpiresAt: price > 0 ? new Date(Date.now() + availabilityService.PAYMENT_RESERVATION_MINUTES * 60000) : null,
    });

    if (!wantsFree) {
      await Consultation.sequelize.transaction(async (transaction) => {
        await availabilityService.lockBookingParticipants(lawyer.id, req.userId, transaction);
        await assertZoomConnected(transaction);
        if (scheduledWindow) await availabilityService.assertAvailable({ lawyerId: lawyer.id, clientId: req.userId, window: scheduledWindow, transaction });
        if (req.body.promoCode) {
          const { reservePromo } = require('../services/promoService');
          const result = await reservePromo(req.body.promoCode, fullPrice, transaction);
          if (result.valid) {
            price = Math.max(0, fullPrice - result.discountAmount);
            appliedPromo = result.promo;
            notes = `Промокод ${result.code} (−${result.discountPercent}%)${notes ? '. ' + notes : ''}`;
          }
        }
        consultation = await Consultation.create(paidFields(), { transaction });
      });
    } else {
      // ГОНКА #3: право на бесплатное пересчитываем и создаём бронь ПОД per-client
      // advisory-локом в одной транзакции. Лок сериализует брони ТОЛЬКО этого клиента
      // (не все) — второй параллельный запрос дождётся коммита, увидит used++ и уйдёт
      // в платный путь. Частичный уникальный индекс consultations_loyalty_free_unique —
      // hard-гарантия для loyalty (defense-in-depth).
      try {
        await Consultation.sequelize.transaction(async (t) => {
          await availabilityService.lockBookingParticipants(lawyer.id, req.userId, t);
          await assertZoomConnected(t);
          if (scheduledWindow) await availabilityService.assertAvailable({ lawyerId: lawyer.id, clientId: req.userId, window: scheduledWindow, transaction: t });
          let fields = paidFields(); // если право не подтвердится под локом — платно
          if (req.body.useFreePromo) {
            const { computeLoyalty } = require('../services/loyaltyService');
            const loyalty = await computeLoyalty(req.userId, { transaction: t });
            if (loyalty.freeNow) {
              isFree = true; freeSource = 'loyalty';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'loyalty', promoCode: null, status: 'pending', lifecycleStatus: 'confirmed', billingStatus: 'none', notes: 'Бесплатно по акции «первая консультация бесплатно»' };
            }
          } else if (req.body.useSubscriptionFree) {
            const { computeSubscriptionBenefit } = require('../services/subscriptionService');
            const benefit = await computeSubscriptionBenefit(req.userId, { transaction: t });
            if (benefit.remaining > 0) {
              isFree = true; freeSource = 'subscription';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'subscription', promoCode: null, status: 'pending', lifecycleStatus: 'confirmed', billingStatus: 'none', notes: `Бесплатно по подписке «${benefit.plan === 'pro' ? 'Про' : 'Базовый'}»` };
            }
          }
          consultation = await Consultation.create(fields, { transaction: t });
        });
      } catch (e) {
        // Защита в глубину: если частичный уникальный индекс поймал вторую loyalty-бронь
        // (лок не спас в экзотическом случае) — бронируем как ПЛАТНУЮ, не роняем запрос.
        if (e.name === 'SequelizeUniqueConstraintError') {
          isFree = false; freeSource = null;
          await Consultation.sequelize.transaction(async (transaction) => {
            await availabilityService.lockBookingParticipants(lawyer.id, req.userId, transaction);
            await assertZoomConnected(transaction);
            if (scheduledWindow) await availabilityService.assertAvailable({ lawyerId: lawyer.id, clientId: req.userId, window: scheduledWindow, transaction });
            consultation = await Consultation.create(paidFields(), { transaction });
          });
        } else {
          throw e;
        }
      }
    }

    // Платная заявка станет видна юристу и отправит уведомление только после оплаты.
    if (consultation.status === 'pending') {
      const client = await User.findByPk(req.userId, { attributes: ['name'] });
      notifications.notifyNewBooking(lawyer.id, client?.name || 'Клиент', consultation);
    }

    res.status(201).json({
      success: true,
      message: 'Запрос отправлен юристу',
      requiresPayment: consultation.status === 'payment_pending',
      consultation,
    });
  } catch (err) {
    if (err.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ error: err.message, code: err.code });
    next(err);
  }
});

// POST /api/lawyers/:id/review — оставить отзыв
router.post('/:id/review', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const { consultationId, rating, text } = req.body;
    const lawyerId = req.params.id;

    // Валидация оценки
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return res.status(400).json({ error: 'Оценка должна быть от 1 до 5' });
    }
    if (!consultationId) {
      return res.status(400).json({ error: 'Не указана консультация' });
    }

    // БЕЗОПАСНОСТЬ: отзыв — только по СВОЕЙ завершённой консультации с этим юристом
    const consultation = await Consultation.findByPk(consultationId);
    if (!consultation || consultation.clientId !== req.userId || consultation.lawyerId !== lawyerId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }
    if (consultation.status !== 'completed') {
      return res.status(400).json({ error: 'Оценить можно только завершённую консультацию' });
    }
    if (consultation.archivedAt) {
      return res.status(409).json({ error: 'Верните консультацию из архива, чтобы оставить отзыв' });
    }

    // Один отзыв на консультацию. Уникальный индекс reviews_consultation_id_unique
    // делает findOrCreate атомарным: под конкуренцией проигравший INSERT ловит
    // unique-violation — отдаём чистый 409, а не 500.
    let review;
    let created;
    try {
      [review, created] = await Review.findOrCreate({
        where: { consultationId },
        defaults: { clientId: req.userId, lawyerId, consultationId, rating: r, text },
      });
    } catch (e) {
      if (e.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ error: 'Вы уже оценили эту консультацию' });
      }
      throw e;
    }
    if (!created) {
      return res.status(409).json({ error: 'Вы уже оценили эту консультацию' });
    }

    // Пересчёт агрегата рейтинга юриста (по нескрытым отзывам)
    await recomputeLawyerRating(lawyerId);

    // Уведомляем юриста о новом отзыве
    const reviewer = await User.findByPk(req.userId, { attributes: ['name'] });
    notifications.notifyNewReview(lawyerId, reviewer?.name || 'Клиент', r);

    res.status(201).json({ review });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
