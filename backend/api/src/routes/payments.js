const router = require('express').Router();
const logger = require('../config/logger');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Payment, Consultation, User, LawyerProfile, Withdrawal, FinancialEvent, Promo } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { isPaymentReservationExpired } = require('../services/availabilityService');
const { expireLockedReservation, expireReservationById } = require('../services/reservationExpiryService');
const { safePayment } = require('../services/clientCabinetSerializers');

// ─── Payme JSON-RPC Error Codes ───────────────────────────────
const ERRORS = {
  PARSE_ERROR:         { code: -32700, message: 'Parse error' },
  METHOD_NOT_FOUND:    { code: -32601, message: 'Method not found' },
  INVALID_AMOUNT:      { code: -31001, message: 'Wrong amount' },
  TRANSACTION_NOT_FOUND: { code: -31003, message: 'Transaction not found' },
  CANT_PERFORM:        { code: -31008, message: 'Unable to perform operation' },
  CANT_CANCEL:         { code: -31007, message: 'Unable to cancel transaction' },
  ALREADY_DONE:        { code: -31060, message: 'Transaction already completed' },
  ALREADY_CANCELLED:   { code: -31061, message: 'Transaction already cancelled' },
};
const paymeConfigured = () => {
  const key = String(process.env.PAYME_KEY || '').trim();
  const merchant = String(process.env.PAYME_MERCHANT_ID || '').trim();
  return Boolean(key && key !== 'CHANGE_ME' && merchant && merchant !== 'CHANGE_ME');
};
const paymentError = (status, error, code) => Object.assign(new Error(error), { status, code });

// ─── Payme Basic Auth Middleware ─────────────────────────────
const verifyPayme = (req, res, next) => {
  if (!paymeConfigured()) {
    return res.status(503).json({ jsonrpc: '2.0', id: req.body?.id || null, error: ERRORS.CANT_PERFORM });
  }
  const auth = req.headers.authorization || '';
  const b64 = auth.startsWith('Basic ') ? auth.slice(6) : '';
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  const separator = decoded.indexOf(':');
  const key = separator >= 0 ? decoded.slice(separator + 1) : '';
  const actual = Buffer.from(key);
  const expected = Buffer.from(process.env.PAYME_KEY);
  const valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);

  if (!valid) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: { code: -32504, message: 'Insufficient privilege to perform this method' },
    });
  }
  next();
};

