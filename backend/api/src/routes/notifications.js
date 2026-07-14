const router = require('express').Router();
const { Notification } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/notifications — get user notifications
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await Notification.findAndCountAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    const unreadCount = await Notification.count({
      where: { userId: req.userId, isRead: false },
    });

    res.json({
      notifications: rows,
      total: count,
      unreadCount,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/notifications/unread-count — quick count for badge
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const count = await Notification.count({
      where: { userId: req.userId, isRead: false },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const notification = await Notification.findOne({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Уведомление не найдено' });
    }

    notification.isRead = true;
    await notification.save();

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await Notification.update(
      { isRead: true },
      { where: { userId: req.userId, isRead: false } }
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
