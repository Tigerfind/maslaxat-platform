const { Message, User } = require('../models');
const notificationService = require('./notificationService');

const CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MESSAGE_INCLUDE = [{ model: User, as: 'sender', attributes: ['id', 'name', 'avatar', 'role'] }];

function normalizeClientMessageId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return CLIENT_MESSAGE_ID_RE.test(normalized) ? normalized : undefined;
}

function sanitizeChatText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 5000)
    .replace(/(\+?998[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2})/g, '***')
    .replace(/(\+?\d{10,13})/g, '***')
    .replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '***');
}

async function fullMessage(id) {
  return Message.findByPk(id, { include: MESSAGE_INCLUDE });
}

async function createIdempotentMessage({ consultation, senderId, text, clientMessageId, notify = true }) {
  const values = {
    consultationId: consultation.id,
    senderId,
    text: sanitizeChatText(text),
    clientMessageId,
  };
  let message;
  let created = true;
  if (clientMessageId) {
    [message, created] = await Message.findOrCreate({
      where: { consultationId: consultation.id, senderId, clientMessageId },
      defaults: values,
    });
  } else {
    message = await Message.create(values);
  }

  if (created && notify) {
    const recipientId = consultation.clientId === senderId ? consultation.lawyerId : consultation.clientId;
    await notificationService.createNotification(
      recipientId,
      'chat_message',
      'Новое сообщение',
      'У вас новое сообщение по консультации',
      { consultationId: consultation.id, messageId: message.id, clientMessageId: clientMessageId || null },
    );
  }
  return { message: await fullMessage(message.id), created };
}

module.exports = {
  MESSAGE_INCLUDE,
  normalizeClientMessageId,
  sanitizeChatText,
  createIdempotentMessage,
};
