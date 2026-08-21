const router = require('express').Router();
const { Op } = require('sequelize');
const { Consultation, ConsultationMeeting, User, LawyerProfile, Review, Promo, Payment, CaseDocument } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { completeConsultation, refundConsultationEscrow } = require('../services/escrow');
const availabilityService = require('../services/availabilityService');
const zoomMeetingService = require('../services/zoomMeetingService');
const { PAYMENT_RESERVATION_MINUTES } = require('../services/availabilityService');
const { consultationAccess } = require('../services/consultationAccessService');

const BUCKETS = ['all', 'payment_pending', 'upcoming', 'completed', 'cancelled', 'archived'];
const PERIOD_DAYS = { '30d': 30, '365d': 365 };

function applyBucket(where, bucket) {
  if (bucket === 'payment_pending') where.status = 'payment_pending';
  if (bucket === 'upcoming') where.status = { [Op.in]: ['pending', 'accepted', 'in_progress'] };
  if (bucket === 'completed' || bucket === 'archived') where.status = 'completed';
  if (bucket === 'cancelled') where.status = { [Op.in]: ['cancelled', 'rejected'] };
  if (bucket === 'completed') where['$consultationReview.id$'] = null;
}

function paymentPresentation(consultation) {
  if (consultation.isFree) return { status: 'free', amount: 0, currency: 'UZS' };
  const payments = consultation.payments || [];
  const payment = payments[0];
  if (payment?.refundStatus === 'completed' || payment?.status === 'refunded') {
    return { status: 'refunded', amount: Number(payment.amount), currency: payment.currency, refundedAt: payment.refundedAt };
  }
  if (payment?.refundStatus === 'requested') return { status: 'refund_pending', amount: Number(payment.amount), currency: payment.currency };
  if (consultation.status === 'payment_pending') return { status: 'authorization_pending', amount: Number(consultation.price), currency: 'UZS' };
  if (payment?.status === 'paid' || ['charged', 'released'].includes(consultation.billingStatus)) {
    return { status: consultation.billingStatus === 'released' ? 'released' : 'paid', amount: Number(payment?.amount ?? consultation.price), currency: payment?.currency || 'UZS', paidAt: payment?.updatedAt || consultation.chargedAt };
  }
  if (consultation.billingStatus === 'held') return { status: 'authorized', amount: Number(consultation.price), currency: 'UZS' };
  if (payment?.status === 'failed' || consultation.billingStatus === 'failed') return { status: 'failed', amount: Number(consultation.price), currency: 'UZS' };
  return { status: 'unpaid', amount: Number(consultation.price), currency: 'UZS' };
}

