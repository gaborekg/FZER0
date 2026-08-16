import { noteToHz } from './note-hz.js';

const DEFAULT_TONE_GAIN = 0.2;

// How long after the tone should have finished to give up waiting for
// `onended` and run the caller's callback anyway.
const FINISH_GRACE_MS = 300;

// Schedule the tone a moment ahead rather than at "now". A context that was
// suspended has a frozen clock, and WebKit drops notes whose start time has
// already passed by the time it actually resumes.
const START_LEAD_SECONDS = 0.05;

export function createTonePlayer(audioContextFactory = () => new AudioContext()) {
  let audioContext = null;
  let unlocked = false;

  function context() {
    if (!audioContext) audioContext = audioContextFactory();
    return audioContext;
  }

  // Safari will not let a context make sound until it has been resumed inside
  // a user gesture *and* has rendered something. A one-sample silent buffer is
  // the established way to satisfy the second half without a click or a pop.
  // Called from inside the tap that asked for the tone, which is the only
  // moment iOS accepts it.
  function unlock(ctx) {
    if (unlocked) return;
    unlocked = true;
    if (typeof ctx.createBuffer !== 'function') return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Older engines refuse a zero-length buffer; nothing depends on this.
    }
  }

  function play(note, { durationMs = 1200, gain = DEFAULT_TONE_GAIN, onStart, onEnd } = {}) {
    const ctx = context();

    // Not awaited on purpose: resume has to happen inside the user gesture that
    // got us here, and awaiting would push everything after it out of that
    // gesture, which is exactly what Safari refuses.
    ctx.resume?.();
    unlock(ctx);

    const oscillator = ctx.createOscillator();
    oscillator.frequency.value = noteToHz(note);
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (onStart) onStart();

    const startAt = (ctx.currentTime ?? 0) + START_LEAD_SECONDS;
    oscillator.start(startAt);
    oscillator.stop(startAt + durationMs / 1000);

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

  // 'running' means the browser is actually playing. Anything else and the
  // user hears nothing, which is worth saying out loud rather than leaving
  // them to wonder whether the tone is just quiet.
  function state() {
    return audioContext?.state ?? 'new';
  }

  return { play, state };
}
