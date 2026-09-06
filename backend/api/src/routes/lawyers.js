const router = require('express').Router();
const { Op, fn, col, literal, where: sqlWhere } = require('sequelize');
const { DateTime } = require('luxon');
const {
  sequelize, User, LawyerProfile, LawyerExperience, LawyerEducation, LawyerCertificate,
  ZoomConnection, Review, Consultation, Payment, LawyerPromotion,
} = require('../models');
const {
  authenticate, authorize, authorizeCompat, evaluateAuthorizationDecision,
} = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');
const tiers = require('../services/lawyerTiers');
const presenceService = require('../services/presenceService');
const availabilityService = require('../services/availabilityService');
const { recommendedScoreSql } = require('../services/lawyerRecommendation');
const { verifiedTypesByUserIds } = require('../services/lawyerDocumentTrust');
const { responseTimesByLawyerIds } = require('../services/lawyerResponseTime');
const { createCheckout, checkoutIdempotencyCandidates } = require('../services/paymentService');
const { buildBookingFingerprint } = require('../services/bookingFingerprintService');
const { recordPromotionEvent } = require('../services/promotionAnalyticsService');
const { resolveCatalogActor } = require('../services/catalogActorService');
const { toPublicLawyerDto } = require('../services/publicLawyerDto');
const { getAuthorizationMode, recordAuthorizationDecision } = require('../services/authorizationRuntime');
const { resolveCatalogAuthorizationSurface } = require('../config/authorizationSurfaces');
const { getCatalogPage, getCatalogEligibilityCandidates } = require('../services/catalogRankingService');

const clientAccess = authorizeCompat({
  legacyRoles: ['client', 'lawyer'], capability: 'client', telemetryName: 'http.client',
});

async function shadowCatalogEligibility(users, surface) {
  for (const user of users) {
    const legacyAllowed = user.role === 'lawyer' && user.isActive
      && user.profile?.verificationStatus === 'approved';
    const capabilityAllowed = user.accountType === 'member' && user.isActive
      && user.twoFactorEnabled && user.profile?.verificationStatus === 'approved'
      && user.profile?.operatingStatus === 'enabled';
    await evaluateAuthorizationDecision({
      authorizationMode: getAuthorizationMode(), channel: 'catalog', surface, mode: 'lawyer',
      legacyAllowed, capabilityAllowed, recordDecision: recordAuthorizationDecision,
      compatibilityAuthority: 'legacy',
    });
  }
}

async function catalogLawyerAllowed(user, surface, { requireOperating = true } = {}) {
  if (!user) return false;
  const legacyAllowed = user.role === 'lawyer' && user.isActive
    && (!requireOperating || (user.profile?.verificationStatus === 'approved'
      && user.profile?.operatingStatus === 'enabled'));
  const capabilityAllowed = user.accountType === 'member' && user.isActive
    && user.twoFactorEnabled && user.profile?.verificationStatus === 'approved'
    && user.profile?.operatingStatus === 'enabled';
  const decision = await evaluateAuthorizationDecision({
    authorizationMode: getAuthorizationMode(), channel: 'catalog', surface, mode: 'lawyer',
    legacyAllowed, capabilityAllowed, recordDecision: recordAuthorizationDecision,
    compatibilityAuthority: 'legacy',
  });
  return decision.allowed;
}

function assertSameBooking(existingPayment, consultation, lawyerId, bookingMetadata) {
  const sameSubject = consultation
    && consultation.lawyerId === lawyerId
    && existingPayment.purpose === 'consultation';
  const sameFingerprint = existingPayment.providerData?.bookingFingerprintVersion === bookingMetadata.bookingFingerprintVersion
    && existingPayment.providerData?.bookingFingerprint === bookingMetadata.bookingFingerprint
    && Number(existingPayment.providerData?.serverPriceTiyin) === bookingMetadata.serverPriceTiyin;
  if (!sameSubject || !sameFingerprint) {
    const error = new Error('Idempotency key was already used for a different booking; terms or server price changed');
    error.status = 409;
    error.code = 'BOOKING_TERMS_CHANGED';
    throw error;
  }
}

