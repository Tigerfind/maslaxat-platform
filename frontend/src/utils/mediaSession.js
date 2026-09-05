const CAMERA_CONSTRAINTS = new Set(['video', 'camera', 'deviceId', 'width', 'height', 'frameRate', 'facingMode']);

export const classifyMediaError = (error, { audioOnly = false, wasGranted = false } = {}) => {
  const name = error?.name || '';
  const constrainedDevice = CAMERA_CONSTRAINTS.has(error?.constraint) ? 'camera' : error?.constraint ? 'microphone' : null;
  const device = audioOnly ? 'microphone' : constrainedDevice || 'camera';
  let reason = 'error';
  if (name === 'NotAllowedError' || name === 'SecurityError') reason = wasGranted ? 'revoked' : 'denied';
  else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') reason = 'not-found';
  else if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') reason = 'busy';
  else if (name === 'NotSupportedError' || name === 'TypeError') reason = 'unsupported';
  return { reason, device, canUseAudioOnly: !audioOnly && device === 'camera' };
};

export const mediaConstraints = ({ audioOnly = false, cameraId = '', microphoneId = '' } = {}) => ({
  video: audioOnly ? false : cameraId ? { deviceId: { exact: cameraId } } : true,
  audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
});

export const reconcileMediaSelection = (selection, devices) => ({
  camera: devices.cameras.some((device) => device.deviceId === selection.camera) ? selection.camera : '',
  microphone: devices.microphones.some((device) => device.deviceId === selection.microphone) ? selection.microphone : '',
  speaker: devices.speakers.some((device) => device.deviceId === selection.speaker) ? selection.speaker : '',
});

export const playMediaElement = async (element) => {
  if (!element?.play) return false;
  try {
    element.muted = false;
    await element.play();
    return true;
  } catch (_) {
    return false;
  }
};
