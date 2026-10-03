// What Measure shows live is where the voice SITS, not where one 40 ms frame
// landed. Speech glides several semitones within a word, so a single frame is
// a poor reading: measured on recorded speech, showing every frame changed the
// display ~6 times a second and was 2–3.5 semitones off where the voice sat.
//
// The median of the last second of voiced frames fixes that (error ~0.6–1.2
// semitones) and still follows a held note to a new one within ~0.2–0.7 s.
// Median, not mean: one octave-error frame cannot drag it.

export const WINDOW_MS = 1000;
const MIN_FRAMES = 3;
// The whole-semitone step only moves when the voice is this far past the
// halfway point, so a voice sitting on a boundary doesn't flicker.
// 0.3 measured calmer than 0.2 at the same accuracy.
export const HYSTERESIS = 0.3;

export function createPitchSmoother({ windowMs = WINDOW_MS, minFrames = MIN_FRAMES } = {}) {
  let frames = [];
  let lastHz = null;

  return {
    // Voiced frames only.
    add(hz, timestampMs) {
      frames.push({ t: timestampMs, log2: Math.log2(hz) });
    },
    // The median pitch of the last window, or the last one known when the
    // window is quiet (between words the reading stays where the voice was).
    hz(nowMs) {
      frames = frames.filter((f) => nowMs - f.t <= windowMs);
      if (frames.length >= minFrames) {
        const sorted = frames.map((f) => f.log2).sort((a, b) => a - b);
        lastHz = 2 ** sorted[Math.floor(sorted.length / 2)];
      }
      return lastHz;
    },
    reset() {
      frames = [];
      lastHz = null;
    },
  };
}

// The whole-semitone step to show for an exact distance, given the step
// shown before. Null in, null out.
export function stepWithHysteresis(previous, exact, hysteresis = HYSTERESIS) {
  if (exact === null) return previous;
  if (previous === null || Math.abs(exact - previous) > 0.5 + hysteresis) return Math.round(exact) || 0; // never -0
  return previous;
}
