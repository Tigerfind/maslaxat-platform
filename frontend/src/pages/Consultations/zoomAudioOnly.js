// Meeting SDK 6.2.0 has no supported self-video stop API or video:false join option.
// Client View can skip its preview, but users must still verify camera state in Zoom controls.
export const zoomClientInitOptions = (options, audioOnly) => (
  audioOnly ? { ...options, disablePreview: true } : options
);

export const zoomAudioOnlyCapability = (view, audioOnly) => ({
  requested: audioOnly,
  previewSuppressed: audioOnly && view === 'client',
  cameraStopSupported: false,
  requiresZoomControl: audioOnly,
});