// Пороги быстрых фильтров каталога. Держим в одном месте, чтобы подпись чипа
// («Опытные») и условие выборки не разъезжались.
const HIGH_RATING_FROM = 4.5;
const EXPERIENCED_FROM = 10;
const PUBLIC_PROFILE_ATTRIBUTES = [
  'headline', 'professionalTitle', 'specialization', 'specializations', 'description', 'experience', 'price',
  'rating', 'reviewsCount', 'completedCases', 'location', 'languages',
  'region', 'linkedinUrl', 'licenseNumber', 'licenseIssuer', 'licenseIssuedAt', 'licenseExpiresAt',
  'consultationFormats', 'consultationDurations', 'timezone', 'isAvailable',
];
const CATALOG_PROFILE_ATTRIBUTES = [
  'professionalTitle', 'specialization', 'specializations', 'experience', 'price',
  'rating', 'reviewsCount', 'completedCases', 'location', 'region', 'languages',
  'education', 'consultationFormats', 'consultationDurations', 'isAvailable',
];
const PUBLIC_REVIEW_ATTRIBUTES = [
  'id', 'rating', 'text', 'replyText', 'repliedAt', 'helpfulCount', 'createdAt',
];
const anonymizeReviewer = (review) => {
  const plain = review?.toJSON ? review.toJSON() : review;
  if (!plain?.client) return plain;
  const parts = String(plain.client.name || '').trim().split(/\s+/).filter(Boolean);
  const name = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : (parts[0] || 'Клиент');
  return { ...plain, client: { name, avatar: null } };
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
    if (typeof req.query.search === 'string' && req.query.search.trim().length > 100) {
      return res.status(400).json({ error: 'Invalid search', code: 'CATALOG_FILTER_INVALID' });
    }
    const mainOnlyFilters = [
      'search', 'location', 'language', 'minRating', 'minPrice', 'maxPrice', 'onlineOnly',
      'minExperience', 'availableNow', 'availableOnly', 'zoomAvailable', 'experience', 'budget', 'status',
    ]
      .some((name) => req.query[name] !== undefined);
    const useRankedCatalog = Boolean(req.query.cursor)
      || getAuthorizationMode() === 'capability_only'
      || await LawyerPromotion.count() > 0
      || (!mainOnlyFilters && req.query.page === undefined);
    if (useRankedCatalog) {
      const { cursor, limit = 20, page: _legacyPage, ...filters } = req.query;
      const surface = resolveCatalogAuthorizationSurface(req.method, req.originalUrl);
      await shadowCatalogEligibility(await getCatalogEligibilityCandidates(filters), surface);
      const result = await getCatalogPage({
        filters, cursor, pageSize: Number(limit), actorKey: resolveCatalogActor(req, res),
      });
      const presenceSnapshot = await presenceService.getSnapshot('lawyer');
      const facets = await catalogFacets({ role: 'lawyer', isActive: true }, presenceSnapshot.onlineUserIds);
      const documentTypes = await verifiedTypesByUserIds(result.lawyers.map((lawyer) => lawyer.id));
      const responseTimes = await responseTimesByLawyerIds(result.lawyers.map((lawyer) => lawyer.id));
      result.lawyers = result.lawyers.map((lawyer) => ({
        ...lawyer,
        profile: {
          ...lawyer.profile,
          status: tiers.statusOf(lawyer.profile),
          verifiedDocumentTypes: documentTypes.get(lawyer.id) || [],
          medianResponseMinutes: responseTimes.get(lawyer.id),
        },
        presence: presenceService.getPresenceFromSnapshot(lawyer.id, presenceSnapshot),
      }));
      return res.json({ ...result, page: 1, facets });
    }
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
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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
          where: { verificationStatus: 'approved', operatingStatus: 'enabled' },
          required: true,
        },
        { model: LawyerExperience, as: 'lawyerExperiences', attributes: ['id', 'organization', 'position', 'startDate', 'endDate', 'isCurrent', 'description'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerEducation, as: 'lawyerEducations', attributes: ['id', 'university', 'faculty', 'specialty', 'degree', 'startYear', 'endYear', 'country', 'city'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: LawyerCertificate, as: 'lawyerCertificates', attributes: ['id', 'title', 'organization', 'issuedAt', 'credentialUrl'], separate: true, order: [['displayOrder', 'ASC']] },
        { model: ZoomConnection, as: 'zoomConnection', attributes: ['id'], where: { status: 'connected' }, required: false },
        {
          model: Review,
          as: 'receivedReviews',
          attributes: PUBLIC_REVIEW_ATTRIBUTES,
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

    const attributionToken = req.query.attributionToken;
    const requestId = req.get('X-Promotion-Request-Id');
    if (attributionToken && requestId) {
      await recordPromotionEvent({
        attributionToken, event: 'profile_view', actorKey: resolveCatalogActor(req, res),
        requestId, expectedLawyerId: lawyer.id,
      }).catch(() => {});
    }

    const plainLawyer = lawyer.toJSON();
    plainLawyer.receivedReviews = (plainLawyer.receivedReviews || []).map(anonymizeReviewer);
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
    };
    const presenceSnapshot = await presenceService.getSnapshot('lawyer');
    plainLawyer.presence = presenceService.getPresenceFromSnapshot(lawyer.id, presenceSnapshot);
    res.json({ lawyer: plainLawyer });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/promotion/booking-start', authenticate, clientAccess, async (req, res, next) => {
  try {
    const result = await recordPromotionEvent({
      attributionToken: req.body.attributionToken,
      event: 'booking_start',
      actorKey: resolveCatalogActor(req, res),
      requestId: req.body.requestId,
      expectedLawyerId: req.params.id,
    });
    if (result.reason === 'invalid_attribution') return res.status(403).json({ error: 'Invalid promotion attribution' });
    return res.status(204).end();
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

// GET /api/lawyers/:id/reviews — отзывы конкретного юриста
router.get('/:id/reviews', async (req, res, next) => {
  try {
    const reviews = await Review.findAll({
      where: { lawyerId: req.params.id, isHidden: false },
      attributes: PUBLIC_REVIEW_ATTRIBUTES,
      include: [{ model: User, as: 'client', attributes: ['name'] }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ reviews: reviews.map(anonymizeReviewer) });
  } catch (err) {
    next(err);
  }
});

// POST /api/lawyers/:id/book — бронирование консультации
router.post('/:id/book', authenticate, clientAccess, async (req, res, next) => {
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

    if (!lawyer || !await catalogLawyerAllowed(
      lawyer,
      resolveCatalogAuthorizationSurface(req.method, req.originalUrl),
      { requireOperating: false },
    )) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }
    if (lawyer.id === req.userId) {
      return res.status(403).json({ error: 'Нельзя записаться к самому себе', code: 'SELF_BOOKING_FORBIDDEN' });
    }
    // Нельзя бронировать непроверенного или недоступного (offline) юриста
    if (!lawyer.profile || lawyer.profile.verificationStatus !== 'approved') {
      return res.status(400).json({ error: 'Этот юрист ещё не прошёл проверку' });
    }
    if (lawyer.profile.operatingStatus !== 'enabled') {
      return res.status(400).json({ error: 'Юрист временно не принимает консультации' });
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
    if (['zoom', 'webrtc'].includes(normalizedFormat) && !scheduledWindow) return res.status(400).json({ error: 'Для видеоконсультации выберите свободное время' });
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
    // Промокод — отдельный (НЕ бесплатный) путь; скидку считаем на сервере.
    if (!req.body.useFreePromo && !req.body.useSubscriptionFree && req.body.promoCode) {
      const { validatePromo } = require('../services/promoService');
      const result = await validatePromo(req.body.promoCode, fullPrice);
      if (result.valid) {
        price = Math.max(0, fullPrice - result.discountAmount);
        appliedPromo = result.promo;
        notes = `Промокод ${result.code} (−${result.discountPercent}%)${notes ? '. ' + notes : ''}`;
      }
    }

    const wantsFree = Boolean(req.body.useFreePromo || req.body.useSubscriptionFree);
    let isFree = false;
    let freeSource = null;
    let consultation;
    let checkout = null;
    let bookingCreated = false;

    const paidFields = () => ({
      ...baseFields, price, isFree: false, freeSource: null, notes,
      promoCode: appliedPromo ? appliedPromo.code : null,
      status: 'payment_pending',
      lifecycleStatus: 'pending_payment',
      billingStatus: 'none',
    });
    const bookingIdentity = buildBookingFingerprint({
      lawyerId: lawyer.id,
      preferredDate: baseFields.preferredDate,
      preferredTime: baseFields.preferredTime,
      duration: baseFields.duration,
      type: baseFields.type,
      problems: baseFields.problems,
      specialization: baseFields.specialization,
      priceTiyin: price * 100,
    });
    const bookingMetadata = {
      bookingFingerprintVersion: bookingIdentity.version,
      bookingFingerprint: bookingIdentity.fingerprint,
      serverPriceTiyin: price * 100,
    };

    if (!wantsFree) {
      const idempotencyKey = req.get('Idempotency-Key');
      if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key обязателен' });
      await Consultation.sequelize.transaction(async (transaction) => {
        await Consultation.sequelize.query(
          'SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))',
          { replacements: { k: `booking-checkout:${req.userId}:${idempotencyKey}` }, transaction },
        );
        await availabilityService.lockBookingParticipants(lawyer.id, req.userId, transaction);
        await assertZoomConnected(transaction);
        const existingPayment = await Payment.findOne({
          where: {
            userId: req.userId,
            purpose: 'consultation',
            idempotencyKey: { [Op.in]: checkoutIdempotencyCandidates('consultation', idempotencyKey) },
          },
          lock: transaction.LOCK.UPDATE,
          transaction,
        });
        if (existingPayment) {
          consultation = await Consultation.findByPk(existingPayment.consultationId, { transaction });
          assertSameBooking(existingPayment, consultation, lawyer.id, bookingMetadata);
        } else {
          if (scheduledWindow) await availabilityService.assertAvailable({ lawyerId: lawyer.id, clientId: req.userId, window: scheduledWindow, transaction });
          consultation = await Consultation.create(paidFields(), { transaction });
          bookingCreated = true;
        }
        checkout = existingPayment?.status === 'failed' && consultation.status === 'cancelled'
          ? { payment: existingPayment, paymentId: existingPayment.id, checkoutUrl: null }
          : await createCheckout({
            userId: req.userId, purpose: 'consultation', subjectId: consultation.id,
            idempotencyKey, providerData: bookingMetadata, transaction,
          });
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
          let fields = null;
          if (req.body.useFreePromo) {
            const { computeLoyalty } = require('../services/loyaltyService');
            const loyalty = await computeLoyalty(req.userId, { transaction: t });
            if (loyalty.freeNow) {
              isFree = true; freeSource = 'loyalty';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'loyalty', promoCode: null, status: 'pending', lifecycleStatus: 'confirmed', notes: 'Бесплатно по акции «первая консультация бесплатно»' };
            }
          } else if (req.body.useSubscriptionFree) {
            const { computeSubscriptionBenefit } = require('../services/subscriptionService');
            const benefit = await computeSubscriptionBenefit(req.userId, { transaction: t });
            if (benefit.remaining > 0) {
              isFree = true; freeSource = 'subscription';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'subscription', promoCode: null, status: 'pending', lifecycleStatus: 'confirmed', notes: `Бесплатно по подписке «${benefit.plan === 'pro' ? 'Про' : 'Базовый'}»` };
            }
          }
          if (fields) {
            consultation = await Consultation.create(fields, { transaction: t });
            bookingCreated = true;
          }
          if (freeSource === 'subscription') {
            const { recordSubscriptionBenefitConsumption } = require('../services/ledgerService');
            await recordSubscriptionBenefitConsumption(req.userId, consultation.id, t);
          }
        });
      } catch (e) {
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
      if (!consultation) {
        const idempotencyKey = req.get('Idempotency-Key');
        if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key обязателен' });
        await Consultation.sequelize.transaction(async (t) => {
          await Consultation.sequelize.query(
            'SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))',
            { replacements: { k: `booking-checkout:${req.userId}:${idempotencyKey}` }, transaction: t }
          );
          const existingPayment = await Payment.findOne({
            where: {
              userId: req.userId,
              purpose: 'consultation',
              idempotencyKey: { [Op.in]: checkoutIdempotencyCandidates('consultation', idempotencyKey) },
            },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });
          if (existingPayment) {
            consultation = await Consultation.findByPk(existingPayment.consultationId, { transaction: t });
            assertSameBooking(existingPayment, consultation, lawyer.id, bookingMetadata);
          } else {
            consultation = await Consultation.create(paidFields(), { transaction: t });
            bookingCreated = true;
          }
          checkout = existingPayment?.status === 'failed' && consultation.status === 'cancelled'
            ? { payment: existingPayment, paymentId: existingPayment.id, checkoutUrl: null }
            : await createCheckout({
              userId: req.userId, purpose: 'consultation', subjectId: consultation.id,
              idempotencyKey, providerData: bookingMetadata, transaction: t,
            });
        });
      }
    }

    // Промо-инкремент и уведомления — ПОСЛЕ commit (не внутри транзакции, чтобы не
    // трогать бронь, которая могла откатиться). Атомарный гейт used_count < usage_limit.
    if (appliedPromo && bookingCreated) {
      const { literal } = require('sequelize');
      await appliedPromo.increment('usedCount', {
        where: { [Op.or]: [{ usageLimit: null }, literal('used_count < usage_limit')] },
      });
    }
    // Бесплатная бронь сразу actionable; платную публикует только paid callback.
    if (!checkout && bookingCreated) {
      const client = await User.findByPk(req.userId, { attributes: ['name'] });
      notifications.notifyNewBooking(lawyer.id, client?.name || 'Клиент', consultation);
    }
    if (bookingCreated && req.body.promotionAttributionToken && req.body.promotionRequestId) {
      await recordPromotionEvent({
        attributionToken: req.body.promotionAttributionToken,
        event: 'booking',
        actorKey: resolveCatalogActor(req, res),
        requestId: req.body.promotionRequestId,
        expectedLawyerId: lawyer.id,
        consultationId: consultation.id,
      }).catch(() => {});
    }

    const paymentStatus = checkout?.payment?.status || null;
    const requiresPayment = ['pending', 'processing'].includes(paymentStatus);
    res.status(201).json({
      success: true,
      message: 'Запрос отправлен юристу',
      requiresPayment: consultation.status === 'payment_pending',
      paymentId: checkout?.paymentId || checkout?.payment?.id || null,
      consultationId: consultation.id,
      paymentStatus,
      checkoutUrl: checkout?.checkoutUrl || null,
      consultation,
    });
  } catch (err) {
    if (err.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ error: err.message, code: err.code });
    next(err);
  }
});

// POST /api/lawyers/:id/review — оставить отзыв
router.post('/:id/review', authenticate, clientAccess, async (req, res, next) => {
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
module.exports.toPublicLawyerDto = toPublicLawyerDto;
