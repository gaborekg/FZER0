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

// One context, reused across recordings. Web Audio here is input only — the
// worklet analyses the microphone and is never connected to the destination.
//
// Nothing plays through it: on iOS, Web Audio *output* does not work at all in
// WKWebView (the diagnostic page proves it — an oscillator is silent while
// three media-element routes all play), so the reference tone goes through an
// <audio> element instead. Capture is unaffected, which is why recording has
// worked throughout.
let sharedContext = null;
let workletLoaded = false;

function getAudioContext() {
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
