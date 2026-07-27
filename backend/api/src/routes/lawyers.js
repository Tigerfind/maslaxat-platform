const router = require('express').Router();
const { Op } = require('sequelize');
const { User, LawyerProfile, Review, Consultation } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { specialization, search, minRating, sortBy, location, language, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const profileWhere = {};
    if (specialization) profileWhere.specialization = specialization;
    if (location) profileWhere.location = location;
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

    // Акция «первая консультация бесплатно»: право всегда пересчитываем на сервере,
    // клиентскому флагу не доверяем.
    let price = Math.round((lawyer.profile.price * duration) / 60);
    let isFree = false;
    let notes = req.body.notes || null;
    let appliedPromo = null;
    if (req.body.useFreePromo) {
      const { computeLoyalty } = require('../services/loyaltyService');
      const loyalty = await computeLoyalty(req.userId);
      if (loyalty.freeNow) {
        price = 0;
        isFree = true;
        notes = 'Бесплатно по акции «первая консультация бесплатно»';
      }
    } else if (req.body.promoCode) {
      // Промокод: скидку ВСЕГДА пересчитываем на сервере (клиенту не доверяем)
      const { validatePromo } = require('../services/promoService');
      const result = await validatePromo(req.body.promoCode, price);
      if (result.valid) {
        price = Math.max(0, price - result.discountAmount);
        appliedPromo = result.promo;
        notes = `Промокод ${result.code} (−${result.discountPercent}%)${notes ? '. ' + notes : ''}`;
      }
    }

    // Бесплатная бронь (акция) сразу уходит юристу; платная ждёт оплаты
    // (status = payment_pending), а юрист узнаёт о ней только после оплаты.
    const consultation = await Consultation.create({
      clientId: req.userId,
      lawyerId: lawyer.id,
      type: req.body.consultationType || 'video',
      question: req.body.question,
      description: req.body.description,
      preferredDate: req.body.preferredDate,
      preferredTime: req.body.preferredTime,
      duration,
      price,
      isFree,
      notes,
      status: isFree ? 'pending' : 'payment_pending',
    });

    // Учитываем использование промокода. Атомарно и с защитой лимита: условие
    // used_count < usage_limit в самом UPDATE не даёт гонке превысить usageLimit.
    if (appliedPromo) {
      const { literal } = require('sequelize');
      await appliedPromo.increment('usedCount', {
        where: { [Op.or]: [{ usageLimit: null }, literal('used_count < usage_limit')] },
      });
    }

    // Уведомляем юриста только о бесплатной брони; платную — после оплаты
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

    // Один отзыв на консультацию (idempotent — заодно чинит дубли из backlog)
    const [review, created] = await Review.findOrCreate({
      where: { consultationId },
      defaults: { clientId: req.userId, lawyerId, consultationId, rating: r, text },
    });
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
