const router = require('express').Router();
const { Op } = require('sequelize');
const { Payment, Consultation, User, LawyerProfile, Withdrawal } = require('../models');
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
    const payment = existingPayment || await Payment.create({
      consultationId,
      userId: req.userId,
      amount,
      currency: 'UZS',
      provider: 'payme',
      status: 'pending',
    });

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
        const payment = await Payment.findOne({
          where: { id: params.account.consultation_id },
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);

        const expectedTiyin = payment.amount * 100;
        if (params.amount !== expectedTiyin) return replyError(ERRORS.INVALID_AMOUNT);

        if (payment.status === 'paid') return replyError(ERRORS.ALREADY_DONE);
        if (payment.status === 'failed') return replyError(ERRORS.CANT_PERFORM);

        await payment.update({
          transactionId: params.id,
          providerResponse: { ...payment.providerResponse, createTime: params.time },
        });

        return reply({
          create_time: params.time,
          transaction: payment.id,
          state: 1,
        });
      }

      // ── PerformTransaction ─────────────────────────────────
      case 'PerformTransaction': {
        const payment = await Payment.findOne({
          where: { transactionId: params.id },
          include: [{ model: Consultation }],
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);
        if (payment.status === 'paid') return replyError(ERRORS.ALREADY_DONE);
        if (payment.status === 'failed') return replyError(ERRORS.CANT_PERFORM);

        const performTime = Date.now();

        // Оплата прошла — переводим консультацию в статус pending (ждёт юриста)
        await payment.update({
          status: 'paid',
          providerResponse: { ...payment.providerResponse, performTime },
        });

        await payment.Consultation.update({ status: 'pending' });

        // Юрист получает pendingBalance (деньги будут переведены после завершения)
        const lawyerProfile = await LawyerProfile.findOne({
          where: { userId: payment.Consultation.lawyerId },
        });
        if (lawyerProfile) {
          await lawyerProfile.increment('pendingBalance', { by: payment.amount });
        }

        // Уведомляем юриста о новой оплаченной консультации
        await notificationService.createNotification(
          payment.Consultation.lawyerId,
          'new_booking',
          'Новая консультация',
          'Клиент оплатил консультацию. Подтвердите или отклоните.',
          { consultationId: payment.Consultation.id }
        );

        return reply({ perform_time: performTime, transaction: payment.id, state: 2 });
      }

      // ── CancelTransaction ──────────────────────────────────
      case 'CancelTransaction': {
        const payment = await Payment.findOne({
          where: { transactionId: params.id },
          include: [{ model: Consultation }],
        });

        if (!payment) return replyError(ERRORS.TRANSACTION_NOT_FOUND);
        if (payment.status === 'paid') return replyError(ERRORS.ALREADY_DONE);

        const cancelTime = Date.now();

        await payment.update({
          status: 'failed',
          providerResponse: { ...payment.providerResponse, cancelTime, reason: params.reason },
        });

        await payment.Consultation.update({ status: 'cancelled' });

        return reply({ cancel_time: cancelTime, transaction: payment.id, state: -1 });
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
            status: 'paid',
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
            state: 2,
            reason: null,
          })),
        });
      }

      default:
        return replyError(ERRORS.METHOD_NOT_FOUND);
    }
  } catch (err) {
    console.error('Payme webhook error:', err);
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
    const { amount } = req.body;

    // Валидация суммы: положительное конечное число
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Укажите корректную сумму вывода' });
    }

    // БЕЗОПАСНОСТЬ: атомарное списание одним UPDATE с условием balance >= amt —
    // защита от гонки/овердрафта при параллельных запросах (amt — проверенное число).
    const [affected] = await LawyerProfile.update(
      { balance: LawyerProfile.sequelize.literal(`balance - ${amt}`) },
      { where: { userId: req.userId, balance: { [Op.gte]: amt } } }
    );
    if (affected === 0) {
      return res.status(400).json({ error: 'Недостаточно средств на балансе' });
    }

    const profile = await LawyerProfile.findOne({ where: { userId: req.userId }, attributes: ['balance'] });

    // ЛЕДЖЕР: фиксируем заявку на вывод (аудит-трейл). Раньше баланс списывался
    // без единой записи о выплате. Статус 'pending' — реальный перевод (Payme
    // Transfer / Click) выполняется в Фазе 6, тогда статус станет 'paid'.
    const withdrawal = await Withdrawal.create({
      lawyerId: req.userId,
      amount: amt,
      status: 'pending',
      provider: 'manual',
    });

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