// ─── POST /api/payments/create ────────────────────────────────
// Клиент бронирует → создаём Payment + Payme checkout URL
router.post('/create', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const { consultationId } = req.body;
    const merchantId = String(process.env.PAYME_MERCHANT_ID || '').trim();
    if (!paymeConfigured()) {
      return res.status(503).json({ error: 'Оплата Payme временно недоступна' });
    }

    const result = await sequelize.transaction(async (transaction) => {
      const consultation = await Consultation.findOne({
        where: { id: consultationId, clientId: req.userId }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!consultation) throw paymentError(404, 'Консультация не найдена');
      if (consultation.status === 'payment_expired') throw paymentError(410, 'Время резервирования слота истекло', 'PAYMENT_RESERVATION_EXPIRED');
      if (consultation.status !== 'payment_pending') throw paymentError(400, 'Консультация уже оплачена или отменена');
      let payment = await Payment.findOne({
        where: { consultationId, provider: 'payme' }, order: [['createdAt', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
      });
      if (await expireLockedReservation(consultation, transaction)) {
        return { expired: true };
      }
      if (payment?.status === 'paid') throw paymentError(400, 'Консультация уже оплачена');
      const amount = consultation.price;
      const reused = Boolean(payment);
      if (payment?.status === 'failed') {
        await payment.update({ status: 'pending', amount, transactionId: null, providerResponse: null }, { transaction });
      } else if (!payment) {
        payment = await Payment.create({
          consultationId, userId: req.userId, amount, currency: 'UZS', provider: 'payme', status: 'pending',
        }, { transaction });
      }
      return { payment, amount, reused };
    });

    const { payment, amount, reused } = result;
    if (result.expired) {
      return res.status(410).json({ error: 'Время резервирования слота истекло. Забронируйте заново.', code: 'PAYMENT_RESERVATION_EXPIRED' });
    }
    const amountTiyin = amount * 100;  // Payme работает в тийинах

    // Payme checkout URL
    // Формат: account[consultation_id]=ID&amount=TIYIN
    const params = Buffer.from(
      `m=${merchantId};ac.consultation_id=${payment.id};a=${amountTiyin}`
    ).toString('base64');

    const checkoutUrl = `https://checkout.paycom.uz/${params}`;

    res.json({ paymentId: payment.id, checkoutUrl, amount, amountTiyin, reused });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
});

// ─── POST /api/payments/simulate ──────────────────────────────
// ТЕСТОВАЯ оплата без реального Payme. Повторяет ветку PerformTransaction
// вебхука: помечает платёж оплаченным, переводит консультацию в pending,
// начисляет юристу pendingBalance и уведомляет его.
// БЕЗОПАСНОСТЬ: в проде отключён ВСЕГДА (fail-closed по NODE_ENV), даже если забыли
// задать PAYME_KEY — иначе любой клиент оплачивал бы консультации бесплатно.
// Работает только в dev/test И когда не подключён реальный Payme.
router.post('/simulate', authenticate, authorize('client'), async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.PAYME_KEY) {
      return res.status(403).json({ error: 'Тестовая оплата недоступна в этом режиме' });
    }

    const { consultationId } = req.body;
    const outcome = await sequelize.transaction(async (transaction) => {
      const consultation = await Consultation.findOne({
        where: { id: consultationId, clientId: req.userId }, transaction, lock: transaction.LOCK.UPDATE,
      });
      if (!consultation) throw paymentError(404, 'Консультация не найдена');
      let payment = await Payment.findOne({
        where: { consultationId, provider: 'payme' }, order: [['createdAt', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
      });
      if (consultation.status !== 'payment_pending') {
        if (consultation.status === 'payment_expired') throw paymentError(410, 'Время резервирования слота истекло', 'PAYMENT_RESERVATION_EXPIRED');
        if (consultation.status === 'pending' && payment?.status === 'paid') return { consultation, payment, performed: false };
        throw paymentError(400, 'Консультацию нельзя оплатить (уже оплачена или отменена)');
      }
      if (await expireLockedReservation(consultation, transaction)) {
        return { expired: true };
      }
      if (!payment) {
        payment = await Payment.create({
          consultationId, userId: req.userId, amount: consultation.price,
          currency: 'UZS', provider: 'payme', status: 'pending',
        }, { transaction });
      }
      if (payment.status === 'paid') {
        await consultation.update({ status: 'pending', lifecycleStatus: 'confirmed' }, { transaction });
        return { consultation, payment, performed: false };
      }
      const lawyerProfile = await LawyerProfile.findOne({
        where: { userId: consultation.lawyerId }, transaction, lock: transaction.LOCK.UPDATE,
      });
      await payment.update({ status: 'paid', providerResponse: { test: true, paidAt: Date.now() } }, { transaction });
      await consultation.update({ status: 'pending', lifecycleStatus: 'confirmed' }, { transaction });
      if (lawyerProfile) await lawyerProfile.increment('pendingBalance', { by: payment.amount, transaction });
      return { consultation, payment, performed: true };
    });

    if (outcome.expired) {
      return res.status(410).json({ error: 'Время резервирования слота истекло. Забронируйте заново.', code: 'PAYMENT_RESERVATION_EXPIRED' });
    }

    // Уведомляем юриста об оплаченной консультации
    if (outcome.performed) {
      await notificationService.createNotification(
        outcome.consultation.lawyerId, 'new_booking', 'Новая консультация',
        'Клиент оплатил консультацию. Подтвердите или отклоните.',
        { consultationId: outcome.consultation.id },
      );
    }

    res.json({ success: true, message: 'Оплата прошла', paymentId: outcome.payment.id, alreadyPaid: !outcome.performed });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    next(err);
  }
});

// ─── POST /api/payments/webhook ───────────────────────────────
// Payme JSON-RPC 2.0 webhook
router.post('/webhook', verifyPayme, async (req, res) => {
  const { method, params, id } = req.body;

  const reply = (result) => res.json({ jsonrpc: '2.0', id, result });
  const replyError = (error) => res.json({ jsonrpc: '2.0', id, error });

  try {
    switch (method) {

      // ── CheckPerformTransaction ────────────────────────────
      case 'CheckPerformTransaction': {
        const payment = await Payment.findOne({
          where: { id: params.account.consultation_id, provider: 'payme' },
          include: [{ model: Consultation }],
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const expectedTiyin = payment.amount * 100;
        if (params.amount !== expectedTiyin) return replyError(ERRORS.INVALID_AMOUNT);

        if (payment.status !== 'pending') return replyError(ERRORS.CANT_PERFORM);
        if (!payment.Consultation || payment.Consultation.status !== 'payment_pending') return replyError(ERRORS.CANT_PERFORM);
        if (isPaymentReservationExpired(payment.Consultation)) {
          await expireReservationById(payment.Consultation.id);
          return replyError(ERRORS.CANT_PERFORM);
        }

        return reply({ allow: true });
      }

      // ── CreateTransaction ──────────────────────────────────
      case 'CreateTransaction': {
        const initial = await Payment.findOne({
          where: { id: params.account.consultation_id, provider: 'payme' },
        });
        if (!initial) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const outcome = await sequelize.transaction(async (transaction) => {
          const consultation = await Consultation.findByPk(initial.consultationId, {
            transaction, lock: transaction.LOCK.UPDATE,
          });
          const payment = await Payment.findOne({
            where: { id: initial.id, provider: 'payme' },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!payment || !consultation) return { error: ERRORS.TRANSACTION_NOT_FOUND };
          if (params.amount !== Number(payment.amount) * 100) return { error: ERRORS.INVALID_AMOUNT };
          if (payment.status === 'paid') return { error: ERRORS.ALREADY_DONE };
          if (payment.status === 'failed' || consultation.status !== 'payment_pending') return { error: ERRORS.CANT_PERFORM };
          if (await expireLockedReservation(consultation, transaction)) {
            return { error: ERRORS.CANT_PERFORM };
          }
          if (payment.transactionId && payment.transactionId !== params.id) return { error: ERRORS.CANT_PERFORM };

          const createTime = payment.providerResponse?.createTime || params.time;
          if (!payment.transactionId) {
            await payment.update({
              transactionId: params.id,
              providerResponse: { ...payment.providerResponse, createTime },
            }, { transaction });
          }
          return { result: { create_time: createTime, transaction: payment.id, state: 1 } };
        });

        return outcome.error ? replyError(outcome.error) : reply(outcome.result);
      }

      // ── PerformTransaction ─────────────────────────────────
      case 'PerformTransaction': {
        const initial = await Payment.findOne({
          where: { transactionId: params.id, provider: 'payme' },
        });
        if (!initial) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const outcome = await sequelize.transaction(async (transaction) => {
          // Единый порядок блокировок во всех денежных сценариях уменьшает риск deadlock.
          const consultation = await Consultation.findByPk(initial.consultationId, {
            transaction, lock: transaction.LOCK.UPDATE,
          });
          const payment = await Payment.findOne({
            where: { transactionId: params.id, provider: 'payme' },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!payment || !consultation) return { error: ERRORS.TRANSACTION_NOT_FOUND };

          if (payment.status === 'paid') {
            return {
              result: {
                perform_time: payment.providerResponse?.performTime || 0,
                transaction: payment.id,
                state: 2,
              },
              performed: false,
            };
          }
          if (payment.status === 'failed' || consultation.status !== 'payment_pending') {
            return { error: ERRORS.CANT_PERFORM };
          }
          if (await expireLockedReservation(consultation, transaction)) {
            return { error: ERRORS.CANT_PERFORM };
          }

          const lawyerProfile = await LawyerProfile.findOne({
            where: { userId: consultation.lawyerId },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!lawyerProfile) return { error: ERRORS.CANT_PERFORM };

          const performTime = Date.now();
          await payment.update({
            status: 'paid',
            providerResponse: { ...payment.providerResponse, performTime },
          }, { transaction });
          await consultation.update({ status: 'pending', lifecycleStatus: 'confirmed' }, { transaction });
          await lawyerProfile.increment('pendingBalance', { by: Number(payment.amount), transaction });

          return {
            result: { perform_time: performTime, transaction: payment.id, state: 2 },
            performed: true,
            lawyerId: consultation.lawyerId,
            consultationId: consultation.id,
          };
        });

        if (outcome.error) return replyError(outcome.error);
        if (outcome.performed) {
          try {
            await notificationService.createNotification(
              outcome.lawyerId,
              'new_booking',
              'Новая консультация',
              'Клиент оплатил консультацию. Подтвердите или отклоните.',
              { consultationId: outcome.consultationId }
            );
          } catch (notificationError) {
            logger.error('Payme payment notification failed', { message: notificationError.message });
          }
        }

        return reply(outcome.result);
      }

      // ── CancelTransaction ──────────────────────────────────
      case 'CancelTransaction': {
        const initial = await Payment.findOne({
          where: { transactionId: params.id, provider: 'payme' },
        });
        if (!initial) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const outcome = await sequelize.transaction(async (transaction) => {
          const consultation = await Consultation.findByPk(initial.consultationId, {
            transaction, lock: transaction.LOCK.UPDATE,
          });
          const payment = await Payment.findOne({
            where: { transactionId: params.id, provider: 'payme' },
            transaction, lock: transaction.LOCK.UPDATE,
          });
          if (!payment || !consultation) return { error: ERRORS.TRANSACTION_NOT_FOUND };
          if (payment.status === 'refunded') {
            return { result: { cancel_time: payment.providerResponse?.cancelTime || 0, transaction: payment.id, state: -2 } };
          }
          if (payment.status === 'paid') {
            if (payment.escrowReleased || ['in_progress', 'completed'].includes(consultation.status)) return { error: ERRORS.CANT_CANCEL };
            if (payment.refundStatus === 'none') {
              const lawyerProfile = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId }, transaction, lock: transaction.LOCK.UPDATE });
              if (!lawyerProfile || Number(lawyerProfile.pendingBalance) < Number(payment.amount)) return { error: ERRORS.CANT_CANCEL };
              await lawyerProfile.decrement('pendingBalance', { by: Number(payment.amount), transaction });
              await FinancialEvent.findOrCreate({
                where: { idempotencyKey: `refund_requested:${payment.id}` },
                defaults: {
                  consultationId: consultation.id, paymentId: payment.id, actorUserId: null,
                  source: 'payme', type: 'refund_requested', amount: payment.amount,
                  idempotencyKey: `refund_requested:${payment.id}`, metadata: { rpcId: id },
                }, transaction,
              });
            }
            const transitioned = ['payment_pending', 'pending', 'accepted'].includes(consultation.status);
            if (transitioned) {
              await consultation.update({
                status: 'cancelled', lifecycleStatus: 'cancelled', cancelledAt: new Date(), cancelledBy: 'system',
                cancellationType: 'provider_cancelled', cancellationReason: String(params.reason ?? '') || null,
              }, { transaction });
              if (consultation.promoCode && consultation.promoReservedAt) {
                await Promo.increment('usedCount', { by: -1, where: { code: consultation.promoCode, usedCount: { [Op.gt]: 0 } }, transaction });
                await consultation.update({ promoReservedAt: null }, { transaction });
              }
            }
            const cancelTime = Date.now();
            await payment.update({
              status: 'refunded', refundStatus: 'completed', refundedAt: new Date(cancelTime),
              providerResponse: { ...payment.providerResponse, cancelTime, reason: params.reason },
            }, { transaction });
            await FinancialEvent.findOrCreate({
              where: { idempotencyKey: `refund_confirmed:${payment.id}` },
              defaults: {
                consultationId: consultation.id, paymentId: payment.id, source: 'payme',
                type: 'refund_confirmed', amount: payment.amount,
                idempotencyKey: `refund_confirmed:${payment.id}`,
                metadata: { reason: params.reason, rpcId: id },
              },
              transaction,
            });
            return {
              result: { cancel_time: cancelTime, transaction: payment.id, state: -2 },
              cancelledConsultationId: transitioned ? consultation.id : null,
              notifyParticipants: transitioned ? { clientId: consultation.clientId, lawyerId: consultation.lawyerId } : null,
            };
          }
          if (payment.status === 'failed') {
            return {
              result: {
                cancel_time: payment.providerResponse?.cancelTime || 0,
                transaction: payment.id,
                state: -1,
              },
            };
          }
          if (consultation.status !== 'payment_pending') return { error: ERRORS.CANT_PERFORM };

          const cancelTime = Date.now();
          await payment.update({
            status: 'failed',
            providerResponse: { ...payment.providerResponse, cancelTime, reason: params.reason },
          }, { transaction });
          await consultation.update({
            status: 'cancelled', lifecycleStatus: 'cancelled', cancelledAt: new Date(), cancelledBy: 'system',
            cancellationType: 'provider_cancelled', cancellationReason: String(params.reason ?? '') || null,
          }, { transaction });
          if (consultation.promoCode && consultation.promoReservedAt) {
            await Promo.increment('usedCount', { by: -1, where: { code: consultation.promoCode, usedCount: { [Op.gt]: 0 } }, transaction });
            await consultation.update({ promoReservedAt: null }, { transaction });
          }
          return {
            result: { cancel_time: cancelTime, transaction: payment.id, state: -1 },
            cancelledConsultationId: consultation.id,
            notifyParticipants: { clientId: consultation.clientId, lawyerId: consultation.lawyerId },
          };
        });

        if (outcome.cancelledConsultationId) {
          require('../services/zoomMeetingService').cancelMeeting(outcome.cancelledConsultationId).catch(() => {});
          const cancelled = await Consultation.findByPk(outcome.cancelledConsultationId);
          try {
            await Promise.all([outcome.notifyParticipants.clientId, outcome.notifyParticipants.lawyerId].map((userId) =>
              notificationService.notifyConsultationCancelled(userId, 'Payme', cancelled)));
          } catch (notificationError) {
            logger.error('Payme cancellation notification failed', { consultationId: outcome.cancelledConsultationId, message: notificationError.message });
          }
        }
        return outcome.error ? replyError(outcome.error) : reply(outcome.result);
      }

      // ── CheckTransaction ───────────────────────────────────
      case 'CheckTransaction': {
        const payment = await Payment.findOne({ where: { provider: 'payme', transactionId: params.id } });
        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const stateMap = { pending: 1, paid: 2, failed: -1, refunded: -2 };
        return reply({
          create_time: payment.providerResponse?.createTime || 0,
          perform_time: payment.providerResponse?.performTime || 0,
          cancel_time: payment.providerResponse?.cancelTime || 0,
          transaction: payment.id,
          state: stateMap[payment.status] || 1,
          reason: payment.providerResponse?.reason || null,
        });
      }

      // ── GetStatement ───────────────────────────────────────
      case 'GetStatement': {
        const from = Number(params.from);
        const to = Number(params.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 31 * 24 * 60 * 60 * 1000) {
          return replyError(ERRORS.CANT_PERFORM);
        }
        // createTime лежит в providerResponse JSONB. Сначала жёстко ограничиваем
        // выборку индексируемым createdAt (с запасом на часы провайдера), затем
        // применяем точный Payme-диапазон в памяти к уже малому набору.
        const day = 24 * 60 * 60 * 1000;
        const payments = await Payment.findAll({
          where: {
            provider: 'payme',
            transactionId: { [Op.ne]: null },
            createdAt: { [Op.between]: [new Date(from - day), new Date(to + day)] },
          },
          order: [['createdAt', 'ASC']],
        });

        const stateMap = { pending: 1, paid: 2, failed: -1, refunded: -2 };
        const inRange = payments.filter((payment) => {
          const createTime = Number(payment.providerResponse?.createTime || payment.createdAt.getTime());
          return createTime >= from && createTime <= to;
        });
        return reply({
          transactions: inRange.map((p) => ({
            id: p.transactionId,
            time: p.providerResponse?.createTime || p.createdAt.getTime(),
            amount: p.amount * 100,
            account: { consultation_id: p.id },
            create_time: p.providerResponse?.createTime || p.createdAt.getTime(),
            perform_time: p.providerResponse?.performTime || 0,
            cancel_time: p.providerResponse?.cancelTime || 0,
            transaction: p.id,
            state: stateMap[p.status] || 1,
            reason: p.providerResponse?.reason || null,
          })),
        });
      }

      default:
        return replyError(ERRORS.METHOD_NOT_FOUND);
    }
  } catch (err) {
    logger.error('Payme webhook error:', err);
    return replyError(ERRORS.CANT_PERFORM);
  }
});

// ─── GET /api/payments/my ─────────────────────────────────────
// История платежей текущего пользователя
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const paged = req.query.page !== undefined || req.query.limit !== undefined;
    const where = { userId: req.userId };
    if (req.query.status && ['pending', 'paid', 'failed', 'refunded'].includes(req.query.status)) where.status = req.query.status;
    if (req.query.status === 'refunds') where.refundStatus = { [Op.in]: ['requested', 'completed', 'failed'] };
    if (req.query.status === 'paid') where.refundStatus = { [Op.in]: ['none', null] };
    if (req.query.provider && ['payme', 'click', 'uzcard'].includes(req.query.provider)) where.provider = req.query.provider;
    if (req.query.from || req.query.to) {
      const from = req.query.from ? new Date(req.query.from) : null;
      const to = req.query.to ? new Date(req.query.to) : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return res.status(400).json({ error: 'Некорректный диапазон дат' });
      where.createdAt = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
    }
    const query = {
      where,
      include: [{
        model: Consultation,
        attributes: ['id', 'type', 'status', 'paymentExpiresAt', 'preferredDate', 'preferredTime'],
        include: [{ model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'] }],
      }],
      order: [['createdAt', 'DESC']],
    };
    if (paged) Object.assign(query, { limit, offset: (page - 1) * limit });
    const { rows, count } = await Payment.findAndCountAll(query);
    const payments = rows.map(safePayment);
    res.json(paged ? { payments, page, limit, total: count, totalPages: Math.ceil(count / limit) } : payments);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/status', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ where: { id: req.params.id, userId: req.userId } });
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    res.json(safePayment(payment));
  } catch (error) { next(error); }
});

router.get('/:id/receipt', authenticate, authorize('client'), async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      where: { id: req.params.id, userId: req.userId },
      include: [{ model: Consultation, attributes: ['id', 'type', 'preferredDate', 'preferredTime'], include: [{ model: User, as: 'lawyer', attributes: ['name'] }] }],
    });
    if (!payment) return res.status(404).json({ error: 'Платёж не найден' });
    const dto = safePayment(payment);
    const receipt = [
      'MaslaXat - payment receipt', `Payment: ${dto.id}`, `Status: ${dto.status}`,
      `Amount: ${dto.amount} ${dto.currency}`, `Provider: ${dto.provider}`,
      `Consultation: ${dto.consultationId}`, `Lawyer: ${payment.Consultation?.lawyer?.name || '-'}`,
      `Created: ${new Date(dto.createdAt).toISOString()}`,
    ].join('\n');
    res.type('text/plain; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="receipt-${payment.id}.txt"`);
    res.send(`${receipt}\n`);
  } catch (error) { next(error); }
});

