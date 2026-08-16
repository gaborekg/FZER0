import { noteToHz } from './note-hz.js';

const DEFAULT_TONE_GAIN = 0.2;

// How long after the tone should have finished to give up waiting for
// `onended` and run the caller's callback anyway.
const FINISH_GRACE_MS = 300;

export function createTonePlayer(audioContextFactory = () => new AudioContext()) {
  let audioContext = null;

  function play(note, { durationMs = 1200, gain = DEFAULT_TONE_GAIN, onStart, onEnd } = {}) {
    if (!audioContext) {
      audioContext = audioContextFactory();
    }

    // Safari hands back a suspended context, and suspends it again every time
    // the page goes to the background. start() on a suspended context makes no
    // sound at all — this is why the tone was silent on iPhone. Resume is
    // deliberately not awaited: it has to be called inside the user gesture
    // that got us here, and awaiting would push the rest of this out of it.
    // currentTime does not advance while suspended, so the stop time below is
    // still the right distance away once it does resume.
    audioContext.resume?.();

    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = noteToHz(note);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = gain;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    if (onStart) onStart();
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationMs / 1000);

    // Callers pause their analysis for the length of the tone and rely on this
    // to start again. `onended` never fires if the context stays suspended, so
    // without a fallback a silent tone would leave the panel measuring nothing
    // for the rest of the call.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (onEnd) onEnd();
    };
    oscillator.onended = finish;
    setTimeout(finish, durationMs + FINISH_GRACE_MS);
  }

  return { play };
}
