const { sequelize, Consultation, MeetingEvent } = require('../models');
const lifecycle = require('./consultationLifecycleService');
const { requireSupportedCall } = require('./callProviderPolicy');

const EVENT_TYPE = 'webrtc.peer_connected';

async function hasBilateralPeerEvidence(consultationId, transaction) {
  const rows = await MeetingEvent.findAll({
    where: { consultationId, eventType: EVENT_TYPE, participantRole: ['client', 'lawyer'] },
    attributes: ['participantRole'],
    transaction,
    raw: true,
  });
  const roles = new Set(rows.map(({ participantRole }) => participantRole));
  return roles.has('client') && roles.has('lawyer');
}

async function recordPeerConnected(consultationId, userId, metadata = {}) {
  return sequelize.transaction(async (transaction) => {
    const consultation = await Consultation.findByPk(consultationId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!consultation || ![consultation.clientId, consultation.lawyerId].includes(userId)) {
      throw Object.assign(new Error('Access denied'), { status: 403, code: 'ACCESS_DENIED' });
    }
    requireSupportedCall(consultation);
    const role = userId === consultation.lawyerId ? 'lawyer' : 'client';
    const existing = await MeetingEvent.findOne({
      where: { consultationId, eventType: EVENT_TYPE, participantRole: role },
      transaction,
    });
    if (!existing) {
      await MeetingEvent.create({
        consultationId,
        eventType: EVENT_TYPE,
        participantRole: role,
        occurredAt: new Date(),
        correlationId: lifecycle.correlationIdFor(consultationId),
        metadata: { provider: 'webrtc', ...metadata },
      }, { transaction });
    }
    const bilateral = await hasBilateralPeerEvidence(consultationId, transaction);
    let started = false;
    if (bilateral && !consultation.callStartedAt) {
      consultation.callStartedAt = new Date();
      if (consultation.status === 'accepted') consultation.status = 'in_progress';
      await consultation.save({ transaction });
      started = true;
    }
    return { consultation, role, bilateral, started, duplicate: Boolean(existing) };
  });
}

module.exports = { EVENT_TYPE, hasBilateralPeerEvidence, recordPeerConnected };