// ─── GET /api/payments/balance ────────────────────────────────
// Баланс юриста
router.get('/balance', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const profile = await LawyerProfile.findOne({ where: { userId: req.userId } });
    if (!profile) return res.status(404).json({ error: 'Профиль не найден' });

    res.json({
      balance: parseFloat(profile.balance),
      pendingBalance: parseFloat(profile.pendingBalance),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/payments/withdraw ─────────────────────────────
// Запрос на вывод баланса юристом (B3)
router.post('/withdraw', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const { amount, destination } = req.body;
    const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotencyKey || '').trim();

    // UZS учитываем целыми сумами: дроби и значения вне DECIMAL(12,2) запрещены.
    const amt = Number(amount);
    if (!Number.isSafeInteger(amt) || amt < 10000 || amt > 9999999999) {
      return res.status(400).json({ error: 'Укажите корректную сумму вывода' });
    }
    if (!idempotencyKey || idempotencyKey.length > 100) {
      return res.status(400).json({ error: 'Отсутствует ключ идемпотентности' });
    }
    const ownerName = String(destination?.ownerName || '').trim().slice(0, 120);
    const lastFour = String(destination?.accountMask || '').replace(/\D/g, '').slice(-4);
    if (!ownerName || lastFour.length !== 4) {
      return res.status(400).json({ error: 'Укажите владельца и маскированные реквизиты выплаты' });
    }
    const accountMask = `**** ${lastFour}`;

    // Списание баланса и запись в леджер — в ОДНОЙ транзакции: иначе при сбое
    // Withdrawal.create баланс уже уменьшен, а заявки нет → деньги «пропадают»
    // без следа. Атомарный UPDATE с условием balance >= amt защищает от овердрафта.
    let profile;
    let withdrawal;
    try {
      await LawyerProfile.sequelize.transaction(async (t) => {
        const existing = await Withdrawal.findOne({
          where: { lawyerId: req.userId, idempotencyKey }, transaction: t, lock: t.LOCK.UPDATE,
        });
        if (existing) {
          if (Number(existing.amount) !== amt) {
            const conflict = new Error('IDEMPOTENCY_CONFLICT'); conflict.code = 'IDEMPOTENCY_CONFLICT'; throw conflict;
          }
          withdrawal = existing;
          profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['balance'], transaction: t });
          return;
        }
        const [affected] = await LawyerProfile.update(
          { balance: LawyerProfile.sequelize.literal(`balance - ${amt}`) },
          { where: { userId: req.userId, balance: { [Op.gte]: amt } }, transaction: t }
        );
        if (affected === 0) {
          const err = new Error('INSUFFICIENT_FUNDS');
          err.code = 'INSUFFICIENT_FUNDS';
          throw err;
        }
        withdrawal = await Withdrawal.create({
          lawyerId: req.userId,
          amount: amt,
          status: 'pending',
          provider: 'manual',
          idempotencyKey,
          destinationSnapshot: { ownerName, accountMask, method: String(destination?.method || 'manual') },
        }, { transaction: t });
        await FinancialEvent.create({
          withdrawalId: withdrawal.id,
          actorUserId: req.userId,
          source: 'lawyer',
          type: 'withdrawal_requested',
          amount: amt,
          idempotencyKey: `withdrawal_requested:${withdrawal.id}`,
          metadata: { destination: { ownerName, accountMask } },
        }, { transaction: t });
        profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['balance'], transaction: t });
      });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS') {
        return res.status(400).json({ error: 'Недостаточно средств на балансе' });
      }
      if (e.code === 'IDEMPOTENCY_CONFLICT') {
        return res.status(409).json({ error: 'Ключ уже использован для другой суммы' });
      }
      if (e.name === 'SequelizeUniqueConstraintError') {
        withdrawal = await Withdrawal.findOne({ where: { lawyerId: req.userId, idempotencyKey } });
        if (!withdrawal || Number(withdrawal.amount) !== amt) {
          return res.status(409).json({ error: 'Ключ идемпотентности уже использован' });
        }
        profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['balance'] });
      } else {
        throw e;
      }
    }

    res.json({
      success: true,
      message: `Заявка на вывод ${amt.toLocaleString()} сум принята. Средства поступят в течение 1-3 рабочих дней.`,
      newBalance: profile ? parseFloat(profile.balance) : null,
      withdrawalId: withdrawal.id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/payments/withdrawals — история выводов юриста ───
router.get('/withdrawals', authenticate, authorize('lawyer'), async (req, res, next) => {
  try {
    const withdrawals = await Withdrawal.findAll({
      where: { lawyerId: req.userId },
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json(withdrawals);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
