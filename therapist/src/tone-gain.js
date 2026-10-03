// How loud the reference tone plays.
//
// This used to be derived from the microphone: measure how loudly you speak,
// play the tone at "the same" level, so matching it never means pushing your
// voice. Good intention, wrong mechanism. Microphone RMS and playback
// amplitude are unrelated scales — mic sensitivity varies by an order of
// magnitude between a laptop and a phone for the same voice — so the tone came
// out inaudible on the device where it mattered most, twice.
//
// What is left is honest: a loud, fixed default, and a control for the part no
// browser can measure — how far up the headphones are turned. The microphone
// calibration still sets the Target mark on the dial, which is a level on the
// same scale as the reading and so a comparison that actually holds.

export const BASE_TONE_GAIN = 0.7;

export const DEFAULT_TONE_VOLUME = 1;
export const MIN_TONE_VOLUME = 0.2;
export const MAX_TONE_VOLUME = 1.4;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function toneGainFor({ toneVolume = DEFAULT_TONE_VOLUME } = {}) {
  const volume = clamp(Number(toneVolume) || DEFAULT_TONE_VOLUME, MIN_TONE_VOLUME, MAX_TONE_VOLUME);
  // Never past 1: beyond full scale the samples clip and the tone buzzes
  // rather than getting louder.
  return clamp(BASE_TONE_GAIN * volume, 0, 1);
}
