import { describe, expect, it } from 'vitest';
import { callElapsedSeconds, mediaConstraintsForCall, remoteCallEndAction, safeEndError, videoAccessState } from './videoCallLifecycle';

describe('video call lifecycle helpers', () => {
  it('requests audio without a camera for normalized phone calls', () => {
    expect(mediaConstraintsForCall('audio', { camId: 'camera', micId: 'microphone' })).toEqual({
      video: false,
      audio: { deviceId: { exact: 'microphone' } },
    });
  });

  it('preserves selected devices for WebRTC video', () => {
    expect(mediaConstraintsForCall('video', { camId: 'camera', micId: 'microphone' })).toEqual({
      video: { deviceId: { exact: 'camera' } },
      audio: { deviceId: { exact: 'microphone' } },
    });
  });

  it('maps end failures to a safe translated error', () => {
    expect(safeEndError({ response: { data: { code: 'SESSION_EVIDENCE_REQUIRED', error: 'internal details' } } })).toEqual({
      code: 'SESSION_EVIDENCE_REQUIRED', translationKey: 'videoCall.endError',
    });
  });

  it('continues elapsed time from the durable server start after reconnect', () => {
    expect(callElapsedSeconds('2026-09-04T10:00:00.000Z', Date.parse('2026-09-04T10:07:30.000Z'))).toBe(450);
  });

  it('fails closed before media starts when server policy denies direct access', () => {
    expect(videoAccessState({ access: { canJoin: false, reason: 'PAYMENT_REQUIRED' } })).toEqual({ allowed: false, code: 'PAYMENT_REQUIRED', retryAt: null });
    expect(videoAccessState({})).toMatchObject({ allowed: false, code: 'UNAVAILABLE' });
  });

  it('requires client confirmation instead of auto-completing a lawyer-ended call', () => {
    expect(remoteCallEndAction('client')).toBe('request_client_confirmation');
    expect(remoteCallEndAction('lawyer')).toBe('record_lawyer_end');
  });
});
