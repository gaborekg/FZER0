// How loud the reference tone plays.
//
// The aim is that matching the tone never means pushing your voice, so it is
// anchored to how loudly you actually speak. But microphone level and playback
// amplitude are not the same scale: a phone with an insensitive microphone
// reports a small RMS for a perfectly normal voice, and scaling the tone
// straight off that made it almost inaudible. So the calibration only nudges
// the level, and the user gets a control for the part no browser can know —
// how loud their headphones are turned up.

export const ASSUMED_TYPICAL_RMS = 0.02;

// Calibrated against what is demonstrably audible on a phone: the diagnostic
// page plays at 0.5 and is heard clearly, so that is the default rather than a
// guess. The floor is set so that a mic a quarter as sensitive still lands on
// half the default rather than being clamped somewhere quieter.
export const DEFAULT_TONE_GAIN = 0.5;
export const MIN_TONE_GAIN = 0.25;
export const MAX_TONE_GAIN = 0.9;

export const DEFAULT_TONE_VOLUME = 1;
export const MIN_TONE_VOLUME = 0.2;
export const MAX_TONE_VOLUME = 2;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function toneGainFor({ typicalRms = null, toneVolume = DEFAULT_TONE_VOLUME } = {}) {
  // Square root, not the raw ratio. A microphone half as sensitive should make
  // the tone a little quieter, not half as loud — the difference between the
  // two is most of why this bottomed out.
  const sensitivity = typicalRms > 0 ? Math.sqrt(typicalRms / ASSUMED_TYPICAL_RMS) : 1;
  const calibrated = clamp(DEFAULT_TONE_GAIN * sensitivity, MIN_TONE_GAIN, MAX_TONE_GAIN);

  // The user's own multiplier sits outside those bounds: if they want it barely
  // there, that is their call and not something to override.
  const volume = clamp(Number(toneVolume) || DEFAULT_TONE_VOLUME, MIN_TONE_VOLUME, MAX_TONE_VOLUME);
  return clamp(calibrated * volume, 0, 1);
}
