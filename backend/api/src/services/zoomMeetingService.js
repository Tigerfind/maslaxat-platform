const crypto = require('crypto');
const os = require('os');
const { DateTime } = require('luxon');
const { Op } = require('sequelize');
const { sequelize, Consultation, ConsultationMeeting, ZoomConnection, Payment, User } = require('../models');
const zoomApi = require('./zoomApiService');
const secretBox = require('./secretBox');
const notificationService = require('./notificationService');
const lifecycle = require('./consultationLifecycleService');
const logger = require('../config/logger');

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const MAX_ATTEMPTS = Math.min(12, Math.max(1, Number(process.env.ZOOM_MEETING_MAX_ATTEMPTS) || 6));
const markerFor = (consultationId) => `emaslaxat:${consultationId}`;
const idempotencyKeyFor = (consultationId, operation, version) => crypto.createHash('sha256').update(`${consultationId}:${operation}:${version}`).digest('hex');
const terminalConsultation = (status) => ['completed', 'cancelled', 'rejected'].includes(status);
const safeError = (error) => ({
  code: error.code || 'ZOOM_OPERATION_FAILED',
  message: ['ZOOM_TIMEOUT', 'ZOOM_NETWORK_ERROR', 'ZOOM_RATE_LIMITED', 'ZOOM_UPSTREAM_ERROR'].includes(error.code)
    ? 'Zoom временно недоступен' : error.code === 'ZOOM_REAUTH_REQUIRED' ? 'Zoom юриста требуется подключить повторно' : 'Не удалось подготовить Zoom-встречу',
});

async function findRemoteMeeting(connection, consultationId) {
  const marker = markerFor(consultationId);
  let nextPageToken = '';
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({ type: 'scheduled', page_size: '300', ...(nextPageToken ? { next_page_token: nextPageToken } : {}) });
    const response = await zoomApi.api(connection, `/users/me/meetings?${query}`);
    const found = (response?.meetings || []).find((item) => item.agenda === marker);
    if (found) return found;
    nextPageToken = response?.next_page_token;
    if (!nextPageToken) break;
  }
  return null;
}

async function queueOperation(consultationId, operation) {
  return sequelize.transaction(async (transaction) => {
    const consultation = await Consultation.findByPk(consultationId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!consultation || (operation !== 'cancel' && consultation.meetingProvider !== 'zoom')) return null;
    const connection = await ZoomConnection.findOne({ where: { userId: consultation.lawyerId }, transaction });
    let meeting = await ConsultationMeeting.findOne({ where: { consultationId }, transaction });
    if (!meeting && operation === 'cancel') return null;
    if (!meeting) [meeting] = await ConsultationMeeting.findOrCreate({
      where: { consultationId }, defaults: { provider: 'zoom', zoomConnectionId: connection?.id, status: 'queued', desiredState: 'ready', scheduledAt: consultation.scheduledStartAt, duration: consultation.duration }, transaction,
    });
    meeting = await ConsultationMeeting.findByPk(meeting.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (operation === 'create' && meeting.pendingOperation === 'create' && meeting.status === 'creating') return meeting;
    const version = Number(meeting.operationVersion || 0) + 1;
    await meeting.update({
      zoomConnectionId: connection?.id || meeting.zoomConnectionId,
      desiredState: operation === 'cancel' ? 'cancelled' : operation === 'end' ? 'ended' : 'ready', pendingOperation: operation,
      operationVersion: version, idempotencyKey: idempotencyKeyFor(consultationId, operation, version),
      status: operation === 'cancel' ? 'cancellation_pending' : operation === 'end' ? 'ending' : operation === 'update' ? 'update_pending' : 'creating',
      attemptCount: 0, nextAttemptAt: new Date(), lastError: null, lastSafeError: null,
    }, { transaction });
    if (operation === 'create') await lifecycle.transition(consultation, 'meeting_creating', { transaction, meetingId: meeting.id, force: true });
    if (operation === 'update') await lifecycle.transition(consultation, 'rescheduled', { transaction, meetingId: meeting.id, force: true });
    if (operation === 'create') logger.info('meeting_create_started', { consultationId, correlationId: lifecycle.correlationIdFor(consultationId), operationVersion: version });
    return meeting;
  });
}

async function acquireLease(meetingId) {
  const now = new Date();
  const leaseToken = `${WORKER_ID}:${crypto.randomUUID()}`;
  const [count] = await ConsultationMeeting.update(
    { leaseOwner: leaseToken, leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000), lastAttemptAt: now },
    { where: { id: meetingId, [Op.or]: [{ leaseExpiresAt: null }, { leaseExpiresAt: { [Op.lt]: now } }] } },
  );
  if (!count) return null;
  const meeting = await ConsultationMeeting.findByPk(meetingId);
  meeting._leaseToken = leaseToken;
  return meeting;
}

