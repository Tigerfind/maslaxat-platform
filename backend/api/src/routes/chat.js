const router = require('express').Router();
const { Message, Consultation, User, LawyerProfile } = require('../models');
const { authenticate } = require('../middleware/auth');

// GET /api/chat/:consultationId/messages — get chat history
router.get('/:consultationId/messages', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.consultationId);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    // Only participants can read
    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    let messages = await Message.findAll({
      where: { consultationId: req.params.consultationId },
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }],
      order: [['createdAt', 'ASC']],
    });

    // Автоприветствие: когда клиент открывает чат, а сообщений ещё нет и у юриста
    // задан greeting — публикуем его первым сообщением от юриста (один раз).
    if (messages.length === 0 && req.userId === consultation.clientId) {
      const lawyerProfile = await LawyerProfile.findOne({
        where: { userId: consultation.lawyerId },
        attributes: ['greeting'],
      });
      const greeting = lawyerProfile && lawyerProfile.greeting && lawyerProfile.greeting.trim();
      if (greeting) {
        await Message.create({
          consultationId: req.params.consultationId,
          senderId: consultation.lawyerId,
          text: greeting,
        });
        messages = await Message.findAll({
          where: { consultationId: req.params.consultationId },
          include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }],
          order: [['createdAt', 'ASC']],
        });
      }
    }

    // Mark messages from the other person as read
    await Message.update(
      { isRead: true },
      {
        where: {
          consultationId: req.params.consultationId,
          senderId: consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId,
          isRead: false,
        },
      }
    );

    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/:consultationId/messages — send a message (REST fallback)
router.post('/:consultationId/messages', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.consultationId);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // В завершённую/отменённую консультацию писать нельзя — только читать историю
    if (['completed', 'cancelled', 'rejected'].includes(consultation.status)) {
      return res.status(403).json({ error: 'Консультация завершена — чат доступен только для чтения' });
    }

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }

    // Filter phone numbers and emails to prevent bypassing the platform
    const filteredText = text.trim()
      .replace(/(\+?998[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g, '***')
      .replace(/(\+?\d{10,13})/g, '***')
      .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '***');

    const message = await Message.create({
      consultationId: req.params.consultationId,
      senderId: req.userId,
      text: filteredText,
    });

    const fullMessage = await Message.findByPk(message.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }],
    });

    res.status(201).json(fullMessage);
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/:consultationId/unread — unread count for this chat
router.get('/:consultationId/unread', authenticate, async (req, res, next) => {
  try {
    const consultation = await Consultation.findByPk(req.params.consultationId);
    if (!consultation) {
      return res.status(404).json({ error: 'Консультация не найдена' });
    }

    // Только участник видит счётчик непрочитанных (как в /messages)
    if (consultation.clientId !== req.userId && consultation.lawyerId !== req.userId) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const otherUserId = consultation.clientId === req.userId ? consultation.lawyerId : consultation.clientId;

    const count = await Message.count({
      where: {
        consultationId: req.params.consultationId,
        senderId: otherUserId,
        isRead: false,
      },
    });

    res.json({ count });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
