const router = require('express').Router();
const logger = require('../config/logger');
const { Op } = require('sequelize');
const { sequelize, Payment, Consultation, User, LawyerProfile, Withdrawal, FinancialEvent } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

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

// ─── Payme Basic Auth Middleware ─────────────────────────────
const verifyPayme = (req, res, next) => {
  if (!process.env.PAYME_KEY) {
    return res.status(503).json({ jsonrpc: '2.0', id: req.body?.id || null, error: ERRORS.CANT_PERFORM });
  }
  const auth = req.headers.authorization || '';
  const b64 = auth.replace('Basic ', '');
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  const [, key] = decoded.split(':');

  if (key !== process.env.PAYME_KEY) {
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

    const consultation = await Consultation.findOne({
      where: { id: consultationId, clientId: req.userId },
      include: [{ model: User, as: 'lawyer', include: [{ model: LawyerProfile, as: 'profile' }] }],
    });

    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.status !== 'payment_pending') {
      return res.status(400).json({ error: 'Консультация уже оплачена или отменена' });
    }

    const existingPayment = await Payment.findOne({ where: { consultationId } });
    if (existingPayment && existingPayment.status === 'paid') {
      return res.status(400).json({ error: 'Консультация уже оплачена' });
    }

    const amount = consultation.price; // в сумах
    const amountTiyin = amount * 100;  // Payme работает в тийинах

    // Создаём или обновляем платёж
    let payment = existingPayment;
    if (payment) {
      // Прошлая попытка не удалась/отменена (failed) — сбрасываем в pending,
      // иначе повторная оплата навсегда блокировалась (webhook требует pending).
      if (payment.status === 'failed') {
        await payment.update({ status: 'pending', amount, transactionId: null, providerResponse: null });
      }
    } else {
      payment = await Payment.create({
        consultationId,
        userId: req.userId,
        amount,
        currency: 'UZS',
        provider: 'payme',
        status: 'pending',
      });
    }

    // Payme checkout URL
    // Формат: account[consultation_id]=ID&amount=TIYIN
    const merchantId = process.env.PAYME_MERCHANT_ID;
    const params = Buffer.from(
      `m=${merchantId};ac.consultation_id=${payment.id};a=${amountTiyin}`
    ).toString('base64');

    const checkoutUrl = `https://checkout.paycom.uz/${params}`;

    res.json({ paymentId: payment.id, checkoutUrl, amount, amountTiyin });
  } catch (err) {
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
    const consultation = await Consultation.findOne({
      where: { id: consultationId, clientId: req.userId },
    });
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }
    if (consultation.status !== 'payment_pending') {
      return res.status(400).json({ error: 'Консультацию нельзя оплатить (уже оплачена или отменена)' });
    }

    let payment = await Payment.findOne({ where: { consultationId } });
    if (payment && payment.status === 'paid') {
      return res.status(400).json({ error: 'Консультация уже оплачена' });
    }
    if (!payment) {
      payment = await Payment.create({
        consultationId,
        userId: req.userId,
        amount: consultation.price,
        currency: 'UZS',
        provider: 'payme',
        status: 'pending',
      });
    }

    await payment.update({
      status: 'paid',
      providerResponse: { test: true, paidAt: Date.now() },
    });

    // Консультация ждёт подтверждения юриста
    await consultation.update({ status: 'pending' });

    // Эскроу: деньги резервируются на pendingBalance юриста
    const lawyerProfile = await LawyerProfile.findOne({ where: { userId: consultation.lawyerId } });
    if (lawyerProfile) {
      await lawyerProfile.increment('pendingBalance', { by: payment.amount });
    }

    // Уведомляем юриста об оплаченной консультации
    await notificationService.createNotification(
      consultation.lawyerId,
      'new_booking',
      'Новая консультация',
      'Клиент оплатил консультацию. Подтвердите или отклоните.',
      { consultationId: consultation.id }
    );

    res.json({ success: true, message: 'Оплата прошла', paymentId: payment.id });
  } catch (err) {
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
          where: { id: params.account.consultation_id },
          include: [{ model: Consultation }],
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const expectedTiyin = payment.amount * 100;
        if (params.amount !== expectedTiyin) return replyError(ERRORS.INVALID_AMOUNT);

        if (payment.status !== 'pending') return replyError(ERRORS.CANT_PERFORM);

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
          await consultation.update({ status: 'pending' }, { transaction });
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
            if (payment.refundStatus !== 'requested' || payment.escrowReleased) return { error: ERRORS.ALREADY_DONE };
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
            return { result: { cancel_time: cancelTime, transaction: payment.id, state: -2 } };
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
          await consultation.update({ status: 'cancelled' }, { transaction });
          return { result: { cancel_time: cancelTime, transaction: payment.id, state: -1 } };
        });

        return outcome.error ? replyError(outcome.error) : reply(outcome.result);
      }

      // ── CheckTransaction ───────────────────────────────────
      case 'CheckTransaction': {
        const payment = await Payment.findOne({ where: { transactionId: params.id } });
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
        const payments = await Payment.findAll({
          where: {
            status: { [Op.in]: ['paid', 'refunded'] },
            createdAt: {
              [require('sequelize').Op.between]: [
                new Date(params.from),
                new Date(params.to),
              ],
            },
          },
        });

        return reply({
          transactions: payments.map((p) => ({
            id: p.transactionId,
            time: p.providerResponse?.createTime || p.createdAt.getTime(),
            amount: p.amount * 100,
            account: { consultation_id: p.id },
            create_time: p.providerResponse?.createTime || p.createdAt.getTime(),
            perform_time: p.providerResponse?.performTime || 0,
            cancel_time: p.providerResponse?.cancelTime || 0,
            transaction: p.id,
            state: p.status === 'refunded' ? -2 : 2,
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