async function commitOperation(meeting, version, values) {
  const [updated] = await ConsultationMeeting.update(values, {
    where: { id: meeting.id, operationVersion: version, leaseOwner: meeting._leaseToken },
  });
  if (!updated) return false;
  await meeting.reload();
  return true;
}

async function releaseLease(meeting) {
  if (!meeting?._leaseToken) return;
  await ConsultationMeeting.update({ leaseOwner: null, leaseExpiresAt: null }, { where: { id: meeting.id, leaseOwner: meeting._leaseToken } });
}

async function markFailure(meeting, version, error, operation) {
  const attempts = Number(meeting.attemptCount || 0) + 1;
  const permanentCodes = ['ZOOM_REAUTH_REQUIRED', 'MEETING_NOT_CONFIRMED', 'ZOOM_REQUEST_REJECTED'];
  const permanent = error.retryable === false || permanentCodes.includes(error.code) || attempts >= MAX_ATTEMPTS;
  const delay = Math.min(30 * 60 * 1000, 30000 * (2 ** Math.max(0, attempts - 1))) + Math.floor(Math.random() * 5000);
  const safe = safeError(error);
  const committed = await commitOperation(meeting, version, {
    attemptCount: attempts, status: permanent ? (operation === 'cancel' ? 'cancellation_failed' : operation === 'end' ? 'end_failed' : 'failed') : meeting.status,
    pendingOperation: permanent ? null : meeting.pendingOperation,
    nextAttemptAt: permanent ? null : new Date(Date.now() + delay), leaseOwner: null, leaseExpiresAt: null,
    lastError: safe.code, lastSafeError: safe.message, lastHttpStatus: error.status || null, providerRequestId: error.requestId || null,
  });
  if (!committed) { await releaseLease(meeting); return false; }
  if (permanent) {
    const consultation = await Consultation.findByPk(meeting.consultationId);
    if (consultation && ['create', 'update'].includes(operation)) await lifecycle.transition(consultation, 'failed', { meetingId: meeting.id, force: true, metadata: { code: safe.code } });
    const admins = await User.findAll({ where: { role: 'admin', isActive: true }, attributes: ['id'] });
    await Promise.allSettled([
      ...(consultation ? [notificationService.createNotification(consultation.lawyerId, 'zoom_failed', 'Ошибка Zoom-встречи', 'Переподключите Zoom или перенесите консультацию.', { consultationId: consultation.id })] : []),
      ...(consultation ? [notificationService.createNotification(consultation.clientId, 'zoom_failed', 'Zoom-встреча временно недоступна', 'Мы уведомили юриста. Перенесите консультацию или обратитесь в поддержку.', { consultationId: consultation.id })] : []),
      ...admins.map((admin) => notificationService.createNotification(admin.id, 'zoom_failed', 'Ошибка создания Zoom-встречи', safe.message, { consultationId: meeting.consultationId })),
    ]);
  }
  return true;
}

