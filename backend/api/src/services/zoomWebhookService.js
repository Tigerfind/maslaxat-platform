const crypto = require('crypto');
const { Op } = require('sequelize');
const { sequelize, Consultation, ConsultationMeeting, MeetingEvent, Payment, User, ZoomConnection, ZoomWebhookEvent } = require('../models');
const zoomConnectionService = require('./zoomConnectionService');
const lifecycle = require('./consultationLifecycleService');
const notificationService = require('./notificationService');
const logger = require('../config/logger');

function verify(rawBody, timestamp, signature) {
  const seconds = Number(timestamp);
  if (!process.env.ZOOM_WEBHOOK_SECRET || !Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = `v0=${crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
  const left = Buffer.from(expected); const right = Buffer.from(String(signature || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const eventTime = (payload) => {
  const value = Number(payload.event_ts);
  return Number.isFinite(value) ? new Date(value > 1e12 ? value : value * 1000) : new Date();
};

async function participantRole(consultation, customerKey, providerUserId, meeting) {
  const sdk = require('./zoomMeetingSdkService');
  if (customerKey && customerKey === sdk.customerKey(consultation.id, consultation.clientId)) return 'client';
  if (customerKey && customerKey === sdk.customerKey(consultation.id, consultation.lawyerId)) return 'lawyer';
  if (providerUserId && meeting.zoomConnection?.zoomUserId && String(providerUserId) === String(meeting.zoomConnection.zoomUserId)) return 'lawyer';
  return null;
}

async function processEventById(id) {
  const stale = new Date(Date.now() - 5 * 60 * 1000);
  const now = new Date();
  const [claimed] = await ZoomWebhookEvent.update({ status: 'processing' }, {
    where: { id, [Op.or]: [{ status: 'queued' }, { status: 'failed', nextAttemptAt: { [Op.lte]: now } }, { status: 'processing', updatedAt: { [Op.lt]: stale } }] },
  });
  if (!claimed) return;
  const event = await ZoomWebhookEvent.findByPk(id);
  const data = event.payload || {};
  try {
    if (event.event === 'app_deauthorized' && data.accountId) {
      const connections = await ZoomConnection.findAll({ where: { zoomAccountId: data.accountId, status: { [Op.in]: ['connected', 'reauth_required', 'disconnecting'] } }, attributes: ['userId'] });
      for (const { userId } of connections) await zoomConnectionService.disconnect(userId, { revokeRemote: false, reason: 'app_deauthorized', allowFallback: true });
    } else if (data.meetingId || data.meetingUuid) {
      const meeting = await ConsultationMeeting.findOne({
        where: { provider: 'zoom', [Op.or]: [
          ...(data.meetingUuid ? [{ meetingUuid: data.meetingUuid }] : []),
          ...(data.meetingId ? [{ externalMeetingId: data.meetingId }] : []),
        ] },
        include: [{ model: ZoomConnection, as: 'zoomConnection', attributes: ['zoomAccountId', 'zoomUserId'] }],
      });
      if (meeting && (!data.accountId || !meeting.zoomConnection?.zoomAccountId || data.accountId === meeting.zoomConnection.zoomAccountId)) {
        const consultation = await Consultation.findByPk(meeting.consultationId);
        const occurredAt = new Date(data.occurredAt);
        const role = await participantRole(consultation, data.customerKey, data.providerUserId, meeting);
        if (['cancelled', 'rejected'].includes(consultation.status) || ['cancelled'].includes(meeting.status)) {
          await event.update({ status: 'processed', processedAt: new Date() });
          return;
        }
        if (event.event === 'meeting.started' && !['cancelled', 'ended'].includes(meeting.status)) {
          if (!meeting.startedAt || occurredAt < meeting.startedAt) await meeting.update({ status: 'started', startedAt: occurredAt, meetingUuid: data.meetingUuid || meeting.meetingUuid });
        } else if (event.event === 'participant.joined' && role) {
          await sequelize.transaction(async (transaction) => {
            const locked = await Consultation.findByPk(consultation.id, { transaction, lock: transaction.LOCK.UPDATE });
            if (['completed', 'cancelled'].includes(locked.lifecycleStatus)) return;
            if (meeting.endedAt && occurredAt > new Date(meeting.endedAt)) return;
            const correctingDelayedEvent = String(locked.lifecycleStatus).startsWith('no_show_')
              && locked.noShowCheckedAt && occurredAt <= new Date(locked.noShowCheckedAt);
            if (String(locked.lifecycleStatus).startsWith('no_show_') && !correctingDelayedEvent) return;
            if (correctingDelayedEvent) {
              const refund = await Payment.findOne({ where: { consultationId: locked.id, refundStatus: { [Op.in]: ['requested', 'completed'] } }, transaction, attributes: ['id'] });
              if (refund) {
                await MeetingEvent.create({ consultationId: locked.id, meetingId: meeting.id, providerEventId: event.requestId, eventType: 'attendance.late_after_refund', participantRole: role, occurredAt, correlationId: lifecycle.correlationIdFor(locked.id), metadata: {} }, { transaction });
                return;
              }
            }
            const field = role === 'lawyer' ? 'lawyerFirstJoinedAt' : 'clientFirstJoinedAt';
            if (!locked[field] || occurredAt < locked[field]) locked[field] = occurredAt;
            const otherField = role === 'lawyer' ? 'clientFirstJoinedAt' : 'lawyerFirstJoinedAt';
            if (locked[otherField]) {
              locked.conversationStartedAt ||= new Date(Math.max(new Date(locked[field]).getTime(), new Date(locked[otherField]).getTime()));
              locked.callStartedAt ||= locked.conversationStartedAt;
              if (locked.status === 'accepted') locked.status = 'in_progress';
              locked.graceEndsAt ||= new Date(new Date(locked.scheduledEndAt).getTime() + 5 * 60000);
              await locked.save({ transaction });
              await lifecycle.transition(locked, meeting.status === 'ended' ? 'completed' : 'in_progress', { transaction, meetingId: meeting.id, providerEventId: event.requestId, participantRole: role, occurredAt, force: true });
            } else {
              await locked.save({ transaction });
              if (String(locked.lifecycleStatus).startsWith('no_show_') && correctingDelayedEvent) {
                const corrected = locked.lawyerFirstJoinedAt ? 'no_show_client' : 'no_show_lawyer';
                await lifecycle.transition(locked, corrected, { transaction, meetingId: meeting.id, providerEventId: event.requestId, participantRole: role, occurredAt, force: true });
              } else if (!String(locked.lifecycleStatus).startsWith('no_show_')) {
                await lifecycle.transition(locked, role === 'lawyer' ? 'waiting_for_client' : 'waiting_for_lawyer', { transaction, meetingId: meeting.id, providerEventId: event.requestId, participantRole: role, occurredAt, force: true });
              }
            }
          });
        } else if (event.event === 'participant.left' && role) {
          await MeetingEvent.create({ consultationId: consultation.id, meetingId: meeting.id, providerEventId: event.requestId, eventType: 'participant.left', participantRole: role, occurredAt, correlationId: lifecycle.correlationIdFor(consultation.id), metadata: {} }).catch(() => {});
        } else if (event.event === 'meeting.ended') {
          if (meeting.status !== 'cancelled' && (!meeting.endedAt || occurredAt > meeting.endedAt)) await meeting.update({ status: 'ended', endedAt: occurredAt });
          await sequelize.transaction(async (transaction) => {
            const locked = await Consultation.findByPk(consultation.id, { transaction, lock: transaction.LOCK.UPDATE });
            locked.finalLeftAt = occurredAt;
            if (locked.conversationStartedAt) locked.actualDuration = Math.max(0, Math.round((occurredAt.getTime() - new Date(locked.conversationStartedAt).getTime()) / 1000));
            if (locked.lawyerFirstJoinedAt && locked.clientFirstJoinedAt) locked.lawyerEndedAt ||= occurredAt;
            await locked.save({ transaction });
            if (!String(locked.lifecycleStatus).startsWith('no_show_')) {
              const fallbackAccess = locked.lawyerFirstJoinedAt && !locked.clientFirstJoinedAt
                ? await MeetingEvent.findOne({ where: { consultationId: locked.id, eventType: 'external_access_issued', participantRole: 'client' }, transaction, attributes: ['id'] }) : null;
              if (locked.lawyerFirstJoinedAt && (locked.clientFirstJoinedAt || fallbackAccess)) {
                locked.lawyerEndedAt ||= occurredAt;
                await locked.save({ transaction });
                await lifecycle.transition(locked, 'completed', { transaction, meetingId: meeting.id, providerEventId: event.requestId, occurredAt, force: true });
              }
            }
          });
          await consultation.reload();
          if (consultation.lifecycleStatus === 'completed') {
            logger.info('meeting_completed', { consultationId: consultation.id, correlationId: lifecycle.correlationIdFor(consultation.id), source: 'zoom_webhook' });
            await notificationService.createNotification(consultation.clientId, 'consultation_completion_requested', 'Zoom-консультация завершена', 'Подтвердите результат консультации в кабинете.', { consultationId: consultation.id });
          } else if (String(consultation.lifecycleStatus).startsWith('no_show_')) {
            const absentId = consultation.lifecycleStatus === 'no_show_client' ? consultation.clientId : consultation.lawyerId;
            const waitingId = consultation.lifecycleStatus === 'no_show_client' ? consultation.lawyerId : consultation.clientId;
            await Promise.allSettled([
              notificationService.createNotification(absentId, consultation.lifecycleStatus, 'Вы пропустили консультацию', 'Обратитесь в поддержку для переноса или урегулирования оплаты.', { consultationId: consultation.id }),
              notificationService.createNotification(waitingId, consultation.lifecycleStatus, 'Участник не подключился', 'Вы можете перенести консультацию или обратиться в поддержку.', { consultationId: consultation.id }),
            ]);
          }
        }
      }
    }
    await event.update({ status: 'processed', processedAt: new Date() });
    logger.info('zoom_webhook_processed', { requestId: event.requestId, event: event.event });
  } catch (error) {
    const attempts = Number(event.attemptCount || 0) + 1;
    const dead = attempts >= 6;
    await event.update({
      status: dead ? 'dead_letter' : 'failed', attemptCount: attempts,
      nextAttemptAt: dead ? null : new Date(Date.now() + Math.min(30 * 60 * 1000, 30000 * (2 ** (attempts - 1)))),
      lastError: String(error.code || 'WEBHOOK_PROCESSING_FAILED').slice(0, 255), processedAt: null,
    }).catch(() => {});
    if (dead) {
      const admins = await User.findAll({ where: { role: 'admin', isActive: true }, attributes: ['id'] }).catch(() => []);
      await Promise.allSettled(admins.map((admin) => notificationService.createNotification(admin.id, 'zoom_webhook_failed', 'Ошибка Zoom webhook', 'Событие Zoom требует ручной диагностики.', { webhookEventId: event.id })));
    }
    logger.error('Zoom webhook processing failed', { requestId: event.requestId, event: event.event, code: error.code, message: error.message });
    throw error;
  }
}

async function handle(req, res) {
  const raw = req.body.toString('utf8');
  if (!verify(raw, req.get('x-zm-request-timestamp'), req.get('x-zm-signature'))) {
    logger.warn('webhook_rejected', { provider: 'zoom', reason: 'invalid_signature' });
    return res.status(401).json({ error: 'Invalid Zoom signature' });
  }
  let payload;
  try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (payload.event === 'endpoint.url_validation') {
    const plainToken = typeof payload.payload?.plainToken === 'string' ? payload.payload.plainToken : '';
    if (!plainToken || plainToken.length > 512) return res.status(400).json({ error: 'Invalid validation token' });
    return res.json({ plainToken, encryptedToken: crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET).update(plainToken).digest('hex') });
  }
  const digest = crypto.createHash('sha256').update(raw).digest('hex');
  const requestHeader = req.get('x-zm-request-id');
  if (requestHeader && requestHeader.length > 255) return res.status(400).json({ error: 'Invalid Zoom request id' });
  const requestId = requestHeader || `body:${digest}`;
  const object = payload.payload?.object || {};
  const participant = object.participant || {};
  const minimalPayload = {
    accountId: payload.payload?.account_id || payload.payload?.accountId || null,
    meetingId: object.id != null ? String(object.id) : null,
    meetingUuid: object.uuid || null,
    customerKey: participant.customer_key || participant.customerKey || null,
    providerUserId: participant.user_id || null,
    occurredAt: eventTime(payload).toISOString(),
    digest,
  };
  const [webhookEvent, created] = await ZoomWebhookEvent.findOrCreate({
    where: { requestId }, defaults: { event: payload.event || 'unknown', payload: minimalPayload, status: 'queued', attemptCount: 0, nextAttemptAt: new Date(), processedAt: null },
  });
  logger.info('zoom_webhook_received', { requestId, event: payload.event || 'unknown', duplicate: !created });
  if (!created) {
    if (webhookEvent.payload?.digest !== minimalPayload.digest) {
      logger.warn('webhook_rejected', { provider: 'zoom', reason: 'request_id_payload_mismatch', requestId });
      return res.status(401).json({ error: 'Invalid replay' });
    }
    if (webhookEvent.status === 'processed') return res.status(204).end();
  }
  res.status(204).end();
  setImmediate(() => processEventById(webhookEvent.id).catch(() => {}));
}

async function reconcileWebhookEvents() {
  const now = new Date();
  const events = await ZoomWebhookEvent.findAll({ where: { [Op.or]: [{ status: 'queued' }, { status: 'failed', nextAttemptAt: { [Op.lte]: now } }, { status: 'processing', updatedAt: { [Op.lt]: new Date(now.getTime() - 5 * 60 * 1000) } }] }, order: [['createdAt', 'ASC']], limit: 100 });
  for (const event of events) await processEventById(event.id).catch(() => {});
  return events.length;
}

module.exports = { verify, handle, processEventById, reconcileWebhookEvents };
