const SUPPORTED = Object.freeze({
  webrtcVideo: Object.freeze({ type: 'video', meetingProvider: 'webrtc', mode: 'video' }),
  audioOnly: Object.freeze({ types: Object.freeze(['phone', 'audio']), meetingProvider: 'none', mode: 'audio' }),
});

function callProviderPolicy(consultation) {
  if (consultation?.meetingProvider === 'zoom') {
    return { allowed: false, code: 'ZOOM_PROVIDER_REQUIRED' };
  }
  if (consultation?.type === 'chat') {
    return { allowed: false, code: 'CHAT_NOT_CALL' };
  }
  if (consultation?.type === SUPPORTED.webrtcVideo.type
    && consultation?.meetingProvider === SUPPORTED.webrtcVideo.meetingProvider) {
    return { allowed: true, mode: SUPPORTED.webrtcVideo.mode };
  }
  if (SUPPORTED.audioOnly.types.includes(consultation?.type)
    && consultation?.meetingProvider === SUPPORTED.audioOnly.meetingProvider) {
    return { allowed: true, mode: SUPPORTED.audioOnly.mode };
  }
  return { allowed: false, code: 'UNSUPPORTED_CALL_PROVIDER' };
}

function requireSupportedCall(consultation) {
  const policy = callProviderPolicy(consultation);
  if (policy.allowed) return policy;
  const messages = {
    ZOOM_PROVIDER_REQUIRED: 'Используйте защищённый Zoom-вход',
    CHAT_NOT_CALL: 'Текстовая консультация не поддерживает звонки',
    UNSUPPORTED_CALL_PROVIDER: 'Формат звонка не поддерживается',
  };
  throw Object.assign(new Error(messages[policy.code]), { status: 409, code: policy.code });
}

module.exports = { callProviderPolicy, requireSupportedCall };
