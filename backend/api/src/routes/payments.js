const router = require('express').Router();
const crypto = require('crypto');
const logger = require('../config/logger');
const observability = require('../instrument');
const { Op } = require('sequelize');
const { Payment, Consultation, User, LawyerProfile, Withdrawal } = require('../models');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { recordConsultationEscrow, snapshotConsultationFinancials } = require('../services/ledgerService');
const { parseWebhook } = require('../services/providers/payme');
const { buildShadowComparison, getPaymentConfig } = require('../config/payment');
const { buildStatementResult, evaluatePaymentShadow } = require('../services/paymentShadowService');
const {
  markProviderCancelled,
  markPaymentProcessing,
  markPaymentPaid,
  createCheckout,
} = require('../services/paymentService');
const { expireReservationById } = require('../services/reservationExpiryService');

const clientAccess = authorizeCompat({ legacyRoles: ['client', 'lawyer'], capability: 'client', telemetryName: 'http.client' });
const lawyerAccess = authorizeCompat({ legacyRoles: ['lawyer'], capability: 'lawyer', telemetryName: 'http.lawyer' });

// ─── Payme JSON-RPC Error Codes ───────────────────────────────
const ERRORS = {
  PARSE_ERROR:         { code: -32700, message: 'Parse error' },
  METHOD_NOT_FOUND:    { code: -32601, message: 'Method not found' },
  INVALID_AMOUNT:      { code: -31001, message: 'Wrong amount' },
  TRANSACTION_NOT_FOUND: { code: -31003, message: 'Transaction not found' },
  CANT_PERFORM:        { code: -31008, message: 'Unable to perform operation' },
  ALREADY_DONE:        { code: -31060, message: 'Transaction already completed' },
  ALREADY_CANCELLED:   { code: -31061, message: 'Transaction already cancelled' },
};
const PAYME_METHODS = new Set([
  'CheckPerformTransaction',
  'CreateTransaction',
  'PerformTransaction',
  'CancelTransaction',
  'CheckTransaction',
  'GetStatement',
]);

// ─── Payme Basic Auth Middleware ─────────────────────────────
const verifyPayme = (req, res, next) => {
  const configuredKey = String(process.env.PAYME_KEY || '').trim();
  if (!configuredKey || configuredKey === 'CHANGE_ME' || configuredKey === 'sk-CHANGE_ME') {
    return res.status(503).json({ error: 'Payme webhook is not configured' });
  }

  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(req.headers.authorization || '');
  const token = match?.[1];
  const decodedBytes = token ? Buffer.from(token, 'base64') : null;
  const isCanonical = decodedBytes && decodedBytes.toString('base64') === token;
  const decoded = isCanonical ? decodedBytes.toString('utf8') : '';

  const actual = Buffer.from(decoded);
  const expected = Buffer.from(`Paycom:${configuredKey}`);
  const valid = Boolean(isCanonical && actual.length === expected.length
    && crypto.timingSafeEqual(actual, expected));
  if (!valid) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id ?? null,
      error: { code: -32504, message: 'Insufficient privilege to perform this method' },
    });
  }
  next();
};

