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

// ONE context for the whole app — capture and the reference tone both use it.
//
// Desktop happily runs several at once. iOS does not: a second context makes
// the first stutter, which is why the tone came out broken on a phone while it
// was clean on a laptop. It also means the tone can never be blocked while the
// microphone is running, since there is only one thing to unblock.
let sharedContext = null;
let workletLoaded = false;

export function getAudioContext() {
  if (!sharedContext) sharedContext = new AudioContext();
  return sharedContext;
}

export async function startCapture(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS);
  const audioContext = getAudioContext();

  let workletNode;
  let source;
  try {
    // addModule is per context, and the context outlives any one recording.
    if (!workletLoaded) {
      await audioContext.audioWorklet.addModule(WORKLET_URL);
      workletLoaded = true;
    }
    await audioContext.resume();

    workletNode = new AudioWorkletNode(audioContext, 'fzer0-f0-processor');
    workletNode.port.onmessage = (event) => onFrame(event.data);
    source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  return {
    // A backgrounded tab — which is the normal case here, since the call is
    // happening somewhere else — can have its context suspended by the browser.
    // Frames simply stop arriving. Without this the app would go on looking
    // like it was recording while measuring nothing.
    isRunning: () => audioContext.state === 'running',
    resume: () => audioContext.resume(),
    stop: async () => {
      workletNode.port.onmessage = null;
      source.disconnect();
      workletNode.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      // The context is deliberately left open: closing it would take the tone
      // player down with it, and re-creating one costs another iOS unlock.
    },
  };
}
