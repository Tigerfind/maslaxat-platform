const { Op, literal } = require('sequelize');
const logger = require('../config/logger');
const { consultationAccess } = require('./consultationAccessService');

const STATUSES = Object.freeze([
  'payment_pending', 'payment_expired', 'pending', 'accepted', 'rejected',
  'in_progress', 'completed', 'cancelled',
]);
const BUCKETS = Object.freeze(['all', 'payment_pending', 'upcoming', 'completed', 'cancelled', 'archived']);
const ACTIVE_STATUSES = Object.freeze(['pending', 'accepted', 'in_progress']);
const TERMINAL_STATUSES = Object.freeze(['payment_expired', 'rejected', 'completed', 'cancelled']);
const CANCELLATION_STATUSES = Object.freeze(['cancelled', 'rejected', 'payment_expired']);
const ARCHIVABLE_STATUSES = Object.freeze(['completed', ...CANCELLATION_STATUSES]);
const WRITABLE_STATUSES = Object.freeze(['accepted', 'in_progress']);
const CANCELLATION_TYPES = Object.freeze({
  client_cancelled: { code: 'CLIENT_CANCELLED', label: 'Отменена клиентом' },
  lawyer_cancelled: { code: 'LAWYER_CANCELLED', label: 'Отменена юристом' },
  admin_cancelled: { code: 'ADMIN_CANCELLED', label: 'Отменена администратором' },
  provider_cancelled: { code: 'PROVIDER_CANCELLED', label: 'Отменена платёжным провайдером' },
  lawyer_rejected: { code: 'LAWYER_REJECTED', label: 'Юрист отклонил запрос' },
  payment_expired: { code: 'PAYMENT_EXPIRED', label: 'Истёк срок оплаты' },
});
const TRANSITIONS = Object.freeze({
  lawyer: Object.freeze({
    payment_pending: Object.freeze(['rejected']),
    pending: Object.freeze(['accepted', 'rejected']),
    accepted: Object.freeze(['rejected', 'in_progress']),
    in_progress: Object.freeze(['completed']),
  }),
  admin: Object.freeze({ pending: Object.freeze(['accepted']) }),
});

function knownStatus(status) {
  const known = STATUSES.includes(status);
  if (!known) logger.warn('Unknown consultation status', { status });
  return known;
}

function isParticipant(consultation, userId) {
  return Boolean(consultation && userId
    && (consultation.clientId === userId || consultation.lawyerId === userId));
}

function isWritable(consultation) {
  return Boolean(consultation && !consultation.archivedAt
    && WRITABLE_STATUSES.includes(consultation.status));
}

const canTransition = (role, from, to) => Boolean(TRANSITIONS[role]?.[from]?.includes(to));

function bucketOf(consultation) {
  const status = consultation?.status;
  if (consultation?.archivedAt) return 'archived';
  if (!knownStatus(status)) return 'unknown';
  if (status === 'payment_pending') return 'payment_pending';
  if (ACTIVE_STATUSES.includes(status)) return 'upcoming';
  if (status === 'completed') return 'completed';
  if (CANCELLATION_STATUSES.includes(status)) return 'cancelled';
  return 'unknown';
}

function applyBucket(where, bucket) {
  if (bucket === 'all') return where;
  if (bucket === 'archived') where.archivedAt = { [Op.ne]: null };
  else where.archivedAt = null;
  if (bucket === 'payment_pending') where.status = 'payment_pending';
  if (bucket === 'upcoming') where.status = { [Op.in]: ACTIVE_STATUSES };
  if (bucket === 'completed') where.status = 'completed';
  if (bucket === 'cancelled') where.status = { [Op.in]: CANCELLATION_STATUSES };
  return where;
}

function orderFor(bucket = 'all') {
  if (bucket === 'upcoming') {
    return [
      [literal(`CASE "Consultation"."status" WHEN 'in_progress' THEN 0 WHEN 'accepted' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END`), 'ASC'],
      [literal('CASE WHEN "Consultation"."scheduled_start_at" IS NULL THEN 1 ELSE 0 END'), 'ASC'],
      ['scheduledStartAt', 'ASC'], ['id', 'ASC'],
    ];
  }
  return [
    [literal(`CASE WHEN "Consultation"."status" = 'in_progress' THEN 0 WHEN "Consultation"."scheduled_start_at" >= NOW() THEN 1 WHEN "Consultation"."scheduled_start_at" IS NULL THEN 3 ELSE 2 END`), 'ASC'],
    [literal(`CASE WHEN "Consultation"."scheduled_start_at" >= NOW() THEN "Consultation"."scheduled_start_at" END`), 'ASC'],
    [literal(`CASE WHEN "Consultation"."scheduled_start_at" < NOW() THEN "Consultation"."scheduled_start_at" END`), 'DESC'],
    ['id', 'ASC'],
  ];
}

function paymentConfirmed(consultation) {
  if (consultation?.isFree || Number(consultation?.price) === 0) return true;
  return (consultation?.payments || []).some((payment) => payment.status === 'paid' && payment.refundStatus !== 'completed');
}

function validSchedule(consultation) {
  const start = consultation?.scheduledStartAt ? new Date(consultation.scheduledStartAt) : null;
  const end = consultation?.scheduledEndAt ? new Date(consultation.scheduledEndAt) : null;
  return Boolean(start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start);
}

