import { describe, expect, test } from 'vitest';
import { zoomAudioOnlyCapability, zoomClientInitOptions } from './zoomAudioOnly';

describe('Zoom audio-only adapter for Meeting SDK 6.2.0', () => {
  test('uses only the supported Client View preview option', () => {
    expect(zoomClientInitOptions({ leaveUrl: '/consultations' }, true)).toEqual({ leaveUrl: '/consultations', disablePreview: true });
    expect(zoomClientInitOptions({ leaveUrl: '/consultations' }, false)).toEqual({ leaveUrl: '/consultations' });
  });

  test.each(['client', 'component'])('does not invent a camera-off API for %s view', (view) => {
    expect(zoomAudioOnlyCapability(view, true)).toMatchObject({ cameraStopSupported: false, requiresZoomControl: true });
  });
});
