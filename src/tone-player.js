import { noteToHz } from './note-hz.js';
import { buildToneWav } from './tone-wav.js';

const DEFAULT_TONE_GAIN = 0.35;

// How long after the tone should have finished to give up waiting for the
// `ended` event and run the caller's callback anyway.
const FINISH_GRACE_MS = 400;

// Plays the reference tone through an <audio> element rather than an
// oscillator.
//
// On iOS every browser is WKWebView, and Web Audio there is the fragile path:
// the context arrives suspended, has to be unlocked inside a gesture, is
// suspended again on every backgrounding, and once a getUserMedia stream is
// open the audio session is in record mode and playback can be routed away or
// silenced outright. A media element playing a real file avoids every one of
// those. Desktop never cared either way.
//
// Loudness is baked into the samples because iOS ignores `volume` on media
// elements — the hardware owns output level there.
export function createTonePlayer(createAudioElement = (src) => new Audio(src)) {
  // Encoding is a few milliseconds of work, and the same handful of notes get
  // played over and over.
  const cache = new Map();
  let current = null;

  function sourceFor(note, durationMs, gain) {
    const key = `${note}|${durationMs}|${gain.toFixed(3)}`;
    if (!cache.has(key)) {
      const wav = buildToneWav({ hz: noteToHz(note), durationMs, amplitude: gain });
      cache.set(key, URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
    }
    return cache.get(key);
  }

  function play(note, { durationMs = 1200, gain = DEFAULT_TONE_GAIN, onStart, onEnd } = {}) {
    // Tapping a second note should replace the first, not layer on top of it.
    current?.pause?.();

    const audio = createAudioElement(sourceFor(note, durationMs, gain));
    // Required on iOS, or the element takes over the screen as a video player.
    audio.setAttribute?.('playsinline', '');
    current = audio;

    if (onStart) onStart();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (onEnd) onEnd();
    };
    audio.addEventListener?.('ended', finish);
    // Callers pause their analysis for the length of the tone and rely on this
    // to start again. A tone the browser refuses to play fires no `ended`, and
    // without this the panel would measure nothing for the rest of the call.
    setTimeout(finish, durationMs + FINISH_GRACE_MS);

    // play() rejects when the browser blocks playback; there is nothing to do
    // about it here beyond not throwing into the caller's click handler.
    return Promise.resolve(audio.play?.()).catch(() => {});
  }

  // What the last attempt actually managed, for surfacing to the user.
  function state() {
    if (!current) return 'new';
    if (current.error) return 'error';
    return current.paused ? 'paused' : 'running';
  }

  return { play, state };
}
