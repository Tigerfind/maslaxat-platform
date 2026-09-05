const STATUS_KEYS = Object.freeze({
  pending_review: 'stPending',
  approved: 'stApproved',
  rejected: 'stRejected',
  draft: 'stDraft',
  suspended: 'stSuspended',
});

export const lawyerModerationStatusKey = (status) => STATUS_KEYS[status] || 'stUnknown';
