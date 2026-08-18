const router = require('express').Router();
const { Op, fn, col, literal, where: sqlWhere } = require('sequelize');
const { sequelize, User, LawyerProfile, Review, Consultation } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');
const tiers = require('../services/lawyerTiers');
const presenceService = require('../services/presenceService');

// Пороги быстрых фильтров каталога. Держим в одном месте, чтобы подпись чипа
// («Опытные») и условие выборки не разъезжались.
const HIGH_RATING_FROM = 4.5;
const EXPERIENCED_FROM = 10;
const PUBLIC_PROFILE_ATTRIBUTES = [
  'specialization', 'specializations', 'description', 'experience', 'price',
  'rating', 'reviewsCount', 'completedCases', 'location', 'languages',
  'education', 'certificates', 'schedule', 'isAvailable',
];
const PUBLIC_REVIEW_ATTRIBUTES = [
  'id', 'rating', 'text', 'replyText', 'repliedAt', 'helpfulCount', 'createdAt',
];

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

  return {
    total,
    online,
    highRating: { from: HIGH_RATING_FROM, count: highRating },
    experienced: { from: EXPERIENCED_FROM, count: experienced },
    budget: { maxPrice: budgetThreshold, count: budget },
    priceSegments,
    statusSegments,
    statusRules: tiers.thresholds,
  };
}

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { specialization, search, minRating, sortBy, location, language, minPrice, maxPrice, onlineOnly, experience, budget, status, page = 1, limit = 20 } = req.query;
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
    const searchTerm = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    if (searchTerm) {
      const escapedTerm = searchTerm.replace(/[\\%_]/g, '\\$&');
      const pattern = `%${escapedTerm}%`;
      profileWhere[Op.or] = [
        { specialization: { [Op.iLike]: pattern } },
        sqlWhere(fn('array_to_string', col('profile.specializations'), ' '), { [Op.iLike]: pattern }),
        sqlWhere(col('User.name'), { [Op.iLike]: pattern }),
      ];
    }

    // Онлайн-юристы всегда ВЫШЕ — клиенту удобнее видеть тех, с кем можно поговорить
    // сейчас. Внутри — выбранная сортировка (по умолчанию новизна).
    const onlineFirst = onlineUserIds.length
      ? [[literal(`CASE WHEN "User"."id" IN (${onlineUserIds.map((id) => sequelize.escape(id)).join(',')}) THEN 0 ELSE 1 END`), 'ASC']]
      : [];
    const acceptingBookingsFirst = [[{ model: LawyerProfile, as: 'profile' }, 'isAvailable', 'DESC']];
    const orderPrefix = [...onlineFirst, ...acceptingBookingsFirst];
    let order = [...orderPrefix, ['createdAt', 'DESC']];
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
        attributes: PUBLIC_PROFILE_ATTRIBUTES,
        where: profileWhere,
        required: true,
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
    const lawyers = rows.map((u) => {
      // User.toJSON копирует поля поверхностно, поэтому profile остаётся моделью
      // Sequelize: дописанное в неё поле терялось бы при сериализации ответа.
      const plain = u.toJSON();
      const profile = plain.profile && typeof plain.profile.toJSON === 'function'
        ? plain.profile.toJSON()
        : plain.profile;
      if (profile) plain.profile = { ...profile, status: tiers.statusOf(profile) };
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
        {
          model: Review,
          as: 'receivedReviews',
          attributes: PUBLIC_REVIEW_ATTRIBUTES,
          where: { isHidden: false },
          required: false,
          include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
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
    const reviews = await Review.findAll({
      where: { lawyerId: req.params.id, isHidden: false },
      attributes: PUBLIC_REVIEW_ATTRIBUTES,
      include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ reviews });
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
      where: { id: req.params.id, role: 'lawyer' },
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
    const ALLOWED_DURATIONS = [30, 60, 90];
    let duration = parseInt(req.body.duration, 10);
    if (!ALLOWED_DURATIONS.includes(duration)) duration = 60;

    // Валидация формата даты/времени, если переданы (как в reschedule) — иначе
    // мусорные значения молча игнорировались напоминаниями/календарём.
    const { preferredDate, preferredTime } = req.body;
    if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
      return res.status(400).json({ error: 'Неверный формат даты (YYYY-MM-DD)' });
    }
    if (preferredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
      return res.status(400).json({ error: 'Неверный формат времени (HH:mm)' });
    }

    // Слот должен попадать в рабочие часы юриста (если расписание задано). Раньше
    // валидировался только формат — клиент мог забронировать закрытый день/время.
    const sched = lawyer.profile.schedule;
    const scheduled = sched && typeof sched === 'object' && Object.values(sched).some((day) => day && day.enabled);
    if (scheduled && preferredDate && preferredTime) {
      const DK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // JS getDay() → ключ расписания
      const key = DK[new Date(`${preferredDate}T00:00:00`).getDay()];
      const day = sched[key];
      // Строки HH:mm сравниваются лексикографически корректно (нули впереди).
      if (!day || !day.enabled || preferredTime < day.from || preferredTime >= day.to) {
        return res.status(400).json({ error: 'Выбранное время вне рабочих часов юриста' });
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
    const baseFields = {
      clientId: req.userId,
      lawyerId: lawyer.id,
      type: req.body.consultationType || 'video',
      question: problems[0].text,
      problems,
      // Основная категория записи = первая категория первой проблемы (для фильтров/списков).
      specialization: problems[0].categories[0] || null,
      description: req.body.description,
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      duration,
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

    // Модель B «оплата через 5 минут звонка»: платная бронь НЕ требует предоплаты.
    // Карта «замораживается» (billingStatus='held'), бронь сразу уходит юристу (pending);
    // деньги захватываются на 5-й минуте разговора (billingService.captureHold).
    const paidFields = () => ({
      ...baseFields, price, isFree: false, freeSource: null, notes,
      promoCode: appliedPromo ? appliedPromo.code : null,
      status: 'pending', billingStatus: 'held',
    });

    if (!wantsFree) {
      consultation = await Consultation.create(paidFields());
    } else {
      // ГОНКА #3: право на бесплатное пересчитываем и создаём бронь ПОД per-client
      // advisory-локом в одной транзакции. Лок сериализует брони ТОЛЬКО этого клиента
      // (не все) — второй параллельный запрос дождётся коммита, увидит used++ и уйдёт
      // в платный путь. Частичный уникальный индекс consultations_loyalty_free_unique —
      // hard-гарантия для loyalty (defense-in-depth).
      try {
        await Consultation.sequelize.transaction(async (t) => {
          await Consultation.sequelize.query(
            'SELECT pg_advisory_xact_lock(hashtext(:k))',
            { replacements: { k: `booking:${req.userId}` }, transaction: t }
          );

          let fields = paidFields(); // если право не подтвердится под локом — платно
          if (req.body.useFreePromo) {
            const { computeLoyalty } = require('../services/loyaltyService');
            const loyalty = await computeLoyalty(req.userId, { transaction: t });
            if (loyalty.freeNow) {
              isFree = true; freeSource = 'loyalty';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'loyalty', promoCode: null, status: 'pending', notes: 'Бесплатно по акции «первая консультация бесплатно»' };
            }
          } else if (req.body.useSubscriptionFree) {
            const { computeSubscriptionBenefit } = require('../services/subscriptionService');
            const benefit = await computeSubscriptionBenefit(req.userId, { transaction: t });
            if (benefit.remaining > 0) {
              isFree = true; freeSource = 'subscription';
              fields = { ...baseFields, price: 0, isFree: true, freeSource: 'subscription', promoCode: null, status: 'pending', notes: `Бесплатно по подписке «${benefit.plan === 'pro' ? 'Про' : 'Базовый'}»` };
            }
          }
          consultation = await Consultation.create(fields, { transaction: t });
        });
      } catch (e) {
        // Защита в глубину: если частичный уникальный индекс поймал вторую loyalty-бронь
        // (лок не спас в экзотическом случае) — бронируем как ПЛАТНУЮ, не роняем запрос.
        if (e.name === 'SequelizeUniqueConstraintError') {
          isFree = false; freeSource = null;
          consultation = await Consultation.create(paidFields());
        } else {
          throw e;
        }
      }
    }

    // Промо-инкремент и уведомления — ПОСЛЕ commit (не внутри транзакции, чтобы не
    // трогать бронь, которая могла откатиться). Атомарный гейт used_count < usage_limit.
    if (appliedPromo) {
      const { literal } = require('sequelize');
      await appliedPromo.increment('usedCount', {
        where: { [Op.or]: [{ usageLimit: null }, literal('used_count < usage_limit')] },
      });
    }
    // Уведомляем юриста о новой брони — теперь и платная сразу уходит ему (pending),
    // без шага предоплаты (оплата спишется на 5-й минуте звонка).
    {
      const client = await User.findByPk(req.userId, { attributes: ['name'] });
      notifications.notifyNewBooking(lawyer.id, client?.name || 'Клиент', consultation);
    }

    res.status(201).json({
      success: true,
      message: 'Запрос отправлен юристу',
      requiresPayment: false,
      consultation,
    });
  } catch (err) {
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
