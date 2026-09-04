import * as Sentry from '@sentry/react';

export const CONSULTATION_TABS = ['all', 'payment_pending', 'upcoming', 'completed', 'cancelled', 'archived'];
export const CONSULTATION_PERIODS = ['all', '30d', '365d'];

export const STATUS_PRESENTATION = Object.freeze({
  payment_pending: { labelKey: 'status_payment_pending', color: '#B06A35', background: 'rgba(176,106,53,0.14)', icon: 'payment', step: 0 },
  payment_expired: { labelKey: 'status_payment_expired', color: '#B07070', background: 'rgba(176,112,112,0.14)', icon: 'cancel', terminal: true },
  pending: { labelKey: 'status_pending', color: '#C4A35A', background: 'rgba(196,163,90,0.14)', icon: 'time', step: 0 },
  accepted: { labelKey: 'status_accepted', color: '#7A9A6B', background: 'rgba(122,154,107,0.14)', icon: 'accepted', step: 1 },
  rejected: { labelKey: 'status_rejected', color: '#B07070', background: 'rgba(176,112,112,0.14)', icon: 'cancel', terminal: true },
  in_progress: { labelKey: 'status_in_progress', color: '#B8956E', background: 'rgba(184,149,110,0.16)', icon: 'live', step: 2 },
  completed: { labelKey: 'status_completed', color: '#6A8A9A', background: 'rgba(106,138,154,0.14)', icon: 'completed', step: 3 },
  cancelled: { labelKey: 'status_cancelled', color: '#B07070', background: 'rgba(176,112,112,0.14)', icon: 'cancel', terminal: true },
});

export const UNKNOWN_STATUS_PRESENTATION = Object.freeze({
  labelKey: 'status_unknown', color: '#77736D', background: 'rgba(119,115,109,0.14)', icon: 'unknown', terminal: true,
});

const reportedStatuses = new Set();

export const reportUnknownConsultationStatus = (status) => {
  const value = String(status || 'missing');
  if (reportedStatuses.has(value)) return;
  reportedStatuses.add(value);
  const context = { tags: { domain: 'consultations', status: value } };
  if (import.meta.env.VITE_SENTRY_DSN) Sentry.captureMessage('Unknown consultation status', context);
  else console.warn('Unknown consultation status', { status: value });
};

export const getConsultationStatus = (consultationOrStatus) => {
  const consultation = typeof consultationOrStatus === 'object' ? consultationOrStatus : null;
  const rawStatus = consultation ? consultation.status : consultationOrStatus;
  const policy = consultation?.policy;
  const status = policy?.status || rawStatus;
  if (policy?.statusKnown === false || !STATUS_PRESENTATION[status]) {
    reportUnknownConsultationStatus(rawStatus || status);
    return { ...UNKNOWN_STATUS_PRESENTATION, status: 'unknown', rawStatus: rawStatus || status };
  }
  return { ...STATUS_PRESENTATION[status], status, rawStatus };
};

export const getConsultationBucket = (consultation) => {
  if (consultation?.policy?.bucket) return consultation.policy.bucket;
  if (consultation?.archivedAt) return 'archived';
  const status = getConsultationStatus(consultation).status;
  if (status === 'payment_pending') return 'payment_pending';
  if (['pending', 'accepted', 'in_progress'].includes(status)) return 'upcoming';
  if (status === 'completed') return 'completed';
  if (['payment_expired', 'rejected', 'cancelled'].includes(status)) return 'cancelled';
  return 'unknown';
};

export const getConsultationActions = (consultation) => (
  Array.isArray(consultation?.policy?.availableActions)
    ? [...new Set(consultation.policy.availableActions)]
    : []
);

export const hasConsultationAction = (consultation, action) => getConsultationActions(consultation).includes(action);

export const FORMAT_PRESENTATION = Object.freeze({
  chat: { labelKey: 'format_chat', icon: 'chat' },
  audio: { labelKey: 'format_audio', icon: 'audio' },
  video: { labelKey: 'format_video', icon: 'video' },
  zoom: { labelKey: 'format_zoom', icon: 'zoom' },
});

export const getConsultationFormat = (consultation) => {
  if (consultation?.meetingProvider === 'zoom') return { ...FORMAT_PRESENTATION.zoom, key: 'zoom' };
  if (['phone', 'audio'].includes(consultation?.type)) return { ...FORMAT_PRESENTATION.audio, key: 'audio' };
  if (consultation?.type === 'video' || consultation?.meetingProvider === 'webrtc') return { ...FORMAT_PRESENTATION.video, key: 'video' };
  return { ...FORMAT_PRESENTATION.chat, key: 'chat' };
};

export const CANCELLATION_TYPE_KEYS = Object.freeze({
  client_cancelled: 'cancellation_client_cancelled',
  lawyer_cancelled: 'cancellation_lawyer_cancelled',
  admin_cancelled: 'cancellation_admin_cancelled',
  lawyer_rejected: 'cancellation_lawyer_rejected',
  payment_expired: 'cancellation_payment_expired',
  provider_cancelled: 'cancellation_provider_cancelled',
});

export const getCancellationTypeKey = (cancellation) => (
  CANCELLATION_TYPE_KEYS[cancellation?.type] || 'cancellation_cancelled'
);

export const getServerOffset = (serverNow) => {
  const parsed = new Date(serverNow).getTime();
  return Number.isFinite(parsed) ? parsed - Date.now() : 0;
};

export const isPaymentExpired = (consultation, clientNow = Date.now(), serverOffset = 0) => {
  if (getConsultationStatus(consultation).status === 'payment_expired') return true;
  const expiresAt = new Date(consultation?.paymentExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= clientNow + serverOffset;
};

export const getJoinState = (consultation, clientNow = Date.now(), serverOffset = 0) => {
  const policy = consultation?.policy || {};
  const actions = getConsultationActions(consultation);
  const serverTime = clientNow + serverOffset;
  const opensAt = new Date(policy.joinAvailableAt).getTime();
  const expiresAt = new Date(policy.joinExpiresAt).getTime();
  const notExpired = !Number.isFinite(expiresAt) || serverTime <= expiresAt;
  const waitingForWindow = policy.reason === 'TOO_EARLY' && Number.isFinite(opensAt);
  const advertised = actions.includes('join') || waitingForWindow;
  return {
    visible: advertised,
    enabled: advertised && notExpired && policy.canJoin === true && actions.includes('join'),
    reason: policy.canJoin === true && actions.includes('join') ? null : policy.reason,
    opensAt: policy.joinAvailableAt || null,
  };
};

export const safeRequestError = (error, fallback, options = {}) => {
  const code = error?.response?.data?.code;
  if (code && options.t) {
    const key = `consultations.error_${code}`;
    const translated = options.t(key);
    if (translated !== key) return translated;
  }
  const message = error?.response?.data?.error;
  return options.language === 'ru' && typeof message === 'string' && message.length <= 300 ? message : fallback;
};

export const __resetUnknownStatusDiagnostics = () => reportedStatuses.clear();
