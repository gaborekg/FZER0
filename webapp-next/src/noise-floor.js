import {
  NOISE_FLOOR_WINDOW_SECONDS,
  NOISE_MARGIN_DB,
  FLOOR_MIN_RMS,
  FLOOR_MAX_RMS,
} from './config.js';

export function createNoiseFloor({
  windowSeconds = NOISE_FLOOR_WINDOW_SECONDS,
  marginDb = NOISE_MARGIN_DB,
  minRms = FLOOR_MIN_RMS,
  maxRms = FLOOR_MAX_RMS,
} = {}) {
  const samples = [];

  function addSample(rms, timestampMs) {
    samples.push({ rms, timestampMs });
    const cutoff = timestampMs - windowSeconds * 1000;
    while (samples.length && samples[0].timestampMs < cutoff) {
      samples.shift();
    }
  }

  function getFloor() {
    if (samples.length === 0) {
      return minRms;
    }
    const sorted = samples.map((s) => s.rms).sort((a, b) => a - b);
    const idx = Math.floor(0.1 * (sorted.length - 1));
    const p10 = sorted[idx];
    const marginMultiplier = Math.pow(10, marginDb / 20);
    const floor = p10 * marginMultiplier;
    return Math.min(maxRms, Math.max(minRms, floor));
  }

  return { addSample, getFloor };
}
