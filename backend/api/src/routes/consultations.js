const router = require('express').Router();
const { Op } = require('sequelize');
const { Consultation, User, LawyerProfile, Payment, Review, Promo } = require('../models');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { completeConsultation } = require('../services/escrow');
const { releaseSubscriptionBenefitConsumption } = require('../services/ledgerService');
const { requestPaymentCancellation } = require('../services/paymentService');
const { toConsultationDto } = require('../services/consultationDto');

const sharedConsultationAccess = authorizeCompat({
  legacyRoles: ['client', 'lawyer'],
  capability: { client: 'client', lawyer: 'lawyer' },
  telemetryName: 'http.consultation-participant',
});
const clientAccess = authorizeCompat({ legacyRoles: ['client', 'lawyer'], capability: 'client', telemetryName: 'http.client' });
const lawyerOrAdminAccess = authorizeCompat({
  legacyRoles: ['lawyer', 'admin'],
  capability: { lawyer: 'lawyer', admin: 'admin' },
  telemetryName: 'http.consultation-operator',
});

function ownsConsultationPerspective(req, consultation) {
  if (req.accountMode === 'client') return consultation.clientId === req.userId;
  if (req.accountMode === 'lawyer') return consultation.lawyerId === req.userId;
  return false;
}

// GET /api/consultations — мои консультации
router.get('/', authenticate, sharedConsultationAccess, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (req.accountMode === 'client') where.clientId = req.userId;
    if (req.accountMode === 'lawyer') where.lawyerId = req.userId;
    if (status && status !== 'all') where.status = status;

    const { count, rows } = await Consultation.findAndCountAll({
      where,
      include: [
        // Контакты (email) НЕ отдаём — защита от обхода платформы (как в каталоге/чате)
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
        // Единственный источник правды по оценке консультации — таблица Review.
        // Его наличие = консультация оценена (клиент видит это как «Архив»).
        { model: Review, as: 'consultationReview', attributes: ['id', 'rating', 'text'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      consultations: rows.map((row) => toConsultationDto(row, { perspective: req.accountMode })),
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/upcoming — предстоящие
router.get('/upcoming', authenticate, sharedConsultationAccess, async (req, res, next) => {
  try {
    const where = {
      status: { [Op.in]: ['accepted', 'in_progress'] },
    };
    if (req.accountMode === 'client') where.clientId = req.userId;
    if (req.accountMode === 'lawyer') where.lawyerId = req.userId;

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

    res.json(consultations.map((row) => toConsultationDto(row, { perspective: req.accountMode })));
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/loyalty — статус акции «каждая 3-я бесплатно»
// ВАЖНО: объявлено выше GET /:id, иначе "loyalty" попадёт в параметр :id
router.get('/loyalty', authenticate, clientAccess, async (req, res, next) => {
  try {
    const { computeLoyalty } = require('../services/loyaltyService');
    const loyalty = await computeLoyalty(req.userId);
    res.json(loyalty);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/consultations/:id/status — изменить статус (юрист/админ)
router.patch('/:id/status', authenticate, lawyerOrAdminAccess, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (req.accountMode === 'lawyer' && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // БЕЗОПАСНОСТЬ: разрешаем только валидные целевые статусы, а не произвольный enum.
    // payment_pending/pending — системные (оплата), их через этот роут ставить нельзя.
    const ALLOWED_STATUS = ['accepted', 'rejected', 'in_progress', 'completed', 'cancelled'];
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
    if (req.accountMode === 'lawyer') {
      const allowed = LAWYER_TRANSITIONS[consultation.status] || [];
      if (!allowed.includes(req.body.status)) {
        return res.status(400).json({ error: 'Недопустимый переход статуса' });
      }
    }

    // Завершение — через единый идемпотентный хелпер (высвобождает эскроу один раз).
    if (req.body.status === 'completed') {
      // ДЕНЬГИ: юрист может завершить (и высвободить эскроу) только начатую консультацию.
      // Админ — может форсировать (модерация/разбор спора).
      if (req.accountMode === 'lawyer' && consultation.status !== 'in_progress') {
        return res.status(400).json({ error: 'Сначала начните консультацию, затем завершайте' });
      }
      const { consultation: updated } = await completeConsultation(consultation.id, req.body.notes);
      return res.json({ consultation: toConsultationDto(updated, { perspective: req.accountMode }) });
    }

    consultation.status = req.body.status;
    if (req.body.notes) consultation.notes = req.body.notes;
    await consultation.save();

    res.json({ consultation: toConsultationDto(consultation, { perspective: req.accountMode }) });
  } catch (err) {
    next(err);
  }
});

// GET /api/consultations/:id — получить детали консультации
router.get('/:id', authenticate, sharedConsultationAccess, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id, {
      include: [
        { model: User, as: 'client', attributes: ['id', 'name', 'avatar'] },
        {
          model: User,
          as: 'lawyer',
          attributes: ['id', 'name', 'avatar'],
          include: [{ model: LawyerProfile, as: 'profile' }],
        },
      ],
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    res.json({ consultation: toConsultationDto(consultation, { perspective: req.accountMode }) });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/join — присоединиться к консультации
router.post('/:id/join', authenticate, sharedConsultationAccess, async (req, res, next) => {
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

    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Нет доступа к этой консультации' });
    }

    // ВАЖНО: /join НЕ переводит в in_progress. Раньше это давало бэкдор —
    // юрист делал /join (pending/accepted → in_progress), затем /status=completed
    // и забирал эскроу без реального звонка. В in_progress переводит только
    // реальное соединение видеозвонка (video /start по peer-connect).
    res.json({ consultation: toConsultationDto(consultation, { perspective: req.accountMode }) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/consultations/:id/reschedule — перенос времени (клиент или юрист)
router.patch('/:id/reschedule', authenticate, sharedConsultationAccess, async (req, res, next) => {
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

    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    // Переносить можно только ещё не начатую/не завершённую консультацию
    if (!['payment_pending', 'pending', 'accepted'].includes(consultation.status)) {
      return res.status(400).json({ error: 'Эту консультацию нельзя перенести' });
    }
    // Не в прошлое
    const start = new Date(`${preferredDate}T${preferredTime}:00`);
    if (isNaN(start.getTime()) || start < new Date()) {
      return res.status(400).json({ error: 'Выберите время в будущем' });
    }

    consultation.preferredDate = preferredDate;
    consultation.preferredTime = preferredTime;
    consultation.reminderSent = false; // напоминание сработает на новое время
    await consultation.save();

    // Уведомляем другую сторону
    const isClient = req.accountMode === 'client';
    const otherId = isClient ? consultation.lawyerId : consultation.clientId;
    const byName = (isClient ? consultation.client?.name : consultation.lawyer?.name) || 'Участник';
    notificationService.notifyConsultationRescheduled(otherId, byName, consultation);

    res.json({ consultation: toConsultationDto(consultation, { perspective: req.accountMode }) });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/cancel — отменить
router.post('/:id/cancel', authenticate, sharedConsultationAccess, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.id);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (!ownsConsultationPerspective(req, consultation)) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Атомарный переход в cancelled ТОЛЬКО из отменяемых статусов. Это одновременно:
    // (а) запрещает отмену completed/cancelled/in_progress (в т.ч. после оказанной
    // услуги), (б) исключает гонку двойного клика — только один запрос выиграет
    // переход, поэтому возврат эскроу выполнится ровно один раз.
    const cancellation = await Consultation.sequelize.transaction(async (tx) => {
      const payments = await Payment.findAll({
        where: {
          consultationId: consultation.id,
          status: { [Op.in]: ['pending', 'processing', 'paid', 'refund_pending'] },
          escrowReleased: false,
        },
        order: [['id', 'ASC']],
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      const lockedConsultation = await Consultation.findByPk(consultation.id, {
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (!lockedConsultation || !['payment_pending', 'pending', 'accepted'].includes(lockedConsultation.status)) {
        return { affected: 0, cancellationRequested: false };
      }
      await lockedConsultation.update({
        status: 'cancelled',
        notes: req.body.reason || 'Отменено пользователем',
      }, { transaction: tx });
      let cancellationRequested = false;
      for (const payment of payments) {
        const result = await requestPaymentCancellation({
          paymentId: payment.id,
          requestedBy: req.userId,
          reason: req.body.reason || 'consultation_user_cancelled',
          transaction: tx,
        });
        if (result.outcome === 'cancellation_requested') cancellationRequested = true;
      }
      if (consultation.freeSource === 'subscription') {
        await releaseSubscriptionBenefitConsumption(consultation.clientId, consultation.id, tx);
      }
      return { affected: 1, cancellationRequested };
    });
    if (cancellation.affected === 0) {
      return res.status(400).json({ error: 'Эту консультацию нельзя отменить' });
    }

    // Возвращаем использование промокода, если он применялся к этой брони
    // (иначе usedCount сгорал на отменённых бронях).
    if (consultation.promoCode) {
      const { literal } = require('sequelize');
      await Promo.increment('usedCount', {
        by: -1,
        where: { code: consultation.promoCode, usedCount: { [Op.gt]: 0 } },
      });
    }

    await consultation.reload();

    // Notify the other party about cancellation
    const canceller = await User.findByPk(req.userId, { attributes: ['name'] });
    const otherUserId = consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId;
    notificationService.notifyConsultationCancelled(otherUserId, canceller?.name || 'Пользователь', consultation);

    res.status(cancellation.cancellationRequested ? 202 : 200).json({
      message: cancellation.cancellationRequested
        ? 'Отмена платежа запрошена у провайдера'
        : 'Консультация отменена',
      cancellationStatus: cancellation.cancellationRequested ? 'cancellation_requested' : 'cancelled',
      consultation: toConsultationDto(consultation, { perspective: req.accountMode }),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/consultations/:id/complete — клиент завершает сеанс.
// Разрешено только для активной консультации (accepted/in_progress).
// При завершении высвобождается эскроу: pendingBalance → balance юриста.
router.post('/:id/complete', authenticate, clientAccess, async (req, res, next) => {
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

    res.json({
      message: 'Консультация завершена',
      consultation: toConsultationDto(updated, { perspective: req.accountMode }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
