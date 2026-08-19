const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { PushSubscription } = require('../models');
const pushService = require('../services/pushService');

async function deleteOwnedSubscription(model, endpoint, userId) {
  return model.destroy({ where: { endpoint, userId } });
}

// GET /api/push/vapid-public-key — публичный VAPID-ключ (или null если выключено)
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushService.getPublicKey(), enabled: pushService.isEnabled() });
});

// POST /api/push/subscribe — сохранить подписку устройства текущего пользователя
router.post('/subscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'Некорректные данные подписки' });
    }
    // endpoint уникален: если уже есть — перепривязываем к этому пользователю
    const existing = await PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      existing.userId = req.userId;
      existing.keys = keys;
      await existing.save();
      return res.json({ success: true });
    }
    await PushSubscription.create({ userId: req.userId, endpoint, keys });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/push/unsubscribe — удалить подписку по endpoint
router.post('/unsubscribe', authenticate, async (req, res, next) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint обязателен' });
    const deleted = await deleteOwnedSubscription(PushSubscription, endpoint, req.userId);
    if (deleted !== 1) {
      return res.status(409).json({ success: false, deleted: 0, code: 'PUSH_BINDING_NOT_OWNED' });
    }
    return res.json({ success: true, deleted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.deleteOwnedSubscription = deleteOwnedSubscription;
