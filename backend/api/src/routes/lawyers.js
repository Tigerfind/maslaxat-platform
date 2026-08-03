const router = require('express').Router();
const { Op } = require('sequelize');
const { User, LawyerProfile, Review, Consultation } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { specialization, search, minRating, sortBy, location, language, minPrice, maxPrice, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const profileWhere = {};
    if (specialization) profileWhere.specialization = specialization;
    if (location) profileWhere.location = location;
    // Фильтр по цене консультации (profile.price). Границы приходят только когда реально
    // заданы (см. clientService): minPrice>0 и/или maxPrice<потолка.
    const priceFilter = {};
    if (minPrice !== undefined && !Number.isNaN(Number(minPrice))) priceFilter[Op.gte] = Number(minPrice);
    if (maxPrice !== undefined && !Number.isNaN(Number(maxPrice))) priceFilter[Op.lte] = Number(maxPrice);
    if (Object.getOwnPropertySymbols(priceFilter).length) profileWhere.price = priceFilter;
    // languages — JSONB-массив; фильтруем по вхождению языка (Postgres @>)
    if (language) profileWhere.languages = { [Op.contains]: [language] };
    // Фильтр по звёздам: показываем юристов, чей рейтинг округляется до выбранной звезды
    // (напр. «5 звёзд» → рейтинг 4.5–5.0; «2 звезды» → 1.5–2.49). Совпадает с тем,
    // сколько звёзд показано на карточке.
    if (minRating) {
      const r = parseFloat(minRating);
      profileWhere.rating = { [Op.gte]: r - 0.5, [Op.lt]: r + 0.5 };
    }

    const userWhere = { role: 'lawyer', isActive: true };
    if (search) {
      userWhere.name = { [Op.iLike]: `%${search}%` };
    }

    let order = [['createdAt', 'DESC']];
    if (sortBy === 'rating') order = [[{ model: LawyerProfile, as: 'profile' }, 'rating', 'DESC']];
    if (sortBy === 'price_low') order = [[{ model: LawyerProfile, as: 'profile' }, 'price', 'ASC']];
    if (sortBy === 'price_high') order = [[{ model: LawyerProfile, as: 'profile' }, 'price', 'DESC']];
    if (sortBy === 'experience') order = [[{ model: LawyerProfile, as: 'profile' }, 'experience', 'DESC']];

    // Never expose phone/email of lawyers to public/client searches
    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      attributes: ['id', 'name', 'avatar', 'role', 'isVerified', 'createdAt'],
      include: [{
        model: LawyerProfile,
        as: 'profile',
        where: profileWhere,
        required: true,
      }],
      order,
      limit: parseInt(limit),
      offset,
    });

    res.json({
      lawyers: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyers/filter-options — списки городов и языков для фильтров.
// ВАЖНО: объявлено ВЫШЕ '/:id', иначе 'filter-options' попадёт в параметр :id.
router.get('/filter-options', async (req, res, next) => {
  try {
    const profiles = await LawyerProfile.findAll({ attributes: ['location', 'languages'], raw: true });
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
      where: { id: req.params.id, role: 'lawyer' },
      attributes: ['id', 'name', 'avatar', 'role', 'isVerified', 'createdAt'],
      include: [
        { model: LawyerProfile, as: 'profile' },
        {
          model: Review,
          as: 'receivedReviews',
          include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
          order: [['createdAt', 'DESC']],
          limit: 20,
        },
      ],
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    res.json({ lawyer });
  } catch (err) {
    next(err);
  }
});

// GET /api/lawyers/:id/reviews — отзывы конкретного юриста
router.get('/:id/reviews', async (req, res, next) => {
  try {
    const reviews = await Review.findAll({
      where: { lawyerId: req.params.id, isHidden: false },
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
    const lawyer = await User.findOne({
      where: { id: req.params.id, role: 'lawyer' },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    if (!lawyer) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }
    // Нельзя бронировать непроверенного или недоступного (offline) юриста
    if (!lawyer.isVerified) {
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

    // Платная/промо-бронь ждёт оплаты (payment_pending); бесплатная сразу уходит юристу.
    const paidFields = () => ({
      ...baseFields, price, isFree: false, freeSource: null, notes,
      promoCode: appliedPromo ? appliedPromo.code : null, status: 'payment_pending',
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
    if (isFree) {
      const client = await User.findByPk(req.userId, { attributes: ['name'] });
      notifications.notifyNewBooking(lawyer.id, client?.name || 'Клиент', consultation);
    }

    res.status(201).json({
      success: true,
      message: isFree ? 'Запрос отправлен юристу' : 'Требуется оплата',
      requiresPayment: !isFree,
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
