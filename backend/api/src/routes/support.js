const express = require('express');
const router = express.Router();
const { SupportTicket, User } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// POST /api/support — создать обращение в поддержку
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Введите сообщение' });
    }
    const ticket = await SupportTicket.create({
      userId: req.userId,
      subject: subject || 'Обращение в поддержку',
      message: message.trim(),
      status: 'open',
    });
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
router.get('/', authenticate, authorize('admin'), async (req, res, next) => {
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
