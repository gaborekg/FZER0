import {
  WIDE_SEARCH_HZ_MIN,
  WIDE_SEARCH_HZ_MAX,
  MIN_FRAME_LENGTH_MULTIPLIER,
  PEAK_TOLERANCE,
} from './config.js';

export function detectPitch(frame, sampleRate) {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSquares += frame[i] * frame[i];
  }
  const rms = Math.sqrt(sumSquares / frame.length);

  if (rms === 0) {
    return { hz: null, confidence: 0, rms: 0 };
  }

  // Search a WIDE band (config.js), not the narrower acceptance band —
  // acceptance is gate.js's job, not this function's. Reject frames too
  // short to reliably resolve the lowest searched frequency, rather than
  // silently letting the frame.length clamp below narrow the search and
  // misreport (this is what an AudioWorklet's 128-sample quantum would do
  // if fed directly, instead of being buffered up to FRAME_SIZE first).
  const searchMinLag = Math.floor(sampleRate / WIDE_SEARCH_HZ_MAX);
  const idealMaxLag = Math.ceil(sampleRate / WIDE_SEARCH_HZ_MIN);

  if (frame.length < idealMaxLag * MIN_FRAME_LENGTH_MULTIPLIER) {
    return { hz: null, confidence: 0, rms };
  }

  const searchMaxLag = Math.min(idealMaxLag, frame.length - 2);

  if (searchMaxLag <= searchMinLag) {
    return { hz: null, confidence: 0, rms };
  }

  // Score every candidate lag with NORMALIZED cross-correlation, not the raw
  // sum Σ x[i]·x[i+lag]. The raw sum has fewer terms as the lag grows, so it
  // is biased toward short lags for reasons that have nothing to do with
  // periodicity — which made a real 65 Hz tone lose to the short-lag edge of
  // the search window. Normalizing by the energy actually overlapping at
  // each lag (both terms over the SAME window the correlation was summed
  // over) removes that bias entirely, and makes selection and confidence use
  // one single measure instead of two that disagree.
  const scores = new Float64Array(searchMaxLag + 1);
  for (let lag = searchMinLag; lag <= searchMaxLag; lag++) {
    scores[lag] = normalizedCorrelationAt(frame, lag);
  }

  // Only STRICTLY INTERIOR local maxima count as candidates. Non-periodic
  // input (DC offset, slow drift, a transient thump, sub-search rumble) has
  // correlation that slides monotonically across the whole search window, so
  // its best lag pins at an edge and it produces no interior peak at all —
  // it is rejected here rather than reported as a confident "voiced" reading,
  // which is exactly the false positive a whole-branch review caught.
  const peaks = [];
  for (let lag = searchMinLag + 1; lag <= searchMaxLag - 1; lag++) {
    if (scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) {
      peaks.push(lag);
    }
  }

  if (peaks.length === 0) {
    return { hz: null, confidence: 0, rms };
  }

  let peakMax = -Infinity;
  for (const lag of peaks) {
    if (scores[lag] > peakMax) peakMax = scores[lag];
  }

  if (peakMax <= 0) {
    return { hz: null, confidence: 0, rms };
  }

  // Anti-subharmonic rule: normalized correlation is just as high at 2×, 3×
  // the true period as at the period itself (r(kP) ≈ r(P)), so taking the
  // single tallest peak reports an octave (or two) too LOW — measured: a
  // 110 Hz tone picks lag 873 and reports 55 Hz. Take instead the SHORTEST
  // lag whose peak is within PEAK_TOLERANCE of the best peak: among lags
  // that are all near-perfectly periodic, the shortest is the fundamental,
  // and the tolerance stops a weak short-lag peak (a harmonic of a signal
  // whose fundamental is the real answer) from winning on position alone.
  let bestLag = -1;
  for (const lag of peaks) {
    if (scores[lag] >= PEAK_TOLERANCE * peakMax) {
      bestLag = lag;
      break;
    }
  }

  if (bestLag === -1) {
    return { hz: null, confidence: 0, rms };
  }

  // Parabolic interpolation around the chosen peak, on the same normalized
  // scores. denom must be negative at a genuine maximum; if float noise says
  // otherwise, or the offset lands outside the ±0.5 sample a parabolic fit
  // can legitimately produce, fall back to the integer lag rather than
  // dividing by a near-zero and reporting nonsense Hz.
  const sPrev = scores[bestLag - 1];
  const sNext = scores[bestLag + 1];
  const denom = sPrev - 2 * scores[bestLag] + sNext;
  let refinedLag = bestLag;
  if (denom < 0) {
    const offset = (0.5 * (sPrev - sNext)) / denom;
    if (offset >= -0.5 && offset <= 0.5) {
      refinedLag = bestLag + offset;
    }
  }

  const hz = sampleRate / refinedLag;
  const confidence = Math.min(1, scores[bestLag]);

  return { hz, confidence, rms };
}

// Normalized cross-correlation at one lag: the correlation sum divided by the
// energy of the two overlapping segments it was summed over. Amplitude- and
// window-length-invariant, so it is ≈1.0 for a clean periodic signal at ANY
// lag that is a whole period — which is what makes it safe to both SELECT and
// SCORE with, unlike the raw sum.
function normalizedCorrelationAt(frame, lag) {
  let r = 0;
  let energyOrig = 0;
  let energyShifted = 0;
  for (let i = 0; i < frame.length - lag; i++) {
    r += frame[i] * frame[i + lag];
    energyOrig += frame[i] * frame[i];
    energyShifted += frame[i + lag] * frame[i + lag];
  }
  const normFactor = Math.sqrt(energyOrig * energyShifted);
  return normFactor > 0 ? r / normFactor : 0;
}
