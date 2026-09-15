const router = require('express').Router();
const { Op, fn, col } = require('sequelize');
const { Consultation, ConsultationMeeting, Message, User, LawyerProfile, Review, Promo, Payment, CaseDocument } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { completeConsultation, refundConsultationEscrow } = require('../services/escrow');
const availabilityService = require('../services/availabilityService');
const zoomMeetingService = require('../services/zoomMeetingService');
const { expireDueReservations, expireReservationById, expireLockedReservation, unexpiredReservationWhere } = require('../services/reservationExpiryService');
const policy = require('../services/consultationPolicy');
const { hasBilateralPeerEvidence } = require('../services/webrtcEvidenceService');

const { BUCKETS } = policy;
const PERIOD_DAYS = { '30d': 30, '365d': 365 };

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

const participantIncludes = () => [
  { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
  { model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'], required: true, include: [{ model: LawyerProfile, as: 'profile', attributes: ['specialization', 'specializations', 'rating'] }] },
  { model: Review, as: 'consultationReview', attributes: ['id', 'rating', 'text'] },
  { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'startedAt', 'endedAt', 'lastSafeError'] },
  { model: Payment, as: 'payments', separate: true, attributes: ['id', 'amount', 'currency', 'status', 'refundStatus', 'refundedAt', 'escrowReleased', 'updatedAt'], order: [['createdAt', 'DESC']] },
];

function serializeConsultation(row, role, now, bilateralMessageEvidence = false) {
  const plain = row.toJSON ? row.toJSON() : { ...row };
  if (role === 'client') delete plain.lawyerNote;
  if (plain.status === 'payment_pending' && !plain.paymentExpiresAt && plain.createdAt) {
    plain.paymentExpiresAt = new Date(new Date(plain.createdAt).getTime() + availabilityService.PAYMENT_RESERVATION_MINUTES * 60000);
  }
  plain.bilateralMessageEvidence = bilateralMessageEvidence;
  plain.payment = paymentPresentation(plain);
  plain.policy = policy.policyDto(plain, role, now);
  plain.access = plain.policy;
  delete plain.bilateralMessageEvidence;
  delete plain.payments;
  return plain;
}

async function bilateralChatEvidence(rows) {
  const chats = rows.filter((row) => row.type === 'chat');
  if (!chats.length) return new Set();
  const messages = await Message.findAll({
    where: { consultationId: { [Op.in]: chats.map((row) => row.id) } },
    attributes: ['consultationId', 'senderId'], group: ['consultationId', 'senderId'], raw: true,
  });
  const participants = new Map();
  for (const message of messages) {
    if (!participants.has(message.consultationId)) participants.set(message.consultationId, new Set());
    participants.get(message.consultationId).add(message.senderId);
  }
  return new Set(chats.filter((row) => {
    const senders = participants.get(row.id);
    return senders?.has(row.clientId) && senders.has(row.lawyerId);
  }).map((row) => row.id));
}

function countsFromGroups(groups) {
  const counts = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  for (const group of groups) {
    const count = Number(group.get ? group.get('count') : group.count) || 0;
    const item = group.get ? group.get() : group;
    counts.all += count;
    const bucket = policy.bucketOf(item);
    if (counts[bucket] !== undefined && bucket !== 'all') counts[bucket] += count;
  }
  return counts;
}

// GET /api/consultations — мои консультации
router.get('/', authenticate, authorize('client', 'lawyer'), async (req, res, next) => {
  try {
    const expiryScope = req.userRole === 'client' ? { clientId: req.userId } : { lawyerId: req.userId };
    await expireDueReservations(new Date(), expiryScope, 500);
    const serverNow = new Date();
    const { status, search, period = 'all' } = req.query;
    const bucket = BUCKETS.includes(req.query.bucket) ? req.query.bucket : 'all';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const baseWhere = {};
    if (req.userRole === 'client') baseWhere.clientId = req.userId;
    if (req.userRole === 'lawyer') baseWhere.lawyerId = req.userId;
    baseWhere[Op.and] = [unexpiredReservationWhere(serverNow)];
    const searchTerm = typeof search === 'string' ? search.trim().slice(0, 100) : '';
    if (searchTerm) {
      const pattern = `%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`;
      baseWhere[Op.or] = [
        { question: { [Op.iLike]: pattern } },
        { description: { [Op.iLike]: pattern } },
        { specialization: { [Op.iLike]: pattern } },
        { '$lawyer.name$': { [Op.iLike]: pattern } },
        { '$lawyer.profile.specialization$': { [Op.iLike]: pattern } },
      ];
    }
    if (PERIOD_DAYS[period]) {
      const cutoff = new Date(Date.now() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
      baseWhere.scheduledStartAt = { [Op.gte]: cutoff };
    }
    const where = { ...baseWhere };
    if (status && status !== 'all' && policy.STATUSES.includes(status)) where.status = status;
    else policy.applyBucket(where, bucket);

    const rows = await Consultation.findAll({
      where,
      include: participantIncludes(),
      order: policy.orderFor(bucket),
      subQuery: false,
      limit,
      offset,
    });
    const countGroups = await Consultation.findAll({
      where: baseWhere,
      attributes: ['status', 'archivedAt', [fn('COUNT', col('Consultation.id')), 'count']],
      include: [{ model: User, as: 'lawyer', attributes: [], required: true, include: [{ model: LawyerProfile, as: 'profile', attributes: [] }] }],
      group: ['Consultation.status', 'Consultation.archived_at'],
      raw: false,
    });
    const counts = countsFromGroups(countGroups);
    const total = status && status !== 'all'
      ? countGroups.filter((group) => group.get('status') === status).reduce((sum, group) => sum + Number(group.get('count') || 0), 0)
      : counts[bucket];
    const chatEvidence = await bilateralChatEvidence(rows);
    const consultations = rows.map((row) => serializeConsultation(row, req.userRole, serverNow, chatEvidence.has(row.id)));

    res.json({
      consultations,
      serverNow: serverNow.toISOString(),
      total,
      counts,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/upcoming — предстоящие
router.get('/upcoming', authenticate, authorize('client', 'lawyer'), async (req, res, next) => {
  try {
    const expiryScope = req.userRole === 'client' ? { clientId: req.userId } : { lawyerId: req.userId };
    await expireDueReservations(new Date(), expiryScope);
    const serverNow = new Date();
    const where = { archivedAt: null, status: { [Op.in]: policy.ACTIVE_STATUSES } };
    if (req.userRole === 'client') where.clientId = req.userId;
    if (req.userRole === 'lawyer') where.lawyerId = req.userId;

    const consultations = await Consultation.findAll({
      where,
      include: participantIncludes(),
      order: policy.orderFor('upcoming'),
      limit: 10,
    });

    const chatEvidence = await bilateralChatEvidence(consultations);
    res.json({ consultations: consultations.map((item) => serializeConsultation(item, req.userRole, serverNow, chatEvidence.has(item.id))), serverNow: serverNow.toISOString() });
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
    const ALLOWED_STATUS = ['accepted'];
    if (!ALLOWED_STATUS.includes(req.body.status)) {
      return res.status(400).json({ error: 'Недопустимый статус' });
    }

    // МАШИНА СОСТОЯНИЙ для ЮРИСТА: только легальные переходы вперёд. НЕТ перехода ИЗ
    // completed (иначе revert-примитив → повторная выплата эскроу). rejected/cancelled
    // недоступны здесь намеренно — у них отдельные эндпоинты с возвратом эскроу.
    // Админ не обходит lifecycle: принудительное завершение требует отдельного
    // evidence-aware процесса, а не универсального изменения статуса.
    // Юрист принимает заявку здесь. Старт/завершение разрешены только через
    // специализированные endpoints, где проверяется время и факт сессии.
    if (!policy.canTransition(req.userRole, consultation.status, req.body.status)) {
      return res.status(409).json({ error: 'Недопустимый переход статуса', code: 'INVALID_STATUS_TRANSITION' });
    }

    consultation.status = req.body.status;
    if (req.body.status === 'accepted' && !consultation.acceptedAt) {
      consultation.acceptedAt = new Date();
    }
    if (req.body.notes) consultation.notes = req.body.notes;
    await consultation.save();
    if (req.body.status === 'accepted' && consultation.meetingProvider === 'zoom') {
      setImmediate(() => zoomMeetingService.maybeProvision(consultation.id).catch(() => {}));
    }

    res.json({ consultation: serializeConsultation(consultation, req.userRole, new Date()) });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/:id — получить детали консультации
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    await expireReservationById(req.params.id);
    const serverNow = new Date();
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
        { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'startedAt', 'endedAt', 'lastSafeError'] },
        { model: Payment, as: 'payments', separate: true, attributes: ['id', 'amount', 'currency', 'status', 'refundStatus', 'refundedAt', 'escrowReleased', 'updatedAt'], order: [['createdAt', 'DESC']] },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    const chatEvidence = await bilateralChatEvidence([consultation]);
    const plain = serializeConsultation(consultation, req.userRole, serverNow, chatEvidence.has(consultation.id));
    const statusHistory = [{ status: 'created', at: plain.createdAt }];
    if (plain.acceptedAt) statusHistory.push({ status: 'accepted', at: plain.acceptedAt });
    if (plain.callStartedAt) statusHistory.push({ status: 'in_progress', at: plain.callStartedAt });
    if (!['payment_pending', 'pending', 'accepted', 'in_progress'].includes(plain.status)) {
      statusHistory.push({ status: plain.status, at: plain.cancelledAt || plain.updatedAt });
    }
    const documentsCount = await CaseDocument.count({ where: { consultationId: consultation.id } });
    res.json({
      consultation: plain,
      access: plain.policy,
      policy: plain.policy,
      payment: plain.payment,
      statusHistory,
      documents: { count: documentsCount },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/consultations/:id/archive — явный пользовательский архив.
router.patch('/:id/archive', authenticate, authorize('client'), async (req, res, next) => {
  try {
    if (typeof req.body.archived !== 'boolean') return res.status(400).json({ error: 'Поле archived должно быть boolean', code: 'INVALID_ARCHIVE_VALUE' });
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    if (consultation.clientId !== req.userId) return res.status(403).json({ error: 'Нет доступа' });
    if (!policy.ARCHIVABLE_STATUSES.includes(consultation.status)) {
      return res.status(409).json({ error: 'Активную консультацию нельзя архивировать', code: 'CONSULTATION_NOT_ARCHIVABLE' });
    }
    const changed = req.body.archived ? !consultation.archivedAt : Boolean(consultation.archivedAt);
    if (changed) await consultation.update({ archivedAt: req.body.archived ? new Date() : null });
    return res.json({ consultation: serializeConsultation(consultation, req.userRole, new Date()) });
  } catch (error) { return next(error); }
});

// POST /api/consultations/:id/join — присоединиться к консультации
router.post('/:id/join', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        { model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'] },
        { model: ConsultationMeeting, as: 'meeting', attributes: ['provider', 'status', 'scheduledAt', 'duration', 'startedAt', 'endedAt', 'lastSafeError'] },
        { model: Payment, as: 'payments', attributes: ['id', 'status', 'refundStatus'] },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    const access = policy.policyDto(consultation, req.userRole);
    if (!access.canJoin) {
      return res.status(403).json({ error: 'Подключение сейчас недоступно', code: access.reason, ...access });
    }

    // ВАЖНО: /join НЕ переводит в in_progress. Раньше это давало бэкдор —
    // юрист делал /join (pending/accepted → in_progress), затем /status=completed
    // и забирал эскроу без реального звонка. В in_progress переводит только
    // реальное соединение видеозвонка (video /start по peer-connect).
    res.json({ consultation: serializeConsultation(consultation, req.userRole, new Date()), access });
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

    await expireReservationById(req.params.id);
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
    if (consultation.status === 'payment_expired') return res.status(410).json({ error: 'Время резервирования оплаты истекло', code: 'PAYMENT_RESERVATION_EXPIRED' });
    if (consultation.archivedAt) return res.status(409).json({ error: 'Архивную консультацию нельзя перенести', code: 'CONSULTATION_ARCHIVED' });
    if (![30, 60, 90].includes(Number(consultation.duration))) return res.status(409).json({ error: 'Некорректная длительность консультации', code: 'INVALID_DURATION' });
    // Переносить можно только ещё не начатую/не завершённую консультацию
    if (!['pending', 'accepted'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Эту консультацию нельзя перенести' });
    }
    let window;
    let expiredReservation = false;
    try {
      await Consultation.sequelize.transaction(async (transaction) => {
        await availabilityService.lockBookingParticipants(consultation.lawyerId, consultation.clientId, transaction);
        const locked = await Consultation.findByPk(consultation.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (![locked.clientId, locked.lawyerId].includes(req.userId)) throw availabilityService.slotError('ACCESS_DENIED', 'Нет доступа', 403);
        if (locked.archivedAt || !['pending', 'accepted'].includes(locked.status)) {
          throw availabilityService.slotError('INVALID_STATUS', 'Эту консультацию нельзя перенести', 409);
        }
        if (await expireLockedReservation(locked, transaction)) {
          expiredReservation = true;
          return;
        }
        const profile = await LawyerProfile.findOne({ where: { userId: locked.lawyerId }, transaction, lock: transaction.LOCK.UPDATE });
        window = availabilityService.validateWindow(profile, preferredDate, preferredTime, locked.duration);
        await availabilityService.assertAvailable({
          lawyerId: locked.lawyerId, clientId: locked.clientId, window,
          excludeConsultationId: locked.id, transaction,
        });
        await locked.update({
          preferredDate, preferredTime, scheduledStartAt: window.start.toJSDate(),
          scheduledEndAt: window.end.toJSDate(), scheduleTimezone: window.timezone,
          reminderSent: false, reminder24Sent: false, reminder10Sent: false,
          lifecycleStatus: 'rescheduled',
          lawyerFirstJoinedAt: null, clientFirstJoinedAt: null, conversationStartedAt: null,
          callStartedAt: null, finalLeftAt: null, graceEndsAt: null,
          noShowCheckedAt: null, lawyerEndedAt: null, actualDuration: null,
        }, { transaction });
      });
    } catch (error) {
      if (error.code) return res.status(error.status || 409).json({ error: error.message, code: error.code });
      throw error;
    }
    if (expiredReservation) return res.status(410).json({ error: 'Время резервирования оплаты истекло', code: 'PAYMENT_RESERVATION_EXPIRED' });
    await consultation.reload();
    if (consultation.meetingProvider === 'zoom' && consultation.status === 'accepted') {
      const meeting = await ConsultationMeeting.findOne({ where: { consultationId: consultation.id }, attributes: ['status'] });
      if (meeting && ['ready', 'started'].includes(meeting.status)) zoomMeetingService.updateMeeting(consultation.id).catch(() => {});
    }

    // Уведомляем другую сторону
    const isClient = consultation.clientId === req.userId;
    const otherId = isClient ? consultation.lawyerId : consultation.clientId;
    const byName = (isClient ? consultation.client?.name : consultation.lawyer?.name) || 'Участник';
    notificationService.notifyConsultationRescheduled(otherId, byName, consultation);

    res.json({ consultation: serializeConsultation(consultation, req.userRole, new Date()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/cancel — отменить
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Укажите причину отмены', code: 'CANCELLATION_REASON_REQUIRED' });
    if (reason.length > 1000) return res.status(400).json({ error: 'Причина отмены слишком длинная', code: 'CANCELLATION_REASON_TOO_LONG' });
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (req.userRole !== 'admin' && consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Атомарный переход в cancelled ТОЛЬКО из отменяемых статусов. Это одновременно:
    // (а) запрещает отмену completed/cancelled/in_progress (в т.ч. после оказанной
    // услуги), (б) исключает гонку двойного клика — только один запрос выиграет
    // переход, поэтому возврат эскроу выполнится ровно один раз.
    const cancelled = await Consultation.sequelize.transaction(async (transaction) => {
      const locked = await Consultation.findByPk(consultation.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!locked || !['payment_pending', 'pending', 'accepted'].includes(locked.status)) return false;
      const cancelledBy = req.userRole === 'lawyer' ? 'lawyer' : req.userRole === 'admin' ? 'admin' : 'client';
      await locked.update({
        status: 'cancelled', lifecycleStatus: 'cancelled', cancelledAt: new Date(), cancelledBy,
        cancellationType: `${cancelledBy}_cancelled`, cancellationReason: reason,
      }, { transaction });
      await refundConsultationEscrow(locked.id, {
        transaction, actorUserId: req.userId, source: req.userRole || 'client', reason,
      });
      if (locked.promoCode && locked.promoReservedAt) {
        await Promo.increment('usedCount', {
          by: -1,
          where: { code: locked.promoCode, usedCount: { [Op.gt]: 0 } },
          transaction,
        });
        locked.promoReservedAt = null;
        await locked.save({ fields: ['promoReservedAt'], transaction });
      }
      return true;
    });
    if (!cancelled) {
      return res.status(409).json({ error: 'Эта консультация уже завершена или отменена', code: 'CONSULTATION_NOT_CANCELLABLE' });
    }

    await consultation.reload();

    // Notify the other party about cancellation
    const canceller = await User.findByPk(req.userId, { attributes: ['name'] });
    const recipients = req.userRole === 'admin'
      ? [consultation.clientId, consultation.lawyerId]
      : [consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId];
    await Promise.all(recipients.map((userId) => notificationService.notifyConsultationCancelled(userId, canceller?.name || 'Пользователь', consultation)));
    if (consultation.meetingProvider === 'zoom') zoomMeetingService.cancelMeeting(consultation.id).catch(() => {});

    res.json({ message: 'Консультация отменена', consultation: serializeConsultation(consultation, req.userRole, new Date()) });
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
    // Evidence and final status are checked under the same row lock as completion.
    const outcome = await completeConsultation(consultation.id, undefined, undefined, {
      precondition: async (locked, transaction) => {
        if (locked.clientId !== req.userId) throw Object.assign(new Error('Нет доступа'), { status: 403 });
        if (['no_show_lawyer', 'no_show_client', 'no_show_both'].includes(locked.lifecycleStatus)) {
          const code = locked.lifecycleStatus === 'no_show_both' ? 'BOTH_NO_SHOW' : locked.lifecycleStatus === 'no_show_lawyer' ? 'LAWYER_NO_SHOW' : 'CLIENT_NO_SHOW';
          throw Object.assign(new Error('Отмечена неявка участника. Обратитесь за переносом или возвратом.'), { status: 409, code });
        }
        if (locked.type === 'chat') {
          const senders = await Message.findAll({ where: { consultationId: locked.id }, attributes: ['senderId'], group: ['senderId'], raw: true, transaction });
          const senderIds = new Set(senders.map((item) => item.senderId));
          if (!senderIds.has(locked.clientId) || !senderIds.has(locked.lawyerId)) {
            throw Object.assign(new Error('Для завершения нужен обмен сообщениями'), { status: 409, code: 'SESSION_EVIDENCE_REQUIRED' });
          }
          if (locked.status !== 'in_progress') {
            throw Object.assign(new Error('Завершить можно только начатую консультацию'), { status: 409, code: 'CONSULTATION_NOT_STARTED' });
          }
          return;
        }
        const now = new Date();
        if (!policy.validSchedule(locked) || new Date(locked.scheduledStartAt) > now) {
          throw Object.assign(new Error('Консультация ещё не началась'), { status: 409, code: 'CONSULTATION_NOT_STARTED' });
        }
        if (locked.meetingProvider === 'zoom' && !locked.conversationStartedAt) {
          throw Object.assign(new Error('Посещение обоих участников не подтверждено'), { status: 409, code: 'ATTENDANCE_UNVERIFIED' });
        }
        if (locked.meetingProvider !== 'zoom' && ['video', 'phone', 'audio'].includes(locked.type)
          && (!locked.callStartedAt || !await hasBilateralPeerEvidence(locked.id, transaction))) {
          throw Object.assign(new Error('Нет подтверждения начала звонка'), { status: 409, code: 'SESSION_EVIDENCE_REQUIRED' });
        }
        if (locked.status !== 'in_progress') {
          throw Object.assign(new Error('Завершить можно только начатую консультацию'), { status: 409, code: 'CONSULTATION_NOT_STARTED' });
        }
      },
    });
    if (!outcome.consultation) return res.status(404).json({ error: 'Консультация не найдена' });
    if (!outcome.alreadyCompleted && outcome.consultation.status !== 'completed') {
      return res.status(409).json({ error: 'Консультация уже отменена или недоступна для завершения', code: 'INVALID_STATUS_TRANSITION' });
    }
    const updated = outcome.consultation;

    // Уведомляем юриста о завершении
    if (!outcome.alreadyCompleted) {
      const client = await User.findByPk(req.userId, { attributes: ['name'] });
      notificationService.notifyConsultationCompleted(updated.lawyerId, client?.name || 'Клиент', updated);
    }

    res.json({ message: 'Консультация завершена', consultation: serializeConsultation(updated, req.userRole, new Date()) });
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

module.exports = router;
