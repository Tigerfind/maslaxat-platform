const JOIN_EARLY_MINUTES = 15;
const JOIN_LATE_MINUTES = 120;

function consultationAccess(consultation, now = new Date()) {
  const start = consultation?.scheduledStartAt ? new Date(consultation.scheduledStartAt) : null;
  const end = consultation?.scheduledEndAt ? new Date(consultation.scheduledEndAt) : null;
  const serverNow = new Date(now);
  if (!['accepted', 'in_progress'].includes(consultation?.status)) {
    return { canJoin: false, reason: 'NOT_ACCEPTED', serverNow };
  }
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { canJoin: false, reason: 'INVALID_SCHEDULE', serverNow };
  }
  const opensAt = new Date(start.getTime() - JOIN_EARLY_MINUTES * 60000);
  const closesAt = new Date(end.getTime() + JOIN_LATE_MINUTES * 60000);
  if (serverNow < opensAt) return { canJoin: false, reason: 'TOO_EARLY', serverNow, opensAt, closesAt, retryAt: opensAt };
  if (serverNow > closesAt) return { canJoin: false, reason: 'WINDOW_CLOSED', serverNow, opensAt, closesAt };
  return { canJoin: true, reason: null, serverNow, opensAt, closesAt };
}

module.exports = { JOIN_EARLY_MINUTES, JOIN_LATE_MINUTES, consultationAccess };
