const { Op } = require('sequelize');
const { sequelize, Consultation, ConsultationMeeting, ZoomConnection } = require('../models');
const notificationService = require('./notificationService');
const secretBox = require('./secretBox');
const zoomApi = require('./zoomApiService');
const zoomMeetingService = require('./zoomMeetingService');
const availabilityService = require('./availabilityService');

const ACTIVE_BOOKING_STATUSES = ['payment_pending', 'pending', 'accepted'];

async function disconnect(userId, { revokeRemote = true, reason = 'user_disconnected', allowFallback = false } = {}) {
  let connection;
  let consultations = [];
  await sequelize.transaction(async (transaction) => {
    await availabilityService.lockZoomConnection(userId, transaction);
    connection = await ZoomConnection.findOne({ where: { userId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!connection) return;
    consultations = await Consultation.findAll({
      where: {
        lawyerId: userId,
        meetingProvider: 'zoom',
        status: { [Op.in]: ACTIVE_BOOKING_STATUSES },
        [Op.or]: [{ scheduledStartAt: null }, { scheduledStartAt: { [Op.gt]: new Date() } }],
      },
      attributes: ['id', 'clientId', 'lawyerId'], transaction, lock: transaction.LOCK.UPDATE,
    });
    if (consultations.length && !allowFallback) {
      throw Object.assign(new Error('Сначала отмените или перенесите будущие Zoom-консультации'), {
        status: 409, code: 'ZOOM_HAS_FUTURE_CONSULTATIONS',
      });
    }
    await connection.update({ status: 'disconnecting' }, { transaction });
    if (allowFallback && consultations.length) {
      await Consultation.update({ meetingProvider: 'webrtc' }, {
        where: { id: { [Op.in]: consultations.map((item) => item.id) } }, transaction,
      });
    }
  });
  if (!connection) return { affectedConsultations: 0 };

  await Promise.allSettled(consultations.map((item) => zoomMeetingService.cancelMeeting(item.id)));

  if (revokeRemote && connection.accessTokenEncrypted) {
    try {
      const token = secretBox.decrypt(connection.accessTokenEncrypted, `zoom:${userId}:access`);
      await zoomApi.revokeToken(token);
    } catch (error) {
      // Local disconnect must still complete when Zoom is unavailable.
    }
  }

  await sequelize.transaction(async (transaction) => {
    if (allowFallback && consultations.length) {
      const ids = consultations.map((item) => item.id);
      await ConsultationMeeting.update(
        { cancelledAt: new Date() },
        { where: { consultationId: { [Op.in]: ids }, status: 'cancelled' }, transaction },
      );
    }
    await connection.update({
      status: 'revoked',
      accessTokenEncrypted: '',
      refreshTokenEncrypted: '',
      lastError: reason,
      disconnectedAt: new Date(),
    }, { transaction });
  });

  if (allowFallback) await Promise.all(consultations.flatMap((item) => [
    notificationService.createNotification(
      item.clientId,
      'meeting_provider_changed',
      'Формат консультации изменён',
      'Zoom недоступен. Консультация автоматически переведена на защищённый видеозвонок платформы.',
      { consultationId: item.id, meetingProvider: 'webrtc' },
    ),
    notificationService.createNotification(
      item.lawyerId,
      'meeting_provider_changed',
      'Формат консультации изменён',
      'Будущая Zoom-консультация переведена на видеозвонок платформы.',
      { consultationId: item.id, meetingProvider: 'webrtc' },
    ),
  ]));

  return { affectedConsultations: consultations.length };
}

module.exports = { disconnect };
