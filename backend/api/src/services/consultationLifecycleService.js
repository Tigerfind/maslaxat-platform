const crypto = require('crypto');
const { Consultation, MeetingEvent } = require('../models');

const STATUSES = [
  'pending_payment', 'confirmed', 'meeting_creating', 'ready',
  'waiting_for_lawyer', 'waiting_for_client', 'in_progress', 'completed',
  'cancelled', 'failed', 'rescheduled', 'no_show_client', 'no_show_lawyer',
];

const TRANSITIONS = {
  pending_payment: ['confirmed', 'cancelled', 'failed'],
  confirmed: ['meeting_creating', 'ready', 'cancelled', 'rescheduled', 'failed'],
  meeting_creating: ['ready', 'cancelled', 'rescheduled', 'failed'],
  ready: ['waiting_for_lawyer', 'waiting_for_client', 'in_progress', 'cancelled', 'rescheduled', 'failed', 'no_show_client', 'no_show_lawyer'],
  waiting_for_lawyer: ['in_progress', 'completed', 'cancelled', 'no_show_lawyer', 'failed'],
  waiting_for_client: ['in_progress', 'completed', 'cancelled', 'no_show_client', 'failed'],
  in_progress: ['completed', 'failed'],
  rescheduled: ['meeting_creating', 'ready', 'cancelled', 'failed'],
  failed: ['meeting_creating', 'rescheduled', 'cancelled'],
  no_show_client: ['rescheduled', 'cancelled'],
  no_show_lawyer: ['rescheduled', 'cancelled'],
  completed: [], cancelled: [],
};

const correlationIdFor = (consultationId) => crypto.createHash('sha256').update(`meeting:${consultationId}`).digest('hex').slice(0, 24);

async function transition(consultationOrId, nextStatus, options = {}) {
  if (!STATUSES.includes(nextStatus)) throw Object.assign(new Error('Некорректный статус консультации'), { status: 400, code: 'INVALID_LIFECYCLE_STATUS' });
  const consultation = typeof consultationOrId === 'object'
    ? consultationOrId
    : await Consultation.findByPk(consultationOrId, { transaction: options.transaction, lock: options.transaction?.LOCK?.UPDATE });
  if (!consultation) throw Object.assign(new Error('Консультация не найдена'), { status: 404 });
  const current = consultation.lifecycleStatus || 'confirmed';
  if (current === nextStatus) return consultation;
  if (!options.force && !(TRANSITIONS[current] || []).includes(nextStatus)) {
    throw Object.assign(new Error(`Недопустимый переход ${current} → ${nextStatus}`), { status: 409, code: 'INVALID_LIFECYCLE_TRANSITION' });
  }
  consultation.lifecycleStatus = nextStatus;
  await consultation.save({ transaction: options.transaction });
  await MeetingEvent.create({
    consultationId: consultation.id,
    meetingId: options.meetingId || null,
    providerEventId: options.providerEventId || null,
    eventType: options.eventType || `lifecycle.${nextStatus}`,
    participantRole: options.participantRole || null,
    occurredAt: options.occurredAt || new Date(),
    correlationId: correlationIdFor(consultation.id),
    metadata: options.metadata || {},
  }, { transaction: options.transaction });
  return consultation;
}

module.exports = { STATUSES, TRANSITIONS, transition, correlationIdFor };
