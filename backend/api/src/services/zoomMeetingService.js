const { DateTime } = require('luxon');
const { Op } = require('sequelize');
const { Consultation, ConsultationMeeting, ZoomConnection, Payment } = require('../models');
const zoomApi = require('./zoomApiService');
const secretBox = require('./secretBox');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

const markerFor = (consultationId) => `emaslaxat:${consultationId}`;

async function findRemoteMeeting(connection, consultationId) {
  const marker = markerFor(consultationId);
  const response = await zoomApi.api(connection, '/users/me/meetings?type=scheduled&page_size=300');
  return (response?.meetings || []).find((item) => item.agenda === marker) || null;
}

async function maybeProvision(consultationId) {
  const consultation = await Consultation.findByPk(consultationId);
  if (!consultation || consultation.meetingProvider !== 'zoom' || consultation.status !== 'accepted') return null;
  const paid = consultation.isFree || consultation.billingStatus === 'charged'
    || Boolean(await Payment.findOne({ where: { consultationId, status: 'paid' } }));
  if (!paid) return null;
  const connection = await ZoomConnection.findOne({ where: { userId: consultation.lawyerId, status: 'connected' } });
  if (!connection) throw new Error('Zoom connection unavailable');
  const [meeting, created] = await ConsultationMeeting.findOrCreate({
    where: { consultationId },
    defaults: { zoomConnectionId: connection.id, provider: 'zoom', status: 'creating', scheduledAt: consultation.scheduledStartAt, duration: consultation.duration },
  });
  if (!created && meeting.status === 'ready') return meeting;
  if (!created && meeting.status === 'creating' && Date.now() - new Date(meeting.updatedAt).getTime() < 2 * 60 * 1000) return meeting;
  if (!created) await meeting.update({ status: 'creating', lastError: null });
  try {
    let remote = await findRemoteMeeting(connection, consultation.id).catch(() => null);
    if (remote) {
      remote = await zoomApi.api(connection, `/meetings/${remote.id}`);
    } else {
      remote = await zoomApi.api(connection, '/users/me/meetings', {
        method: 'POST',
        body: JSON.stringify({
          topic: 'Юридическая консультация eMaslaXat',
          agenda: markerFor(consultation.id),
          type: 2,
          start_time: DateTime.fromJSDate(consultation.scheduledStartAt).toUTC().toISO(),
          duration: consultation.duration,
          timezone: consultation.scheduleTimezone || 'Asia/Tashkent',
          settings: { waiting_room: true, join_before_host: false, mute_upon_entry: true, auto_recording: 'none' },
        }),
      });
    }
    await meeting.update({
      zoomConnectionId: connection.id,
      externalMeetingId: String(remote.id),
      status: 'ready',
      joinUrlEncrypted: secretBox.encrypt(remote.join_url, `meeting:${meeting.id}:join`),
      startUrlEncrypted: remote.start_url ? secretBox.encrypt(remote.start_url, `meeting:${meeting.id}:start`) : null,
      passcodeEncrypted: secretBox.encrypt(remote.password || '', `meeting:${meeting.id}:passcode`),
      lastError: null,
    });
    await Promise.all([
      notificationService.createNotification(consultation.clientId, 'zoom_ready', 'Zoom-встреча готова', 'Видеоконсультация Zoom готова. Откройте консультацию для подключения.', { consultationId }),
      notificationService.createNotification(consultation.lawyerId, 'zoom_ready', 'Zoom-встреча готова', 'Откройте консультацию, чтобы начать Zoom.', { consultationId }),
    ]);
    return meeting;
  } catch (error) {
    await meeting.update({ status: 'failed', lastError: error.message.slice(0, 500) });
    throw error;
  }
}

async function updateMeeting(consultationId) {
  const meeting = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (!meeting?.externalMeetingId) return null;
  const consultation = await Consultation.findByPk(consultationId);
  const connection = await ZoomConnection.findByPk(meeting.zoomConnectionId);
  await meeting.update({ status: 'update_pending' });
  try {
    await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ start_time: DateTime.fromJSDate(consultation.scheduledStartAt).toUTC().toISO(), duration: consultation.duration, timezone: consultation.scheduleTimezone }),
    });
    await meeting.update({ scheduledAt: consultation.scheduledStartAt, duration: consultation.duration, status: 'ready', lastError: null });
  } catch (error) {
    await meeting.update({ status: 'failed', lastError: error.message.slice(0, 500) });
    throw error;
  }
  return meeting;
}

async function cancelMeeting(consultationId) {
  const meeting = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (!meeting) return null;
  if (meeting.externalMeetingId) {
    const connection = await ZoomConnection.findByPk(meeting.zoomConnectionId);
    try {
      await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`, { method: 'DELETE' });
    } catch (error) {
      await meeting.update({ status: 'cancellation_pending', lastError: error.message.slice(0, 500) });
      return meeting;
    }
  }
  await meeting.update({ status: 'cancelled', cancelledAt: new Date(), lastError: null });
  return meeting;
}

async function reconcilePendingMeetings() {
  const rows = await ConsultationMeeting.findAll({
    where: {
      [Op.or]: [
        { status: 'cancellation_pending' },
        { status: 'failed' },
        { status: 'creating', updatedAt: { [Op.lt]: new Date(Date.now() - 2 * 60 * 1000) } },
      ],
    },
    order: [['updatedAt', 'ASC']],
    limit: 50,
  });
  let recovered = 0;
  for (const meeting of rows) {
    try {
      const result = meeting.status === 'cancellation_pending'
        ? await cancelMeeting(meeting.consultationId)
        : await maybeProvision(meeting.consultationId);
      if (result && ['ready', 'cancelled'].includes(result.status)) recovered += 1;
    } catch (error) {
      logger.warn('Zoom meeting reconciliation failed', { meetingId: meeting.id, error: error.message });
    }
  }
  return recovered;
}

function startReconciliationJob() {
  if (!zoomApi.enabled()) return;
  const timer = setInterval(() => reconcilePendingMeetings().catch((error) => {
    logger.error('Zoom reconciliation job failed', { error: error.message });
  }), 5 * 60 * 1000);
  timer.unref?.();
  setTimeout(() => reconcilePendingMeetings().catch(() => {}), 30 * 1000).unref?.();
}

module.exports = { maybeProvision, updateMeeting, cancelMeeting, reconcilePendingMeetings, startReconciliationJob };