// ─── POST /api/payments/create ────────────────────────────────
// Клиент бронирует → создаём Payment + Payme checkout URL
router.post('/create', authenticate, clientAccess, async (req, res, next) => {
  try {
    const paymeKey = String(process.env.PAYME_KEY || '').trim();
    const merchantId = String(process.env.PAYME_MERCHANT_ID || '').trim();
    if (!merchantId || paymeKey === 'CHANGE_ME' || paymeKey === 'sk-CHANGE_ME'
      || (process.env.NODE_ENV === 'production' && !paymeKey)) {
      return res.status(503).json({ error: 'Payme checkout is not configured', code: 'PAYMENT_UNAVAILABLE' });
    }
    const { consultationId } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key обязателен' });
    const checkout = await createCheckout({
      userId: req.userId,
      purpose: 'consultation',
      subjectId: consultationId,
      idempotencyKey,
    });
    return res.json({
      paymentId: checkout.payment.id,
      checkoutUrl: checkout.checkoutUrl,
      amount: checkout.amount,
      amountTiyin: checkout.amountTiyin,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
});

// ─── POST /api/payments/simulate ──────────────────────────────
// ТЕСТОВАЯ оплата без реального Payme. Повторяет ветку PerformTransaction
// вебхука: помечает платёж оплаченным, переводит консультацию в pending,
// начисляет юристу pendingBalance и уведомляет его.
// БЕЗОПАСНОСТЬ: в проде отключён ВСЕГДА (fail-closed по NODE_ENV), даже если забыли
// задать PAYME_KEY — иначе любой клиент оплачивал бы консультации бесплатно.
// Работает только в dev/test И когда не подключён реальный Payme.
router.post('/simulate', authenticate, clientAccess, async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.PAYME_KEY) {
      return res.status(403).json({ error: 'Тестовая оплата недоступна в этом режиме' });
    }

    const { consultationId } = req.body;
    const consultation = await Consultation.findOne({
      where: { id: consultationId, clientId: req.userId },
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (await expireReservationById(consultation.id)) {
      return res.status(410).json({ error: 'Время оплаты истекло', code: 'RESERVATION_EXPIRED' });
    }
    let payment;
    let alreadyPaid = false;
    await Payment.sequelize.transaction(async (tx) => {
      const lockedConsultation = await Consultation.findOne({
        where: { id: consultationId, clientId: req.userId }, lock: tx.LOCK.UPDATE, transaction: tx,
      });
      payment = await Payment.findOne({ where: { consultationId }, lock: tx.LOCK.UPDATE, transaction: tx });
      if (payment?.status === 'paid') {
        alreadyPaid = true;
        return;
      }
      if (lockedConsultation.status !== 'payment_pending') {
        const error = new Error('Консультацию нельзя оплатить (уже оплачена или отменена)');
        error.status = 400;
        throw error;
      }
      if (!payment) {
        payment = await Payment.create({
          consultationId, userId: req.userId, amount: lockedConsultation.price,
          amountTiyin: Math.round(Number(lockedConsultation.price) * 100),
          purpose: 'consultation', currency: 'UZS', provider: 'payme', status: 'pending',
        }, { transaction: tx });
      }
      await snapshotConsultationFinancials(lockedConsultation, Math.round(Number(payment.amount) * 100), tx);
      await payment.update({
        purpose: 'consultation',
        amountTiyin: payment.amountTiyin || Math.round(Number(payment.amount) * 100),
        status: 'paid',
        paidAt: new Date(),
        providerResponse: { test: true, paidAt: Date.now() },
      }, { transaction: tx });
      await lockedConsultation.update({ status: 'pending' }, { transaction: tx });
      await recordConsultationEscrow(payment, tx);
    });

    // Уведомляем юриста об оплаченной консультации
    if (!alreadyPaid) await notificationService.createNotification(
      consultation.lawyerId,
      'new_booking',
      'Новая консультация',
      'Клиент оплатил консультацию. Подтвердите или отклоните.',
      { consultationId: consultation.id }
    );

    res.json({ success: true, message: 'Оплата прошла', paymentId: payment.id, alreadyPaid });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/payments/webhook ───────────────────────────────
// Payme JSON-RPC 2.0 webhook
router.post('/webhook', verifyPayme, async (req, res) => {
  let paymentConfig;
  try {
    paymentConfig = getPaymentConfig();
  } catch (error) {
    observability.reportCaughtException(error, { operation: 'payment_config' });
    logger.error('payment_mode_configuration_rejected');
    return res.status(503).json({ error: 'Payment webhook mode is not available' });
  }
  const { method, params, id } = req.body;

  let shadow = null;
  if (paymentConfig.shadowEnabled) {
    try {
      const parsed = parseWebhook(req.body);
      shadow = await evaluatePaymentShadow(parsed);
    } catch (err) {
      const code = Number.isInteger(err.code) ? err.code : -32602;
      shadow = {
        method: PAYME_METHODS.has(method) ? method : 'unknown',
        v2Accepted: false,
        v2ErrorCode: code,
        v2Payload: { code },
      };
    }
  }

  const recordShadow = (legacyOutcome, legacyErrorCode = null, legacyPayload = null) => {
    if (!shadow) return;
    logger.info('payment_v2_shadow', buildShadowComparison(shadow, legacyOutcome, legacyErrorCode, legacyPayload));
  };
  const reply = (result) => {
    recordShadow('result', null, result);
    return res.json({ jsonrpc: '2.0', id, result });
  };
  const replyError = (error) => {
    recordShadow('error', error.code, error);
    return res.json({ jsonrpc: '2.0', id, error });
  };

  try {
    switch (method) {

      // ── CheckPerformTransaction ────────────────────────────
      case 'CheckPerformTransaction': {
        const payment = await Payment.findOne({
          where: { id: params.account.consultation_id },
          include: [{ model: Consultation }],
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const expectedTiyin = Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
        if (params.amount !== expectedTiyin) return replyError(ERRORS.INVALID_AMOUNT);

        if (payment.status !== 'pending') return replyError(ERRORS.CANT_PERFORM);

        return reply({ allow: true });
      }

      // ── CreateTransaction ──────────────────────────────────
      case 'CreateTransaction': {
        const payment = await Payment.findOne({
          where: { id: params.account.consultation_id },
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const expectedTiyin = Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100));
        if (params.amount !== expectedTiyin) return replyError(ERRORS.INVALID_AMOUNT);

        if (payment.status === 'paid') return replyError(ERRORS.ALREADY_DONE);
        if (payment.status === 'failed') return replyError(ERRORS.CANT_PERFORM);

        const processing = await markPaymentProcessing({
          paymentId: payment.id,
          providerTransactionId: params.id,
          amountTiyin: params.amount,
          providerData: { ...(payment.providerData || {}), createTime: params.time },
        });

        return reply({
          create_time: processing.payment.providerData.createTime,
          transaction: payment.id,
          state: 1,
        });
      }

      // ── PerformTransaction ─────────────────────────────────
      case 'PerformTransaction': {
        const payment = await Payment.findOne({
          where: { [Op.or]: [{ providerTransactionId: params.id }, { transactionId: params.id }] },
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);
        if (payment.status === 'paid') {
          await markPaymentPaid({
            paymentId: payment.id,
            providerTransactionId: params.id,
            amountTiyin: Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100)),
            providerData: {},
          });
          return reply({
            perform_time: payment.providerData?.performTime || payment.providerResponse?.performTime || 0,
            transaction: payment.id,
            state: 2,
          });
        }
        if (payment.status === 'failed') return replyError(ERRORS.CANT_PERFORM);

        const performTime = Date.now();

        await markPaymentPaid({
          paymentId: payment.id,
          providerTransactionId: params.id,
          amountTiyin: Number(payment.amountTiyin ?? Math.round(Number(payment.amount) * 100)),
          providerData: { ...(payment.providerData || {}), performTime },
        });

        return reply({ perform_time: performTime, transaction: payment.id, state: 2 });
      }

      // ── CancelTransaction ──────────────────────────────────
      case 'CancelTransaction': {
        const payment = await Payment.findOne({
          where: { [Op.or]: [{ providerTransactionId: params.id }, { transactionId: params.id }] },
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);
        const cancelled = await markProviderCancelled({
          paymentId: payment.id,
          providerTransactionId: params.id,
          cancelTime: Date.now(),
          reason: params.reason,
        });
        return reply({
          cancel_time: cancelled.cancelTime,
          transaction: payment.id,
          state: cancelled.providerState,
        });
      }

      // ── CheckTransaction ───────────────────────────────────
      case 'CheckTransaction': {
        const payment = await Payment.findOne({
          where: { [Op.or]: [{ providerTransactionId: params.id }, { transactionId: params.id }] },
        });
        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const stateMap = {
          pending: 1, processing: 1, paid: 2, refund_pending: 2, partially_refunded: 2,
          failed: -1, refunded: -2,
        };
        return reply({
          create_time: payment.providerData?.createTime || payment.providerResponse?.createTime || 0,
          perform_time: payment.providerData?.performTime || payment.providerResponse?.performTime || 0,
          cancel_time: payment.providerData?.cancelTime || payment.providerResponse?.cancelTime || 0,
          transaction: payment.id,
          state: stateMap[payment.status] || 1,
          reason: payment.providerResponse?.reason || null,
        });
      }

      // ── GetStatement ───────────────────────────────────────
      case 'GetStatement': {
        const candidates = await Payment.findAll({
          where: { provider: 'payme' }, order: [['createdAt', 'ASC'], ['id', 'ASC']], limit: 1000,
        });
        const payments = candidates.filter((payment) => {
          const created = payment.providerData?.createTime || payment.providerResponse?.createTime
            || payment.createdAt.getTime();
          return created >= params.from && created <= params.to;
        });

        return reply(buildStatementResult(payments));
      }

      default:
        return replyError(ERRORS.METHOD_NOT_FOUND);
    }
  } catch (err) {
    observability.reportCaughtException(err, {
      operation: 'payme_webhook',
      method: PAYME_METHODS.has(method) ? method : 'unknown',
    });
    logger.error('payme_webhook_failed', {
      method: PAYME_METHODS.has(method) ? method : 'unknown',
    });
    return replyError(ERRORS.CANT_PERFORM);
  }
});

// ─── GET /api/payments/my ─────────────────────────────────────
// История платежей текущего пользователя
router.get('/my', authenticate, clientAccess, async (req, res, next) => {
  try {
    const payments = await Payment.findAll({
      where: { userId: req.userId },
      include: [{
        model: Consultation,
        attributes: ['id', 'type', 'preferredDate', 'preferredTime'],
        include: [{ model: User, as: 'lawyer', attributes: ['id', 'name', 'avatar'] }],
      }],
      order: [['createdAt', 'DESC']],
    });
    res.json(payments);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/payments/balance ────────────────────────────────
// Баланс юриста
router.get('/balance', authenticate, lawyerAccess, async (req, res, next) => {
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
router.post('/withdraw', authenticate, lawyerAccess, async (req, res, next) => {
  try {
    const { amount, destination } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return res.status(400).json({ error: 'Idempotency-Key обязателен' });
    }

    // Валидация суммы: положительное конечное число
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Укажите корректную сумму вывода' });
    }

    // Списание баланса и запись в леджер — в ОДНОЙ транзакции: иначе при сбое
    // Withdrawal.create баланс уже уменьшен, а заявки нет → деньги «пропадают»
    // без следа. Атомарный UPDATE с условием balance >= amt защищает от овердрафта.
    let profile;
    let withdrawal;
    try {
      await LawyerProfile.sequelize.transaction(async (t) => {
        await LawyerProfile.sequelize.query(
          'SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))',
          { replacements: { key: `withdrawal:${req.userId}:${idempotencyKey}` }, transaction: t },
        );
        withdrawal = await Withdrawal.findOne({
          where: { lawyerId: req.userId, idempotencyKey }, transaction: t, lock: t.LOCK.UPDATE,
        });
        if (withdrawal) {
          if (Number(withdrawal.amount) !== amt
            || JSON.stringify(withdrawal.destinationSnapshot || {}) !== JSON.stringify(destination || {})) {
            const error = new Error('Idempotency key was already used for different withdrawal terms');
            error.status = 409;
            throw error;
          }
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
          destinationSnapshot: destination || {},
        }, { transaction: t });
        profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['balance'], transaction: t });
      });
    } catch (e) {
      if (e.code === 'INSUFFICIENT_FUNDS') {
        return res.status(400).json({ error: 'Недостаточно средств на балансе' });
      }
      throw e;
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
router.get('/withdrawals', authenticate, lawyerAccess, async (req, res, next) => {
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