// GET /api/consultations — мои консультации
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, search, period = 'all' } = req.query;
    const bucket = BUCKETS.includes(req.query.bucket) ? req.query.bucket : 'all';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const baseWhere = {};
    if (req.userRole === 'client') baseWhere.clientId = req.userId;
    if (req.userRole === 'lawyer') baseWhere.lawyerId = req.userId;
    const searchTerm = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    if (searchTerm) {
      const pattern = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;
      baseWhere[Op.or] = [
        { question: { [Op.iLike]: pattern } },
        { description: { [Op.iLike]: pattern } },
        { specialization: { [Op.iLike]: pattern } },
        { '$lawyer.name$': { [Op.iLike]: pattern } },
      ];
    }
    if (PERIOD_DAYS[period]) {
      const cutoff = new Date(Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
      baseWhere[Op.and] = [{
        [Op.or]: [
          { scheduledStartAt: { [Op.gte]: cutoff } },
          { scheduledStartAt: null, createdAt: { [Op.gte]: cutoff } },
        ],
      }];
    }
    const where = { ...baseWhere };
    if (status && status !== 'all') where.status = status;
    else applyBucket(where, bucket);

    const participantIncludes = (selectedBucket = bucket) => [
      { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
      {
        model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'], required: true,
        include: [{ model: LawyerProfile, as: 'profile', attributes: ['specialization', 'rating'] }],
      },
      {
        model: Review, as: 'consultationReview', attributes: ['id', 'rating', 'text'],
        required: selectedBucket === 'archived',
      },
    ];

    const { count, rows } = await Consultation.findAndCountAll({
      where,
      include: [
        ...participantIncludes(),
        { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'lastError'] },
        { model: Payment, as: 'payments', separate: true, attributes: ['id', 'amount', 'currency', 'status', 'refundStatus', 'refundedAt', 'escrowReleased', 'updatedAt'], order: [['createdAt', 'DESC']] },
      ],
      order: [['createdAt', 'DESC']],
      distinct: true,
      subQuery: false,
      limit,
      offset,
    });

    const counts = {};
    await Promise.all(BUCKETS.map(async (countBucket) => {
      const countWhere = { ...baseWhere };
      applyBucket(countWhere, countBucket);
      counts[countBucket] = await Consultation.count({
        where: countWhere,
        include: participantIncludes(countBucket),
        distinct: true,
        col: 'id',
      });
    }));

    const consultations = rows.map((row) => {
      const plain = row.toJSON();
      if (req.userRole === 'client') delete plain.lawyerNote;
      plain.payment = paymentPresentation(plain);
      plain.access = consultationAccess(row);
      if (plain.status === 'payment_pending') {
        plain.paymentExpiresAt = new Date(new Date(plain.createdAt).getTime() + PAYMENT_RESERVATION_MINUTES * 60000);
      }
      delete plain.payments;
      return plain;
    });

    res.json({
      consultations,
      total: count,
      counts,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/upcoming — предстоящие
router.get('/upcoming', authenticate, async (req, res, next) => {
  try {
    const where = {
      status: { [Op.in]: ['accepted', 'in_progress'] },
    };
    if (req.userRole === 'client') where.clientId = req.userId;
    if (req.userRole === 'lawyer') where.lawyerId = req.userId;

    const consultations = await Consultation.findAll({
      where,
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
      order: [['preferredDate', 'ASC']],
      limit: 10,
    });

    res.json(consultations);
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/loyalty — статус акции «каждая 3-я бесплатно»
// ВАЖНО: объявлено выше GET /:id, иначе "loyalty" попадёт в параметр :id
router.get('/loyalty', authenticate, async (req, res, next) => {
  try {
    const { computeLoyalty } = require('../services/loyaltyService');
    const loyalty = await computeLoyalty(req.userId);
    res.json(loyalty);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/consultations/:id/status — изменить статус (юрист/админ)
router.patch('/:id/status', authenticate, authorize('lawyer', 'admin'), async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (req.userRole === 'lawyer' && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // БЕЗОПАСНОСТЬ: разрешаем только валидные целевые статусы, а не произвольный enum.
    // payment_pending/pending — системные (оплата), их через этот роут ставить нельзя.
    // cancelled/rejected идут только через специализированные endpoints с
    // атомарным снятием escrow и постановкой provider-refund в очередь.
    const ALLOWED_STATUS = ['accepted', 'in_progress', 'completed'];
    if (!ALLOWED_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    // МАШИНА СОСТОЯНИЙ для ЮРИСТА: только легальные переходы вперёд. НЕТ перехода ИЗ
    // completed (иначе revert-примитив → повторная выплата эскроу). rejected/cancelled
    // недоступны здесь намеренно — у них отдельные эндпоинты с возвратом эскроу.
    // Админ сохраняет широту (модерация/разбор спора) и этот гейт минует.
    const LAWYER_TRANSITIONS = {
      pending: ['accepted'],
      accepted: ['in_progress'],
      in_progress: ['completed'],
    };
    if (req.userRole === 'lawyer') {
      const allowed = LAWYER_TRANSITIONS[consultation.status] || [];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: 'Недопустимый переход статуса' });
      }
    }

    // Завершение — через единый идемпотентный хелпер (высвобождает эскроу один раз).
    if (req.body.status === 'completed') {
      // ДЕНЬГИ: юрист может завершить (и высвободить эскроу) только начатую консультацию.
      // Админ — может форсировать (модерация/разбор спора).
      if (req.userRole === 'lawyer' && consultation.status !== 'in_progress') {
        return res.status(400).json({ error: 'Сначала начните консультацию, затем завершайте' });
      }
      const { consultation: updated } = await completeConsultation(consultation.id, req.body.notes);
      return res.json({ consultation: updated });
    }

    consultation.status = req.body.status;
    if (req.userRole === 'lawyer' && req.body.status === 'accepted' && !consultation.acceptedAt) {
      consultation.acceptedAt = new Date();
    }
    if (req.body.notes) consultation.notes = req.body.notes;
    await consultation.save();

    res.json({ consultation });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/:id — получить детали консультации
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile', attributes: ['specialization', 'rating'] }],
        },
        { model: Review, as: 'consultationReview', attributes: ['id', 'rating', 'text'] },
        { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'startedAt', 'endedAt', 'lastError'] },
        { model: Payment, as: 'payments', separate: true, attributes: ['id', 'amount', 'currency', 'status', 'refundStatus', 'refundedAt', 'escrowReleased', 'updatedAt'], order: [['createdAt', 'DESC']] },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    const plain = consultation.toJSON();
    if (req.userRole === 'client') delete plain.lawyerNote;
    plain.payment = paymentPresentation(plain);
    if (plain.status === 'payment_pending') {
      plain.paymentExpiresAt = new Date(new Date(plain.createdAt).getTime() + PAYMENT_RESERVATION_MINUTES * 60000);
    }
    delete plain.payments;
    const statusHistory = [{ status: 'created', at: plain.createdAt }];
    if (plain.acceptedAt) statusHistory.push({ status: 'accepted', at: plain.acceptedAt });
    if (plain.callStartedAt) statusHistory.push({ status: 'in_progress', at: plain.callStartedAt });
    if (!['payment_pending', 'pending', 'accepted', 'in_progress'].includes(plain.status)) {
      statusHistory.push({ status: plain.status, at: plain.updatedAt });
    }
    const documentsCount = await CaseDocument.count({ where: { consultationId: consultation.id } });
    res.json({
      consultation: plain,
      access: consultationAccess(consultation),
      payment: plain.payment,
      statusHistory,
      documents: { count: documentsCount },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/join — присоединиться к консультации
router.post('/:id/join', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'] },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    const access = consultationAccess(consultation);
    if (!access.canJoin) {
      return res.status(403).json({ error: 'Подключение сейчас недоступно', code: access.reason, ...access });
    }

    // ВАЖНО: /join НЕ переводит в in_progress. Раньше это давало бэкдор —
    // юрист делал /join (pending/accepted → in_progress), затем /status=completed
    // и забирал эскроу без реального звонка. В in_progress переводит только
    // реальное соединение видеозвонка (video /start по peer-connect).
    res.json({ consultation, access });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/summary', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const summary = typeof req.body.summary === 'string' ? req.body.summary.trim().slice(0, 5000) : '';
    if (!summary) return res.status(400).json({ error: 'Добавьте итог консультации' });
    const consultation = await Consultation.findOne({ where: { id: req.params.id, lawyerId: req.userId } });
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    if (!['in_progress', 'completed'].includes(consultation.status)) {
      return res.status(409).json({ error: 'Итог можно добавить после начала консультации' });
    }
    await consultation.update({ lawyerSummary: summary });
    return res.json({ lawyerSummary: consultation.lawyerSummary });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/consultations/:id/reschedule — перенос времени (клиент или юрист)
router.patch('/:id/reschedule', authenticate, async (req, res, next) => {
  try {
    const { preferredDate, preferredTime } = req.body;
    if (!preferredDate || !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
      return res.status(400).json({ error: 'Некорректная дата' });
    }
    if (!preferredTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime)) {
      return res.status(400).json({ error: 'Некорректное время' });
    }

    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name'] },
      ],
    });
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    // Переносить можно только ещё не начатую/не завершённую консультацию
    if (!['payment_pending', 'pending', 'accepted'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Эту консультацию нельзя перенести' });
    }
    const profile = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId } });
    let window;
    try { window = availabilityService.validateWindow(profile, preferredDate, preferredTime, consultation.duration); }
    catch (error) { return res.status(error.status || 400).json({ error: error.message, code: error.code }); }
    try {
      await Consultation.sequelize.transaction(async (transaction) => {
        await availabilityService.lockBookingParticipants(consultation.lawyerId, consultation.clientId, transaction);
        await availabilityService.assertAvailable({
          lawyerId: consultation.lawyerId, clientId: consultation.clientId, window,
          excludeConsultationId: consultation.id, transaction,
        });
        await consultation.update({
          preferredDate, preferredTime, scheduledStartAt: window.start.toJSDate(),
          scheduledEndAt: window.end.toJSDate(), scheduleTimezone: window.timezone,
          reminderSent: false,
        }, { transaction });
      });
    } catch (error) {
      if (error.code === 'SLOT_UNAVAILABLE') return res.status(409).json({ error: error.message, code: error.code });
      throw error;
    }
    if (consultation.meetingProvider === 'zoom') zoomMeetingService.updateMeeting(consultation.id).catch(() => {});

    // Уведомляем другую сторону
    const isClient = consultation.clientId === req.userId;
    const otherId = isClient ? consultation.lawyerId : consultation.clientId;
    const byName = (isClient ? consultation.client?.name : consultation.lawyer?.name) || 'Участник';
    notificationService.notifyConsultationRescheduled(otherId, byName, consultation);

    res.json({ consultation });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/cancel — отменить
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Атомарный переход в cancelled ТОЛЬКО из отменяемых статусов. Это одновременно:
    // (а) запрещает отмену completed/cancelled/in_progress (в т.ч. после оказанной
    // услуги), (б) исключает гонку двойного клика — только один запрос выиграет
    // переход, поэтому возврат эскроу выполнится ровно один раз.
    const cancelled = await Consultation.sequelize.transaction(async (transaction) => {
      const locked = await Consultation.findByPk(consultation.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || !['payment_pending', 'pending', 'accepted'].includes(locked.status)) return false;
      const reason = req.body.reason || 'Отменено пользователем';
      await locked.update({ status: 'cancelled', notes: reason }, { transaction });
      await refundConsultationEscrow(locked.id, {
        transaction, actorUserId: req.userId, source: req.userRole || 'client', reason,
      });
      if (locked.promoCode) {
        await Promo.increment('usedCount', {
          by: -1,
          where: { code: locked.promoCode, usedCount: { [Op.gt]: 0 } },
          transaction,
        });
      }
      return true;
    });
    if (!cancelled) {
      return res.status(400).json({ error: 'Эту консультацию нельзя отменить' });
    }

    await consultation.reload();

    // Notify the other party about cancellation
    const canceller = await User.findByPk(req.userId, { attributes: ['name'] });
    const otherUserId = consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId;
    notificationService.notifyConsultationCancelled(otherUserId, canceller?.name || 'Пользователь', consultation);
    if (consultation.meetingProvider === 'zoom') zoomMeetingService.cancelMeeting(consultation.id).catch(() => {});

    res.json({ message: 'Консультация отменена', consultation });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/complete — клиент завершает сеанс.
// Разрешено только для активной консультации (accepted/in_progress).
// При завершении высвобождается эскроу: pendingBalance → balance юриста.
router.post('/:id/complete', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.clientId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!['accepted', 'in_progress'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Завершить можно только активную консультацию' });
    }

    // Единый идемпотентный путь: завершение + высвобождение эскроу
    const { consultation: updated } = await completeConsultation(consultation.id);

    // Уведомляем юриста о завершении
    const client = await User.findByPk(req.userId, { attributes: ['name'] });
    notificationService.notifyConsultationCompleted(updated.lawyerId, client?.name || 'Клиент', updated);

    res.json({ message: 'Консультация завершена', consultation: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
