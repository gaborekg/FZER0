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

// Web Audio here is input only — the worklet analyses the microphone and is
// never connected to the destination. Nothing plays through it: on iOS, Web
// Audio *output* does not work in WKWebView at all, so the reference tone goes
// through an <audio> element instead.
//
// The context is created per recording and CLOSED when the recording stops.
// That matters more than it looks: while a capture graph is alive, iOS holds
// the audio session in record mode, and in record mode it routes playback to
// the earpiece rather than the speaker. Keeping one context alive between
// recordings — which seemed tidier — left every tone afterwards playing out of
// the receiver at call volume.
let workletLoaded = false;
let liveContexts = 0;

// iOS decides where sound comes out from the session type. 'playback' is the
// loudspeaker; 'play-and-record' is the earpiece, because that is what a phone
// call wants. So it is set to match what the app is actually doing, and put
// back the moment recording ends. Only recent WebKit has this, hence the guard.
export function setAudioSession(type) {
  if (!navigator.audioSession) return;
  try {
    navigator.audioSession.type = type;
  } catch {
    // Older engine; routing stays the browser's decision.
  }
}

export async function startCapture(onFrame) {
  setAudioSession('play-and-record');
  const stream = await navigator.mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS);
  const audioContext = new AudioContext();
  liveContexts += 1;

  let workletNode;
  let source;
  try {
    await audioContext.audioWorklet.addModule(WORKLET_URL);
    workletLoaded = true;
    await audioContext.resume();

    workletNode = new AudioWorkletNode(audioContext, 'fzer0-f0-processor');
    workletNode.port.onmessage = (event) => onFrame(event.data);
    source = audioContext.createMediaStreamSource(stream);
    source.connect(workletNode);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    liveContexts -= 1;
    await audioContext.close();
    setAudioSession('playback');
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

      // Both of these are what hands the speaker back. Stopping the tracks
      // alone is not enough — the live context keeps the session in record
      // mode, and the tone keeps coming out of the earpiece.
      liveContexts -= 1;
      await audioContext.close();
      if (liveContexts === 0) setAudioSession('playback');
    },
  };
}
