const express = require('express');
const router = express.Router();
const { SupportTicket, User } = require('../models');
const { authenticate, authorizeCompat } = require('../middleware/auth');
const notifications = require('../services/notificationService');
const { distributedRateLimit } = require('../middleware/distributedRateLimit');

const adminAccess = authorizeCompat({
  legacyRoles: ['admin'], capability: 'admin', telemetryName: 'http.admin',
});

const supportLimiter = distributedRateLimit({
  prefix: 'support-user', windowSeconds: 60 * 60,
  max: process.env.NODE_ENV === 'production' ? 5 : 1000,
  keyGenerator: (req) => req.userId,
});

// POST /api/support — создать обращение в поддержку
router.post('/', authenticate, supportLimiter, async (req, res, next) => {
  try {
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'Введите сообщение' });
    }
    if (subject.length > 200 || message.length > 5000) {
      return res.status(400).json({ error: 'Обращение превышает допустимую длину' });
    }
    const ticket = await SupportTicket.create({
      userId: req.userId,
      subject: subject || 'Обращение в поддержку',
      message,
      status: 'open',
    });

    // Уведомляем админов: раньше новое обращение не сигналило никому, и админ
    // узнавал о нём, только если сам заходил на страницу поддержки (fail-safe).
    try {
      const author = await User.findByPk(req.userId, { attributes: ['name'] });
      const admins = await User.findAll({ where: { role: 'admin' }, attributes: ['id'] });
      await Promise.all(admins.map((a) => notifications.createNotification(
        a.id,
        'support_ticket',
        'Новое обращение в поддержку',
        `${author?.name || 'Пользователь'}: ${ticket.subject}`,
        { ticketId: ticket.id },
      )));
    } catch (e) { /* уведомление — best-effort, тикет уже создан */ }

    res.status(201).json({ success: true, message: 'Обращение отправлено', ticket });
  } catch (err) {
    next(err);
  }
});

// GET /api/support/my — мои обращения
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const tickets = await SupportTicket.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
    });
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
});

// GET /api/support — все обращения (для админа)
router.get('/', authenticate, adminAccess, async (req, res, next) => {
  try {
    const tickets = await SupportTicket.findAll({
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ tickets });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
