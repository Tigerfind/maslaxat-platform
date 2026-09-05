import { describe, expect, test, vi } from 'vitest';
import { classifyMediaError, mediaConstraints, playMediaElement, reconcileMediaSelection } from './mediaSession';

describe('media session helpers', () => {
  test.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'busy'],
  ])('classifies camera %s without silently selecting audio', (name, reason) => {
    expect(classifyMediaError({ name })).toEqual({ reason, device: 'camera', canUseAudioOnly: true });
  });

  test('classifies an audio-only failure as microphone failure and detects revoked permission', () => {
    expect(classifyMediaError({ name: 'NotFoundError' }, { audioOnly: true })).toMatchObject({ device: 'microphone', canUseAudioOnly: false });
    expect(classifyMediaError({ name: 'NotAllowedError' }, { wasGranted: true })).toMatchObject({ reason: 'revoked' });
  });

  test('treats a disconnected selected video device as a camera failure', () => {
    expect(classifyMediaError({ name: 'OverconstrainedError', constraint: 'deviceId' }))
      .toMatchObject({ device: 'camera', canUseAudioOnly: true });
  });

  test('builds strict selected-device and audio-only constraints', () => {
    expect(mediaConstraints({ cameraId: 'cam', microphoneId: 'mic' })).toEqual({ video: { deviceId: { exact: 'cam' } }, audio: { deviceId: { exact: 'mic' } } });
    expect(mediaConstraints({ audioOnly: true, cameraId: 'cam' })).toEqual({ video: false, audio: true });
  });

  test('falls back to default when selected devices disappear', () => {
    expect(reconcileMediaSelection(
      { camera: 'gone', microphone: 'mic', speaker: 'gone' },
      { cameras: [], microphones: [{ deviceId: 'mic' }], speakers: [] },
    )).toEqual({ camera: '', microphone: 'mic', speaker: '' });
  });

  test('reports playback recovery only after play succeeds', async () => {
    const element = { muted: true, play: vi.fn().mockRejectedValueOnce(new Error('gesture')).mockResolvedValueOnce() };
    expect(await playMediaElement(element)).toBe(false);
    expect(await playMediaElement(element)).toBe(true);
    expect(element.muted).toBe(false);
  });
});