async function processMeetingOperation(meetingId) {
  const meeting = await acquireLease(meetingId);
  if (!meeting?.pendingOperation) return meeting;
  const claimedVersion = Number(meeting.operationVersion);
  const consultation = await Consultation.findByPk(meeting.consultationId);
  if (!consultation) return meeting.update({ status: 'failed', pendingOperation: null, lastSafeError: 'Консультация не найдена', leaseOwner: null, leaseExpiresAt: null });
  let operation = terminalConsultation(consultation.status) || meeting.desiredState === 'cancelled' ? 'cancel' : meeting.pendingOperation;
  const connection = await ZoomConnection.findOne({ where: { id: meeting.zoomConnectionId, status: 'connected' } });
  try {
    if (operation === 'cancel') {
      if (meeting.externalMeetingId && !connection) throw new zoomApi.ZoomApiError('Zoom connection unavailable for cancellation', { code: 'ZOOM_REAUTH_REQUIRED' });
      if (meeting.externalMeetingId) await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`, { method: 'DELETE' });
      if (!await commitOperation(meeting, claimedVersion, { status: 'cancelled', desiredState: 'cancelled', pendingOperation: null, cancelledAt: new Date(), lastError: null, lastSafeError: null, leaseOwner: null, leaseExpiresAt: null })) await releaseLease(meeting);
      return meeting;
    }
    if (operation === 'end') {
      if (meeting.externalMeetingId && !connection) throw new zoomApi.ZoomApiError('Zoom connection unavailable for ending', { code: 'ZOOM_REAUTH_REQUIRED' });
      if (meeting.externalMeetingId) await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}/status`, { method: 'PUT', body: JSON.stringify({ action: 'end' }) });
      if (!await commitOperation(meeting, claimedVersion, { status: 'ended', desiredState: 'ended', pendingOperation: null, endedAt: new Date(), lastError: null, lastSafeError: null, leaseOwner: null, leaseExpiresAt: null })) await releaseLease(meeting);
      return meeting;
    }
    if (!connection) throw new zoomApi.ZoomApiError('Zoom connection unavailable', { code: 'ZOOM_REAUTH_REQUIRED' });
    if (operation === 'update') {
      if (!meeting.externalMeetingId) {
        operation = 'create';
        meeting.pendingOperation = 'create';
      }
      if (operation === 'update') {
        await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`, { method: 'PATCH', body: JSON.stringify({ start_time: DateTime.fromJSDate(consultation.scheduledStartAt).toUTC().toISO(), duration: consultation.duration, timezone: consultation.scheduleTimezone }) });
        const committed = await commitOperation(meeting, claimedVersion, { scheduledAt: consultation.scheduledStartAt, duration: consultation.duration, status: 'ready', pendingOperation: null, attemptCount: 0, nextAttemptAt: null, lastError: null, lastSafeError: null, leaseOwner: null, leaseExpiresAt: null });
        if (committed) await lifecycle.transition(consultation, 'ready', { meetingId: meeting.id, force: true });
        else await releaseLease(meeting);
        return meeting;
      }
    }
    const paid = consultation.isFree || consultation.billingStatus === 'charged' || Boolean(await Payment.findOne({ where: { consultationId: consultation.id, status: 'paid' } }));
    if (consultation.status !== 'accepted' || !paid) throw new zoomApi.ZoomApiError('Consultation is not confirmed and paid', { code: 'MEETING_NOT_CONFIRMED' });
    let remote = await findRemoteMeeting(connection, consultation.id);
    if (remote) remote = await zoomApi.api(connection, `/meetings/${remote.id}`);
    else remote = await zoomApi.api(connection, '/users/me/meetings', { method: 'POST', body: JSON.stringify({
      topic: 'Юридическая консультация eMaslaXat', agenda: markerFor(consultation.id), type: 2,
      start_time: DateTime.fromJSDate(consultation.scheduledStartAt).toUTC().toISO(), duration: consultation.duration,
      timezone: consultation.scheduleTimezone || 'Asia/Tashkent',
      settings: { waiting_room: true, join_before_host: false, mute_upon_entry: true, auto_recording: 'none' },
    }) });
    await consultation.reload();
    const latest = await ConsultationMeeting.findByPk(meeting.id);
    if (Number(latest.operationVersion) !== claimedVersion) {
      if (latest.desiredState === 'cancelled') {
        await zoomApi.api(connection, `/meetings/${remote.id}`, { method: 'DELETE' }).catch(() => null);
      } else if (!latest.externalMeetingId) {
        await ConsultationMeeting.update({
          externalMeetingId: String(remote.id), meetingUuid: remote.uuid || null,
          joinUrlEncrypted: secretBox.encrypt(remote.join_url, `meeting:${meeting.id}:join`),
          passcodeEncrypted: secretBox.encrypt(remote.password || '', `meeting:${meeting.id}:passcode`),
        }, { where: { id: meeting.id, operationVersion: latest.operationVersion, externalMeetingId: null } });
      }
      await releaseLease(meeting);
      return latest;
    }
    if (terminalConsultation(consultation.status) || latest.desiredState === 'cancelled') {
      await zoomApi.api(connection, `/meetings/${remote.id}`, { method: 'DELETE' }).catch(() => null);
      await commitOperation(meeting, claimedVersion, { externalMeetingId: String(remote.id), status: 'cancelled', desiredState: 'cancelled', pendingOperation: null, cancelledAt: new Date(), leaseOwner: null, leaseExpiresAt: null });
      return latest;
    }
    const committed = await commitOperation(meeting, claimedVersion, {
      externalMeetingId: String(remote.id), meetingUuid: remote.uuid || meeting.meetingUuid, status: 'ready', desiredState: 'ready', pendingOperation: null,
      joinUrlEncrypted: secretBox.encrypt(remote.join_url, `meeting:${meeting.id}:join`),
      passcodeEncrypted: secretBox.encrypt(remote.password || '', `meeting:${meeting.id}:passcode`),
      startUrlEncrypted: null, scheduledAt: consultation.scheduledStartAt, duration: consultation.duration,
      attemptCount: 0, nextAttemptAt: null, lastError: null, lastSafeError: null, leaseOwner: null, leaseExpiresAt: null,
    });
    if (!committed) {
      await zoomApi.api(connection, `/meetings/${remote.id}`, { method: 'DELETE' }).catch(() => null);
      await releaseLease(meeting);
      return ConsultationMeeting.findByPk(meeting.id);
    }
    await lifecycle.transition(consultation, 'ready', { meetingId: meeting.id, force: true });
    logger.info('meeting_create_succeeded', { consultationId: consultation.id, correlationId: lifecycle.correlationIdFor(consultation.id), attemptCount: meeting.attemptCount });
    await Promise.allSettled([
      notificationService.createNotification(consultation.clientId, 'zoom_ready', 'Zoom-встреча готова', 'Откройте консультацию для подключения.', { consultationId: consultation.id }),
      notificationService.createNotification(consultation.lawyerId, 'zoom_ready', 'Zoom-встреча готова', 'Откройте консультацию, чтобы начать Zoom.', { consultationId: consultation.id }),
    ]);
    return meeting;
  } catch (error) {
    await markFailure(meeting, claimedVersion, error, operation);
    logger.warn(operation === 'create' ? 'meeting_create_failed' : 'meeting_operation_failed', { consultationId: meeting.consultationId, correlationId: lifecycle.correlationIdFor(meeting.consultationId), operation, code: error.code, retryable: error.retryable });
    throw error;
  }
}

async function maybeProvision(consultationId) {
  let meeting = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (meeting?.status === 'ready' && !meeting.pendingOperation) return meeting;
  if (meeting?.status === 'failed' && !meeting.pendingOperation) return meeting;
  if (!meeting?.pendingOperation) meeting = await queueOperation(consultationId, 'create');
  if (!meeting) return null;
  return processMeetingOperation(meeting.id);
}

async function ensureProvisionQueued(consultationId) {
  const meeting = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (meeting?.pendingOperation || ['ready', 'started', 'ended', 'failed', 'cancelled'].includes(meeting?.status)) return meeting;
  return queueOperation(consultationId, 'create');
}

async function updateMeeting(consultationId) {
  const meeting = await queueOperation(consultationId, 'update');
  return meeting ? processMeetingOperation(meeting.id) : null;
}

async function cancelMeeting(consultationId) {
  const existing = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (!existing) return null;
  const meeting = await queueOperation(consultationId, 'cancel');
  return processMeetingOperation(meeting.id);
}

async function endMeeting(consultationId) {
  const existing = await ConsultationMeeting.findOne({ where: { consultationId } });
  if (!existing) return null;
  if (['ended', 'cancelled'].includes(existing.status) && !existing.pendingOperation) return existing;
  const meeting = await queueOperation(consultationId, 'end');
  return processMeetingOperation(meeting.id);
}

async function reconcilePendingMeetings() {
  const rows = await ConsultationMeeting.findAll({
    where: { pendingOperation: { [Op.ne]: null }, [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: new Date() } }] },
    order: [['nextAttemptAt', 'ASC NULLS FIRST']], limit: 50,
  });
  let recovered = 0;
  for (const meeting of rows) {
    try { const result = await processMeetingOperation(meeting.id); if (result && !result.pendingOperation) recovered += 1; }
    catch (error) { logger.warn('Zoom operation deferred', { consultationId: meeting.consultationId, operation: meeting.pendingOperation, code: error.code }); }
  }
  return recovered;
}

async function verifyUpcomingMeetings() {
  const now = new Date();
  const meetings = await ConsultationMeeting.findAll({
    where: {
      provider: 'zoom', status: 'ready', externalMeetingId: { [Op.ne]: null },
      scheduledAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      [Op.or]: [{ lastAttemptAt: null }, { lastAttemptAt: { [Op.lt]: new Date(now.getTime() - 15 * 60 * 1000) } }],
    }, limit: 20,
  });
  for (const meeting of meetings) {
    const connection = await ZoomConnection.findByPk(meeting.zoomConnectionId);
    if (!connection) continue;
    await meeting.update({ lastAttemptAt: now });
    try { await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`); }
    catch (error) {
      if (error.status === 404) {
        await meeting.update({ externalMeetingId: null, status: 'creating', pendingOperation: 'create', nextAttemptAt: new Date(), lastSafeError: 'Zoom-встреча была удалена; создаём новую' });
      } else logger.warn('Zoom preflight verification failed', { consultationId: meeting.consultationId, code: error.code });
    }
  }
  return meetings.length;
}

function startReconciliationJob() {
  if (!zoomApi.enabled()) return;
  const run = async () => {
    await reconcilePendingMeetings();
    await require('./zoomWebhookService').reconcileWebhookEvents();
    await verifyUpcomingMeetings();
  };
  const guardedRun = () => run().catch((error) => logger.error('Zoom reconciliation job failed', { code: error.code }));
  const timer = setInterval(guardedRun, 60 * 1000); timer.unref?.(); setTimeout(guardedRun, 15000).unref?.();
}

module.exports = { markerFor, queueOperation, processMeetingOperation, ensureProvisionQueued, maybeProvision, updateMeeting, cancelMeeting, endMeeting, reconcilePendingMeetings, verifyUpcomingMeetings, startReconciliationJob };