function hasCompletionEvidence(consultation, now = new Date()) {
  if (consultation?.status !== 'in_progress') return false;
  if (['no_show_client', 'no_show_lawyer', 'no_show_both'].includes(consultation.lifecycleStatus)) return false;
  if (consultation.type === 'chat') return Boolean(consultation.bilateralMessageEvidence);
  if (!validSchedule(consultation) || new Date(consultation.scheduledStartAt) > now) return false;
  if (consultation.meetingProvider === 'zoom') return Boolean(consultation.conversationStartedAt);
  if (['video', 'phone'].includes(consultation.type)) return Boolean(consultation.callStartedAt);
  // Chat completion requires messages from both parties. Lists do not load message
  // history, so omission is safer than advertising an action the route may reject.
  return false;
}

function availableActions(consultation, role, now = new Date(), canJoin = false) {
  const status = consultation?.status;
  const actions = ['view_details'];
  if (!knownStatus(status)) return actions;
  const hasSchedule = validSchedule(consultation);

  if (role === 'client') {
    if (consultation.archivedAt) {
      if (status === 'completed' || CANCELLATION_STATUSES.includes(status)) {
        actions.push('read_chat', 'documents', 'unarchive');
      }
      return [...new Set(actions)];
    }
    if (status === 'payment_pending') actions.push('pay', 'cancel');
    if (status === 'pending') actions.push('reschedule', 'cancel');
    if (['pending', 'accepted'].includes(status) && hasSchedule) actions.push('calendar');
    if (status === 'accepted') actions.push('reschedule', 'cancel', 'open_chat', 'documents');
    if (status === 'in_progress') actions.push('open_chat', 'documents');
    if (canJoin && ['accepted', 'in_progress'].includes(status)) actions.push('join');
    if (hasCompletionEvidence(consultation, now)) actions.push('complete');
    if (status === 'completed') {
      if (!consultation.consultationReview) actions.push('rate');
      actions.push('rebook', 'read_chat', 'documents', consultation.archivedAt ? 'unarchive' : 'archive');
    }
    if (CANCELLATION_STATUSES.includes(status)) {
      actions.push('rebook', 'read_chat', 'documents', 'archive');
    }
  } else if (role === 'lawyer') {
    if (status === 'pending') actions.push('accept', 'reject');
    if (['pending', 'accepted'].includes(status) && hasSchedule) actions.push('calendar');
    if (status === 'accepted') actions.push('reschedule', 'cancel', 'open_chat', 'documents');
    if (status === 'in_progress') actions.push('open_chat', 'documents');
    if (canJoin && ['accepted', 'in_progress'].includes(status)) actions.push('join');
    if (TERMINAL_STATUSES.includes(status)) actions.push('read_chat', 'documents');
  }
  return [...new Set(actions)];
}

function policyDto(consultation, role, now = new Date()) {
  const status = consultation?.status;
  const known = knownStatus(status);
  const access = consultationAccess(consultation, now);
  const meetingStatus = consultation?.meeting?.status || (consultation?.meetingProvider === 'zoom' ? 'not_ready' : 'ready');
  let canJoin = access.canJoin && paymentConfirmed(consultation);
  let reason = access.reason;
  if (access.canJoin && !paymentConfirmed(consultation)) { canJoin = false; reason = 'PAYMENT_REQUIRED'; }
  if (canJoin && consultation?.meetingProvider === 'zoom' && !['ready', 'started'].includes(meetingStatus)) {
    canJoin = false; reason = 'MEETING_NOT_READY';
  }
  if (['no_show_client', 'no_show_lawyer', 'no_show_both'].includes(consultation?.lifecycleStatus)) {
    canJoin = false;
    reason = consultation.lifecycleStatus === 'no_show_both'
      ? 'BOTH_NO_SHOW'
      : consultation.lifecycleStatus === 'no_show_lawyer' ? 'LAWYER_NO_SHOW' : 'CLIENT_NO_SHOW';
  }
  const inferredType = consultation?.cancellationType
    || (status === 'payment_expired' ? 'payment_expired' : status === 'rejected' ? 'lawyer_rejected' : null);
  const cancellation = inferredType
    ? CANCELLATION_TYPES[inferredType]
    : status === 'cancelled' ? { code: 'CONSULTATION_CANCELLED', label: 'Консультация отменена' } : null;
  return {
    status: known ? status : 'unknown', statusKnown: known, bucket: bucketOf(consultation),
    availableActions: availableActions(consultation, role, new Date(now), canJoin),
    canJoin, joinAvailableAt: access.opensAt || null, joinExpiresAt: access.closesAt || null,
    meetingStatus, serverNow: new Date(now), reason: canJoin ? null : reason,
    cancellation: cancellation ? { ...cancellation, type: inferredType, reason: consultation.cancellationReason || null } : null,
    chatWritable: isWritable(consultation),
    documentsWritable: isWritable(consultation),
  };
}

module.exports = {
  STATUSES, BUCKETS, ACTIVE_STATUSES, TERMINAL_STATUSES, CANCELLATION_STATUSES, WRITABLE_STATUSES,
  ARCHIVABLE_STATUSES, CANCELLATION_TYPES, TRANSITIONS, knownStatus, canTransition,
  bucketOf, applyBucket, orderFor, policyDto, paymentConfirmed,
  availableActions, validSchedule, hasCompletionEvidence, isParticipant, isWritable,
};
