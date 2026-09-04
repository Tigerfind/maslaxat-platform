const router = require('express').Router();
const { Message, Consultation, LawyerProfile } = require('../models');
const { authenticate } = require('../middleware/auth');
const consultationPolicy = require('../services/consultationPolicy');
const { MESSAGE_INCLUDE, normalizeClientMessageId, sanitizeChatText, createIdempotentMessage } = require('../services/chatService');
const { Op } = require('sequelize');

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const encodeCursor = (message) => Buffer.from(JSON.stringify({ createdAt: message.createdAt, id: message.id })).toString('base64url');
const decodeCursor = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const createdAt = new Date(parsed.createdAt);
    if (!parsed.id || Number.isNaN(createdAt.getTime())) return undefined;
    return { createdAt, id: parsed.id };
  } catch (_) { return undefined; }
};

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

    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const cursor = decodeCursor(req.query.cursor);
    if (cursor === undefined) return res.status(400).json({ error: 'Некорректный курсор', code: 'INVALID_CURSOR' });
    const where = { consultationId: req.params.consultationId };
    if (cursor) where[Op.or] = [
      { createdAt: { [Op.lt]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [Op.lt]: cursor.id } },
    ];
    let messages = await Message.findAll({
      where,
      include: MESSAGE_INCLUDE,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: limit + 1,
    });

    // Автоприветствие: когда клиент открывает чат, а сообщений ещё нет и у юриста
    // задан greeting — публикуем его первым сообщением от юриста (один раз).
    if (!cursor && messages.length === 0 && req.userId === consultation.clientId && consultationPolicy.isWritable(consultation)) {
      const lawyerProfile = await LawyerProfile.findOne({
        where: { userId: consultation.lawyerId },
        attributes: ['greeting'],
      });
      const greeting = lawyerProfile && lawyerProfile.greeting && lawyerProfile.greeting.trim();
      if (greeting) {
        await createIdempotentMessage({
          consultation,
          senderId: consultation.lawyerId,
          text: sanitizeChatText(greeting),
          clientMessageId: 'auto-greeting-v1',
          notify: false,
        });
        messages = await Message.findAll({
          where: { consultationId: req.params.consultationId },
          include: MESSAGE_INCLUDE,
          order: [['createdAt', 'DESC'], ['id', 'DESC']],
          limit: limit + 1,
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

    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();
    res.json({
      messages: page,
      nextCursor: hasMore && page.length ? encodeCursor(page[0]) : null,
      hasMore,
    });
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

    if (!consultationPolicy.isWritable(consultation)) {
      return res.status(409).json({ error: 'Чат доступен только для чтения', code: 'CONSULTATION_READ_ONLY' });
    }

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым', code: 'INVALID_MESSAGE' });
    }
    const clientMessageId = normalizeClientMessageId(req.body.clientMessageId);
    if (clientMessageId === undefined) {
      return res.status(400).json({ error: 'Некорректный идентификатор сообщения', code: 'INVALID_CLIENT_MESSAGE_ID' });
    }
    const { message, created } = await createIdempotentMessage({ consultation, senderId: req.userId, text, clientMessageId });
    res.status(created ? 201 : 200).json(message);
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
module.exports.decodeCursor = decodeCursor;
