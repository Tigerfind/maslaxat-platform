const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Consultation, ConsultationMeeting, MeetingEvent, Payment, User, ZoomConnection } = require('../models');
const { consultationAccess } = require('./consultationAccessService');
const lifecycle = require('./consultationLifecycleService');
const secretBox = require('./secretBox');
const zoomApi = require('./zoomApiService');

const configured = (value) => Boolean(value && !String(value).includes('CHANGE_ME') && String(value).length >= 16);
const sdkEnabled = () => process.env.ZOOM_MEETING_SDK_ENABLED === '1' && zoomApi.enabled()
  && configured(process.env.MEETING_PARTICIPANT_SECRET) && configured(process.env.ZOOM_WEBHOOK_SECRET);
const customerKey = (consultationId, userId) => {
  if (!configured(process.env.MEETING_PARTICIPANT_SECRET)) throw new Error('Meeting participant secret is not configured');
  return crypto.createHmac('sha256', process.env.MEETING_PARTICIPANT_SECRET)
  .update(`${consultationId}:${userId}`).digest('base64url').slice(0, 36);
};

const signMeeting = (meetingNumber, role) => {
  const iat = Math.floor(Date.now() / 1000) - 30;
  const exp = iat + 30 * 60;
  return jwt.sign({ appKey: process.env.ZOOM_CLIENT_ID, mn: String(meetingNumber), role, iat, exp, tokenExp: exp }, process.env.ZOOM_CLIENT_SECRET, { algorithm: 'HS256', noTimestamp: true });
};

async function loadAuthorized(consultationId, userId, { requireJoinWindow = true } = {}) {
  const consultation = await Consultation.findByPk(consultationId, {
    include: [{ model: ConsultationMeeting, as: 'meeting' }],
  });
  if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(userId)) {
    throw Object.assign(new Error('Нет доступа'), { status: 403, code: 'ACCESS_DENIED' });
  }
  if (consultation.meetingProvider !== 'zoom') throw Object.assign(new Error('Это не Zoom-консультация'), { status: 409, code: 'NOT_ZOOM' });
  const paid = consultation.isFree || consultation.billingStatus === 'charged'
    || Boolean(await Payment.findOne({ where: { consultationId, status: 'paid' }, attributes: ['id'] }));
  if (!paid) throw Object.assign(new Error('Сначала завершите оплату'), { status: 402, code: 'PAYMENT_REQUIRED' });
  if (!['accepted', 'in_progress'].includes(consultation.status)) throw Object.assign(new Error('Консультация ещё не подтверждена'), { status: 409, code: 'CONSULTATION_NOT_READY' });
  if (!consultation.meeting || !['ready', 'started'].includes(consultation.meeting.status)) {
    throw Object.assign(new Error('Подготавливаем видеовстречу'), { status: 202, code: 'MEETING_PREPARING' });
  }
  const access = consultationAccess(consultation);
  if (requireJoinWindow && !access.canJoin) throw Object.assign(new Error('Подключение пока недоступно'), { status: 403, code: access.reason, access });
  return { consultation, meeting: consultation.meeting, access, role: userId === consultation.lawyerId ? 'lawyer' : 'client' };
}

async function preflight(consultationId, userId) {
  const consultation = await Consultation.findByPk(consultationId, { include: [{ model: ConsultationMeeting, as: 'meeting' }] });
  if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(userId)) throw Object.assign(new Error('Нет доступа'), { status: 403 });
  if (consultation.meetingProvider !== 'zoom') throw Object.assign(new Error('Это не Zoom-консультация'), { status: 409 });
  const meeting = consultation.meeting;
  const access = consultationAccess(consultation);
  const role = userId === consultation.lawyerId ? 'lawyer' : 'client';
  const paid = consultation.isFree || consultation.billingStatus === 'charged'
    || Boolean(await Payment.findOne({ where: { consultationId, status: 'paid' }, attributes: ['id'] }));
  const failed = meeting?.status === 'failed' && !meeting.pendingOperation;
  return {
    consultationId: consultation.id, role, meetingStatus: meeting?.status || 'not_created', lifecycleStatus: consultation.lifecycleStatus,
    duration: consultation.duration, scheduledStartAt: consultation.scheduledStartAt,
    scheduledEndAt: consultation.scheduledEndAt, timezone: consultation.scheduleTimezone,
    serverNow: new Date(), access, paid, failed, safeError: failed ? meeting.lastSafeError : null,
    preparing: !failed && (!meeting || !['ready', 'started'].includes(meeting.status)),
    sdkEnabled: sdkEnabled(), externalFallback: Boolean(meeting?.joinUrlEncrypted),
  };
}

async function sdkAccess(consultationId, userId) {
  if (!sdkEnabled()) throw Object.assign(new Error('Встроенный Zoom временно недоступен'), { status: 503, code: 'ZOOM_SDK_UNAVAILABLE' });
  const { consultation, meeting, access, role } = await loadAuthorized(consultationId, userId);
  const user = await User.findByPk(userId, { attributes: ['name'] });
  const sdkRole = role === 'lawyer' ? 1 : 0;
  let zak;
  if (sdkRole === 1) {
    const connection = await ZoomConnection.findByPk(meeting.zoomConnectionId);
    zak = await zoomApi.getZak(connection);
  }
  return {
    role, sdkKey: process.env.ZOOM_CLIENT_ID, signature: signMeeting(meeting.externalMeetingId, sdkRole),
    meetingNumber: String(meeting.externalMeetingId), password: secretBox.decrypt(meeting.passcodeEncrypted, `meeting:${meeting.id}:passcode`),
    userName: String(user?.name || (role === 'lawyer' ? 'Юрист' : 'Клиент')).slice(0, 80),
    customerKey: customerKey(consultation.id, userId), ...(zak ? { zak } : {}),
    serverNow: new Date(), scheduledStartAt: consultation.scheduledStartAt, scheduledEndAt: consultation.scheduledEndAt,
    duration: consultation.duration, timezone: consultation.scheduleTimezone, access,
  };
}

async function externalAccess(consultationId, userId) {
  const { consultation, meeting, role } = await loadAuthorized(consultationId, userId);
  let url;
  if (role === 'lawyer') {
    const connection = await ZoomConnection.findByPk(meeting.zoomConnectionId);
    const current = await zoomApi.api(connection, `/meetings/${meeting.externalMeetingId}`);
    url = current.start_url;
  } else url = secretBox.decrypt(meeting.joinUrlEncrypted, `meeting:${meeting.id}:join`);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/(^|\.)zoom\.(us|com|com\.cn)$/i.test(parsed.hostname)) {
    throw Object.assign(new Error('Zoom вернул небезопасную ссылку'), { status: 502, code: 'INVALID_ZOOM_URL' });
  }
  await MeetingEvent.create({ consultationId, meetingId: meeting.id, eventType: 'external_access_issued', participantRole: role, occurredAt: new Date(), correlationId: lifecycle.correlationIdFor(consultationId), metadata: {} });
  return { role, url };
}

module.exports = { sdkEnabled, signMeeting, customerKey, loadAuthorized, preflight, sdkAccess, externalAccess };
