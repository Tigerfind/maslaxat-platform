async function installFakeMedia(context) {
  await context.addInitScript(() => {
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
    window.__e2eMediaResources = window.__e2eMediaResources || [];
    const makeStream = (constraints = { audio: true, video: true }) => {
      const stream = new MediaStream();
      if (constraints.video !== false) {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const drawing = canvas.getContext('2d');
        drawing.fillStyle = '#17324d';
        drawing.fillRect(0, 0, canvas.width, canvas.height);
        drawing.fillStyle = '#ffffff';
        drawing.fillRect(40, 40, 80, 80);
        const canvasStream = canvas.captureStream?.(10);
        canvasStream?.getVideoTracks().forEach((track) => stream.addTrack(track));
        window.__e2eMediaResources.push(canvas, canvasStream);
      }
      if (constraints.audio !== false) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          const audioContext = new AudioContextClass();
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const destination = audioContext.createMediaStreamDestination();
          oscillator.frequency.value = 440;
          gain.gain.value = 0.0001;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
          window.__e2eMediaResources.push(audioContext, oscillator, destination);
        }
      }
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async (constraints) => makeStream(constraints) });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [
      { deviceId: 'e2e-camera', groupId: 'e2e', kind: 'videoinput', label: 'E2E camera', toJSON() { return this; } },
      { deviceId: 'e2e-microphone', groupId: 'e2e', kind: 'audioinput', label: 'E2E microphone', toJSON() { return this; } },
      { deviceId: 'e2e-speaker', groupId: 'e2e', kind: 'audiooutput', label: 'E2E speaker', toJSON() { return this; } },
    ] });
  });
}

module.exports = { installFakeMedia };
