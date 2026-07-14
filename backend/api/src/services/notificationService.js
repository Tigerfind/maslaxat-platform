const { Notification } = require('../models');

const TYPES = {
  BOOKING_NEW: 'booking_new',
  BOOKING_ACCEPTED: 'booking_accepted',
  BOOKING_REJECTED: 'booking_rejected',
  CONSULTATION_STARTED: 'consultation_started',
  CONSULTATION_COMPLETED: 'consultation_completed',
  CONSULTATION_CANCELLED: 'consultation_cancelled',
  NEW_REVIEW: 'new_review',
  DOCUMENT_ANALYZED: 'document_analyzed',
};

async function createNotification(userId, type, title, message, metadata = {}) {
  try {
    return await Notification.create({ userId, type, title, message, metadata });
  } catch (err) {
    console.error('[NotificationService] Error creating notification:', err.message);
    return null;
  }
}

// When a client books a consultation → notify the lawyer
async function notifyNewBooking(lawyerId, clientName, consultation) {
  return createNotification(
    lawyerId,
    TYPES.BOOKING_NEW,
    'Новая заявка на консультацию',
    `${clientName} записался на ${consultation.type === 'video' ? 'видео' : 'чат'}-консультацию на ${consultation.preferredDate} в ${consultation.preferredTime}`,
    { consultationId: consultation.id, clientName }
  );
}

// When a lawyer accepts → notify the client
async function notifyBookingAccepted(clientId, lawyerName, consultation) {
  return createNotification(
    clientId,
    TYPES.BOOKING_ACCEPTED,
    'Консультация подтверждена',
    `Юрист ${lawyerName} подтвердил вашу консультацию на ${consultation.preferredDate} в ${consultation.preferredTime}`,
    { consultationId: consultation.id, lawyerName }
  );
}

// When a lawyer rejects → notify the client
async function notifyBookingRejected(clientId, lawyerName, consultation) {
  return createNotification(
    clientId,
    TYPES.BOOKING_REJECTED,
    'Консультация отклонена',
    `Юрист ${lawyerName} отклонил заявку на консультацию. ${consultation.notes || ''}`.trim(),
    { consultationId: consultation.id, lawyerName }
  );
}

// When consultation starts → notify both
async function notifyConsultationStarted(userId, partnerName, consultation) {
  return createNotification(
    userId,
    TYPES.CONSULTATION_STARTED,
    'Консультация началась',
    `${consultation.type === 'video' ? 'Видеозвонок' : 'Чат'} с ${partnerName} начался`,
    { consultationId: consultation.id }
  );
}

// When consultation completes → notify both
async function notifyConsultationCompleted(userId, partnerName, consultation) {
  return createNotification(
    userId,
    TYPES.CONSULTATION_COMPLETED,
    'Консультация завершена',
    `Консультация с ${partnerName} завершена`,
    { consultationId: consultation.id }
  );
}

// When consultation cancelled → notify the other party
async function notifyConsultationCancelled(userId, cancellerName, consultation) {
  return createNotification(
    userId,
    TYPES.CONSULTATION_CANCELLED,
    'Консультация отменена',
    `${cancellerName} отменил консультацию. ${consultation.notes || ''}`.trim(),
    { consultationId: consultation.id }
  );
}

// When a client leaves a review → notify the lawyer
async function notifyNewReview(lawyerId, clientName, rating) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  return createNotification(
    lawyerId,
    TYPES.NEW_REVIEW,
    'Новый отзыв',
    `${clientName} оставил отзыв ${stars}`,
    { clientName, rating }
  );
}

// When document is analyzed → notify the user
async function notifyDocumentAnalyzed(userId, documentName, score) {
  const status = score >= 80 ? 'прошёл проверку' : score >= 50 ? 'требует внимания' : 'имеет проблемы';
  return createNotification(
    userId,
    TYPES.DOCUMENT_ANALYZED,
    'AI анализ завершён',
    `Документ "${documentName}" ${status} (${score}/100)`,
    { documentName, score }
  );
}

module.exports = {
  TYPES,
  createNotification,
  notifyNewBooking,
  notifyBookingAccepted,
  notifyBookingRejected,
  notifyConsultationStarted,
  notifyConsultationCompleted,
  notifyConsultationCancelled,
  notifyNewReview,
  notifyDocumentAnalyzed,
};
