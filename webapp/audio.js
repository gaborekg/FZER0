// Microphone capture for the web app.
//
// The worklet lives under extension/ because that is where it shipped first,
// but nothing in it is extension-specific — it is the same pitch detector the
// panel uses, and pointing at the one copy is what keeps the two honest.
const WORKLET_URL = new URL('../extension/worklet/f0-processor.js', import.meta.url);

// Chrome's own processing fights the measurement. Auto gain control in
// particular exists to erase exactly the loudness differences being measured.
const CAPTURE_CONSTRAINTS = {
  audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
};

export async function startCapture(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS);
  const audioContext = new AudioContext();

  try {
    await audioContext.audioWorklet.addModule(WORKLET_URL);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
    throw error;
  }

  const workletNode = new AudioWorkletNode(audioContext, 'fzer0-f0-processor');
  workletNode.port.onmessage = (event) => onFrame(event.data);
  audioContext.createMediaStreamSource(stream).connect(workletNode);

  return {
    // A backgrounded tab — which is the normal case here, since the call is
    // happening somewhere else — can have its AudioContext suspended by the
    // browser. Frames simply stop arriving. Without this the app would go on
    // looking like it was recording while measuring nothing.
    isRunning: () => audioContext.state === 'running',
    resume: () => audioContext.resume(),
    stop: async () => {
      workletNode.port.onmessage = null;
      stream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    },
  };
}
