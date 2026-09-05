export const mediaConstraintsForCall = (callMode, preferences = {}) => ({
  video: callMode === 'audio' || preferences.audioOnly
    ? false
    : preferences.camId ? { deviceId: { exact: preferences.camId } } : true,
  audio: preferences.micId ? { deviceId: { exact: preferences.micId } } : true,
});

export const safeEndError = (error) => ({
  code: error?.response?.data?.code || 'CALL_END_FAILED',
  translationKey: 'videoCall.endError',
});

export const callElapsedSeconds = (startedAt, now = Date.now()) => {
  const start = new Date(startedAt).getTime();
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0;
};

export const videoAccessState = (consultation) => {
  const access = consultation?.access;
  if (!access || access.canJoin !== true) {
    return { allowed: false, code: access?.reason || 'UNAVAILABLE', retryAt: access?.joinAvailableAt || access?.retryAt || null };
  }
  return { allowed: true, code: null, retryAt: null };
};

export const remoteCallEndAction = (role) => (
  role === 'client' ? 'request_client_confirmation' : 'record_lawyer_end'
);
