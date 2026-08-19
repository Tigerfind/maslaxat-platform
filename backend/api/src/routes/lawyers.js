const router = require('express').Router();
const { Op } = require('sequelize');
const { User, LawyerProfile, Review, Consultation, Payment } = require('../models');
const { authenticate, authorizeCompat, evaluateAuthorizationDecision } = require('../middleware/auth');
const { getAuthorizationMode, recordAuthorizationDecision } = require('../services/authorizationRuntime');
const notifications = require('../services/notificationService');
const { recomputeLawyerRating } = require('../services/ratingService');
const { createCheckout, checkoutIdempotencyCandidates } = require('../services/paymentService');
const { buildBookingFingerprint } = require('../services/bookingFingerprintService');
const { getCatalogPage, getCatalogEligibilityCandidates } = require('../services/catalogRankingService');
const { resolveCatalogAuthorizationSurface } = require('../config/authorizationSurfaces');
const { recordPromotionEvent } = require('../services/promotionAnalyticsService');
const { resolveCatalogActor } = require('../services/catalogActorService');
const { toPublicLawyerDto, toPublicReview } = require('../services/publicLawyerDto');
const { toConsultationDto } = require('../services/consultationDto');

const clientAccess = authorizeCompat({ legacyRoles: ['client', 'lawyer'], capability: 'client', telemetryName: 'http.client' });

async function shadowCatalogEligibility(users, surface) {
  for (const user of users) {
    const legacyAllowed = user.role === 'lawyer' && user.isActive
      && user.profile?.verificationStatus === 'approved';
    const capabilityAllowed = user.accountType === 'member' && user.isActive
      && user.twoFactorEnabled && user.profile?.verificationStatus === 'approved'
      && user.profile?.operatingStatus === 'enabled';
    await evaluateAuthorizationDecision({
      authorizationMode: getAuthorizationMode(), channel: 'catalog',
      surface, mode: 'lawyer', legacyAllowed, capabilityAllowed,
      recordDecision: recordAuthorizationDecision, compatibilityAuthority: 'legacy',
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
    authorizationMode: getAuthorizationMode(), channel: 'catalog',
    surface, mode: 'lawyer', legacyAllowed, capabilityAllowed,
    recordDecision: recordAuthorizationDecision, compatibilityAuthority: 'legacy',
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

// GET /api/lawyers — поиск юристов (публичный)
router.get('/', async (req, res, next) => {
  try {
    const { cursor, limit = 20, page: _legacyPage, ...filters } = req.query;
    const surface = resolveCatalogAuthorizationSurface(req.method, req.originalUrl);
    await shadowCatalogEligibility(await getCatalogEligibilityCandidates(filters), surface);
    const result = await getCatalogPage({
      filters,
      cursor,
      pageSize: Number(limit),
      actorKey: resolveCatalogActor(req, res),
    });
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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
      where: { id: req.params.id, isActive: true },
      attributes: ['id', 'name', 'avatar', 'role', 'accountType', 'twoFactorEnabled', 'isActive', 'isVerified', 'createdAt'],
      include: [
        { model: LawyerProfile, as: 'profile' },
        {
          model: Review,
          as: 'receivedReviews',
          where: { isHidden: false },
          required: false,
          attributes: ['id', 'rating', 'text', 'createdAt'],
          include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
          order: [['createdAt', 'DESC']],
          limit: 20,
        },
      ],
    });

    // Безопасный режим: непроверенный/отклонённый профиль публично не показываем
    // (иначе клиент дошёл бы до него по прямой ссылке минуя каталог).
    if (!lawyer || !await catalogLawyerAllowed(
      lawyer,
      resolveCatalogAuthorizationSurface(req.method, req.originalUrl),
    )) {
      return res.status(404).json({ error: 'Юрист не найден' });
    }

    const attributionToken = req.query.attributionToken;
    const requestId = req.get('X-Promotion-Request-Id');
    if (attributionToken && requestId) {
      await recordPromotionEvent({
        attributionToken,
        event: 'profile_view',
        actorKey: resolveCatalogActor(req, res),
        requestId,
        expectedLawyerId: lawyer.id,
      }).catch(() => {});
    }

    res.json({ lawyer: toPublicLawyerDto(lawyer) });
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
      attributes: ['id', 'rating', 'text', 'createdAt'],
      include: [{ model: User, as: 'client', attributes: ['id', 'name', 'avatar'] }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ reviews: reviews.map(toPublicReview) });
  } catch (err) {
    next(err);
  }
});

// POST /api/lawyers/:id/book — бронирование консультации
router.post('/:id/book', authenticate, clientAccess, async (req, res, next) => {
  try {
    if (req.params.id === req.userId) {
      return res.status(403).json({ error: 'Нельзя забронировать консультацию у себя', code: 'SELF_BOOKING_FORBIDDEN' });
    }
    // Анти-фрод: бронировать может только клиент с подтверждённым контактом
    // (email подтверждён ИЛИ регистрация по телефону-OTP → isVerified=true).
    // Отсекает фейковые аккаунты и пустые брони под модель оплаты B.
    const client = await User.findByPk(req.userId, { attributes: ['id', 'isVerified'] });
    if (!client || !client.isVerified) {
      return res.status(403).json({ error: 'Подтвердите email или телефон, чтобы бронировать', code: 'CONTACT_UNVERIFIED' });
    }

    const lawyer = await User.findOne({
      where: { id: req.params.id, isActive: true },
      include: [{ model: LawyerProfile, as: 'profile' }],
    });

    if (!lawyer || !await catalogLawyerAllowed(
      lawyer,
      resolveCatalogAuthorizationSurface(req.method, req.originalUrl),
      { requireOperating: false },
    )) {
      return res.status(404).json({ error: 'Юрист не найден' });
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
    let checkout = null;
    let bookingCreated = false;

    const paidFields = () => ({
      ...baseFields, price, isFree: false, freeSource: null, notes,
      promoCode: appliedPromo ? appliedPromo.code : null,
      status: 'payment_pending',
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
            userId: req.userId,
            purpose: 'consultation',
            subjectId: consultation.id,
            idempotencyKey,
            providerData: bookingMetadata,
            transaction: t,
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
          await Consultation.sequelize.query(
            'SELECT pg_advisory_xact_lock(hashtext(:k))',
            { replacements: { k: `booking:${req.userId}` }, transaction: t }
          );

          let fields = null;
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
      message: requiresPayment ? 'Перейдите к оплате' : 'Запрос отправлен юристу',
      requiresPayment,
      consultationId: consultation.id,
      paymentId: checkout?.paymentId || null,
      paymentStatus,
      checkoutUrl: requiresPayment ? checkout?.checkoutUrl || null : null,
      consultation: toConsultationDto(consultation, { perspective: 'client' }),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
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
