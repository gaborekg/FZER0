export const CONFIDENCE_MIN = 0.45;
export const NOISE_MARGIN_DB = 9;
export const FLOOR_MIN_RMS = 0.0005;
export const FLOOR_MAX_RMS = 0.05;
export const NOISE_FLOOR_WINDOW_SECONDS = 20;
export const VOLUME_CEILING_RMS = 0.05;
export const TONE_RESUME_DELAY_MS = 400;
export const FRAME_SIZE = 2048;

// The estimator searches a WIDER band than DETECTION_BAND_HZ (note-hz.js)
// ever accepts. This is deliberate: a genuine periodic tone right at the
// edge of the acceptable band (65 or 400 Hz) needs room on both sides to
// show up as a real interior peak in the correlation search, rather than
// being pinned at the very edge of the search window — which is also
// where non-periodic input (DC offset, drift, a transient thump) pins,
// with deceptively high confidence, when the search range has no margin.
// Acceptance is still decided entirely by gate.js against DETECTION_BAND_HZ;
// this only widens where the estimator is allowed to LOOK.
export const WIDE_SEARCH_HZ_MIN = 50;
export const WIDE_SEARCH_HZ_MAX = 500;

// A frame must contain at least this many periods of the lowest searched
// frequency to reliably estimate it — otherwise the search silently
// narrows (via the frame.length clamp) and can misreport. Below this,
// detectPitch returns no-pitch rather than a guess from a truncated search.
export const MIN_FRAME_LENGTH_MULTIPLIER = 1.5;

// A candidate lag is accepted as the fundamental if its normalized
// correlation is at least this fraction of the best peak found anywhere in
// the search range — the shortest such lag wins. Normalized correlation is
// near-identical at 2x and 3x the true period, so without the "shortest
// within tolerance" rule the estimator reports an octave too low; without
// the tolerance, a weak short-lag harmonic peak could outrank the true
// fundamental on position alone.
export const PEAK_TOLERANCE = 0.9;

// The range-band anchors (what a user's range picker offers) are tunables
// exactly like DETECTION_BAND_HZ — kept here, not as string literals in
// note-hz.js, for the same reason Task 1's own fix round moved
// DETECTION_BAND_HZ_MIN/MAX here.
// The band spans every male speaking pitch — from E2 (82 Hz), the bottom of
// a bass speaking voice — up through the gender-neutral zone (~155-185 Hz)
// and into where the female speaking range begins (A3 = 220 Hz).
//
// The detector still searches below E2, and gate.js still accepts down to
// 65 Hz. Those readings simply have no bar: a pitch that low in speech is far
// more often an octave error than a real fundamental, and four permanently
// empty bars at the left cost chart width that the notes people actually use
// need more.
export const RANGE_BAND_LOW_NOTE = 'E2';
export const RANGE_BAND_HIGH_NOTE = 'A3';
export const DETECTION_BAND_HZ_MIN = 65;
export const DETECTION_BAND_HZ_MAX = 400;
