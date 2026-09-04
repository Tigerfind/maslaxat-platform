const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Consultation, ConsultationMeeting, MeetingEvent, Payment, User, ZoomConnection } = require('../models');
const { consultationAccess } = require('./consultationAccessService');
const lifecycle = require('./consultationLifecycleService');
const secretBox = require('./secretBox');
const zoomApi = require('./zoomApiService');
const { GRACE_MINUTES } = require('./consultationAccessService');

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

async function accessPolicy(consultationId, userId) {
  const consultation = await Consultation.findByPk(consultationId, {
    include: [{ model: ConsultationMeeting, as: 'meeting' }],
  });
  if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(userId)) {
    throw Object.assign(new Error('Нет доступа'), { status: 403, code: 'ACCESS_DENIED' });
  }
  if (consultation.meetingProvider !== 'zoom') throw Object.assign(new Error('Это не Zoom-консультация'), { status: 409, code: 'NOT_ZOOM' });
  const paid = consultation.isFree || consultation.billingStatus === 'charged'
    || Boolean(await Payment.findOne({ where: { consultationId, status: 'paid' }, attributes: ['id'] }));
  const access = consultationAccess(consultation);
  let denial = null;
  if (!paid) denial = { status: 402, code: 'PAYMENT_REQUIRED', message: 'Сначала завершите оплату' };
  else if (!['accepted', 'in_progress'].includes(consultation.status)) denial = { status: 409, code: 'CONSULTATION_NOT_READY', message: 'Консультация ещё не подтверждена' };
  else if (['no_show_client', 'no_show_lawyer', 'no_show_both'].includes(consultation.lifecycleStatus)) denial = {
    status: 409,
    code: consultation.lifecycleStatus === 'no_show_both' ? 'BOTH_NO_SHOW' : consultation.lifecycleStatus === 'no_show_lawyer' ? 'LAWYER_NO_SHOW' : 'CLIENT_NO_SHOW',
    message: 'Участие зафиксировано как неявка; обратитесь в поддержку',
  };
  else if (!consultation.meeting || !['ready', 'started'].includes(consultation.meeting.status)) denial = { status: 202, code: 'MEETING_PREPARING', message: 'Подготавливаем видеовстречу' };
  else if (!access.canJoin) denial = { status: 403, code: access.reason, message: 'Подключение пока недоступно' };
  return {
    consultation, meeting: consultation.meeting, access, paid,
    role: userId === consultation.lawyerId ? 'lawyer' : 'client', denial,
  };
}

async function loadAuthorized(consultationId, userId) {
  const result = await accessPolicy(consultationId, userId);
  if (result.denial) {
    throw Object.assign(new Error(result.denial.message), {
      status: result.denial.status, code: result.denial.code, access: result.access,
    });
  }
  return result;
}

async function preflight(consultationId, userId) {
  const { consultation, meeting, access, role, paid, denial } = await accessPolicy(consultationId, userId);
  const failed = meeting?.status === 'failed' && !meeting.pendingOperation;
  return {
    consultationId: consultation.id, role, meetingStatus: meeting?.status || 'not_created', lifecycleStatus: consultation.lifecycleStatus,
    duration: consultation.duration, scheduledStartAt: consultation.scheduledStartAt,
    scheduledEndAt: consultation.scheduledEndAt, timezone: consultation.scheduleTimezone,
    serverNow: new Date(), access: { ...access, canJoin: !denial, reason: denial?.code || null }, paid, failed, safeError: failed ? meeting.lastSafeError : null,
    joinExpiresAt: access.closesAt || null,
    graceEndsAt: consultation.scheduledEndAt ? new Date(new Date(consultation.scheduledEndAt).getTime() + GRACE_MINUTES * 60000) : null,
    graceMinutes: GRACE_MINUTES,
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
    joinExpiresAt: access.closesAt || null,
    graceEndsAt: consultation.scheduledEndAt ? new Date(new Date(consultation.scheduledEndAt).getTime() + GRACE_MINUTES * 60000) : null,
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

module.exports = { sdkEnabled, signMeeting, customerKey, accessPolicy, loadAuthorized, preflight, sdkAccess, externalAccess };
