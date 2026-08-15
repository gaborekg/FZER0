# FNDMNTL Detection Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, browser-independent detection math (note/Hz conversion, self-calibrating noise floor, autocorrelation pitch estimation, gate classification, session tracking) that everything else in FNDMNTL is built on.

**Architecture:** Every file in this plan is plain JavaScript with zero browser APIs (no `AudioContext`, no `chrome.*`), so all of it runs and tests directly under Node. This is deliberate: it is the one part of the codebase we can fully TDD without a browser, and later plans (extension shell, in-call panel) wrap this engine rather than reimplementing any of its logic.

**Tech Stack:** Vanilla ES modules, Node's built-in test runner (`node --test`), `node:assert/strict`. No dependencies, no build step.

## Global Constraints

- **Detection band: 65–400 Hz.** The detector measures and reports any pitch in this band — including well above a user's chosen ceiling, which is how screaming gets shown as "too high" instead of silently discarded. Only readings outside 65–400 Hz are rejected as implausible (noise, octave errors, non-speech).
- **Selectable range band: F2 (87.31 Hz) to C3 (130.81 Hz).** This is a *different, narrower* band than the detection band — it's what a range picker offers and what the shaded "your range" gauge band represents. Never conflate the two: rejecting a reading just because it's above the user's chosen ceiling (but still inside 65–400 Hz) is the exact bug this project already caught and fixed once.
- **Confidence minimum: 0.45.** Frames scoring below this on the autocorrelation confidence measure are discarded as "no pitch," not reported as a shaky value.
- **Self-calibrating noise floor**, not a fixed threshold: 10th percentile of RMS over a rolling ~20 second window, plus a 9 dB margin, bounded between a configured min and max.
- **No recording, no network calls, ever**, in any file in this codebase.
- Every tunable constant lives in `src/config.js` — nowhere else.

---

### Task 1: Config constants + note/Hz math

**Files:**
- Create: `package.json`
- Create: `src/config.js`
- Create: `src/note-hz.js`
- Test: `tests/note-hz.test.js`

**Interfaces:**
- Produces: `CONFIDENCE_MIN`, `NOISE_MARGIN_DB`, `FLOOR_MIN_RMS`, `FLOOR_MAX_RMS`, `NOISE_FLOOR_WINDOW_SECONDS`, `VOLUME_CEILING_RMS`, `TONE_RESUME_DELAY_MS`, `FRAME_SIZE` (all in `src/config.js`)
- Produces: `noteToHz(note: string): number`, `hzToNote(hz: number): string`, `notesInRange(lowNote: string, highNote: string): string[]`, `DETECTION_BAND_HZ: {min, max}`, `RANGE_BAND_HZ: {min, max}`, `RANGE_BAND_NOTES: string[]` (all in `src/note-hz.js`)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fndmntl",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `src/config.js`**

```js
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
export const RANGE_BAND_LOW_NOTE = 'F2';
export const RANGE_BAND_HIGH_NOTE = 'C3';
export const DETECTION_BAND_HZ_MIN = 65;
export const DETECTION_BAND_HZ_MAX = 400;
```

(`DETECTION_BAND_HZ_MIN`/`MAX` were already added here during Task 1's own fix round — they're repeated in this snippet only so this file listing is complete and copy-pasteable on its own; don't duplicate the export if it's already present.)

- [ ] **Step 3: Write the failing test for note/Hz math**

```js
// tests/note-hz.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteToHz,
  hzToNote,
  notesInRange,
  DETECTION_BAND_HZ,
  RANGE_BAND_HZ,
  RANGE_BAND_NOTES,
} from '../src/note-hz.js';

test('noteToHz converts A4 to 440', () => {
  assert.ok(Math.abs(noteToHz('A4') - 440) < 0.01);
});

test('noteToHz converts F2 to approximately 87.31 Hz', () => {
  assert.ok(Math.abs(noteToHz('F2') - 87.31) < 0.05);
});

test('noteToHz converts C3 to approximately 130.81 Hz', () => {
  assert.ok(Math.abs(noteToHz('C3') - 130.81) < 0.05);
});

test('hzToNote converts 440 to A4', () => {
  assert.equal(hzToNote(440), 'A4');
});

test('hzToNote and noteToHz round-trip for C4', () => {
  const hz = noteToHz('C4');
  assert.equal(hzToNote(hz), 'C4');
});

test('noteToHz throws on an invalid note name', () => {
  assert.throws(() => noteToHz('H9'));
});

test('notesInRange lists every semitone from F2 to C3 inclusive', () => {
  assert.deepEqual(notesInRange('F2', 'C3'), ['F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2', 'C3']);
});

test('notesInRange throws when highNote is below lowNote', () => {
  assert.throws(() => notesInRange('C3', 'F2'));
});

test('DETECTION_BAND_HZ is wider than RANGE_BAND_HZ on both ends', () => {
  assert.ok(DETECTION_BAND_HZ.min < RANGE_BAND_HZ.min);
  assert.ok(DETECTION_BAND_HZ.max > RANGE_BAND_HZ.max);
});

test('RANGE_BAND_HZ matches F2 to C3', () => {
  assert.ok(Math.abs(RANGE_BAND_HZ.min - 87.31) < 0.05);
  assert.ok(Math.abs(RANGE_BAND_HZ.max - 130.81) < 0.05);
});

test('RANGE_BAND_NOTES matches F2 through C3', () => {
  assert.deepEqual(RANGE_BAND_NOTES, ['F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2', 'C3']);
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/note-hz.js'`

- [ ] **Step 5: Implement `src/note-hz.js`**

```js
import {
  DETECTION_BAND_HZ_MIN,
  DETECTION_BAND_HZ_MAX,
  RANGE_BAND_LOW_NOTE,
  RANGE_BAND_HIGH_NOTE,
} from './config.js';

const A4_HZ = 440;
const A4_MIDI = 69;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const DETECTION_BAND_HZ = { min: DETECTION_BAND_HZ_MIN, max: DETECTION_BAND_HZ_MAX };

function noteNameToMidi(note) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!match) {
    throw new Error(`Invalid note name: ${note}`);
  }
  const [, name, octaveStr] = match;
  const noteIndex = NOTE_NAMES.indexOf(name);
  if (noteIndex === -1) {
    throw new Error(`Invalid note name: ${note}`);
  }
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + noteIndex;
}

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}

export function noteToHz(note) {
  const midi = noteNameToMidi(note);
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function hzToNote(hz) {
  const midi = Math.round(A4_MIDI + 12 * Math.log2(hz / A4_HZ));
  return midiToNoteName(midi);
}

export function notesInRange(lowNote, highNote) {
  const lowMidi = noteNameToMidi(lowNote);
  const highMidi = noteNameToMidi(highNote);
  if (highMidi < lowMidi) {
    throw new Error(`highNote (${highNote}) is lower than lowNote (${lowNote})`);
  }
  const notes = [];
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    notes.push(midiToNoteName(midi));
  }
  return notes;
}

export const RANGE_BAND_HZ = {
  min: noteToHz(RANGE_BAND_LOW_NOTE),
  max: noteToHz(RANGE_BAND_HIGH_NOTE),
};
export const RANGE_BAND_NOTES = notesInRange(RANGE_BAND_LOW_NOTE, RANGE_BAND_HIGH_NOTE);
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `npm test`
Expected: all `note-hz.test.js` tests PASS

- [ ] **Step 7: Commit**

```bash
git add package.json src/config.js src/note-hz.js tests/note-hz.test.js
git commit -m "Add config constants and note/Hz conversion math"
```

---

### Task 2: Self-calibrating noise floor

**Files:**
- Create: `src/noise-floor.js`
- Test: `tests/noise-floor.test.js`

**Interfaces:**
- Consumes: `NOISE_FLOOR_WINDOW_SECONDS`, `NOISE_MARGIN_DB`, `FLOOR_MIN_RMS`, `FLOOR_MAX_RMS` from `src/config.js` (Task 1)
- Produces: `createNoiseFloor(options?): { addSample(rms: number, timestampMs: number): void, getFloor(): number }`

- [ ] **Step 1: Write the failing test**

```js
// tests/noise-floor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoiseFloor } from '../src/noise-floor.js';

test('getFloor returns minRms when no samples have been added', () => {
  const floor = createNoiseFloor({ minRms: 0.001, maxRms: 0.05 });
  assert.equal(floor.getFloor(), 0.001);
});

test('getFloor rises above the raw noise level once quiet-room samples accumulate', () => {
  const floor = createNoiseFloor({ minRms: 0.0005, maxRms: 0.05, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.01, i * 100);
  }
  const result = floor.getFloor();
  assert.ok(result > 0.01, `expected floor above 0.01, got ${result}`);
});

test('getFloor is bounded by maxRms even with very loud samples', () => {
  const floor = createNoiseFloor({ minRms: 0.0005, maxRms: 0.02, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.5, i * 100);
  }
  assert.equal(floor.getFloor(), 0.02);
});

test('addSample drops samples older than the rolling window', () => {
  const floor = createNoiseFloor({ windowSeconds: 1, minRms: 0.0005, maxRms: 0.05, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.02, i * 10);
  }
  floor.addSample(0.001, 3000); // 3s later; window is 1s, so only this sample survives
  const result = floor.getFloor();
  assert.ok(result < 0.005, `expected floor to reflect only the recent quiet sample, got ${result}`);
});

test('getFloor tracks the 10th percentile, not the minimum — a single silent frame must not drag it down', () => {
  // If getFloor used Math.min instead of a true percentile, this test
  // would fail: the one 0.0001 sample would pull the floor far below the
  // room's actual typical quiet level (0.01), making the gate treat one
  // silent frame as if it defined the ambient noise floor.
  const floor = createNoiseFloor({ minRms: 0.00001, maxRms: 0.05, marginDb: 9 });
  floor.addSample(0.0001, 0); // one atypically silent frame
  for (let i = 1; i < 90; i++) {
    floor.addSample(0.01, i * 100); // the room's typical quiet level
  }
  for (let i = 90; i < 100; i++) {
    floor.addSample(0.5, i * 100); // loud outliers, ~10% of samples
  }
  const result = floor.getFloor();
  assert.ok(result > 0.005, `expected floor near the typical 0.01 level, not near the single silent sample, got ${result}`);
  assert.ok(result < 0.05, `expected floor unaffected by the loud outliers, got ${result}`);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/noise-floor.js'`

- [ ] **Step 3: Implement `src/noise-floor.js`**

```js
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
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `noise-floor.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/noise-floor.js tests/noise-floor.test.js
git commit -m "Add self-calibrating noise floor"
```

---

### Task 3: Autocorrelation pitch/volume estimator core

**Files:**
- Create: `src/f0-core.js`
- Create: `tests/helpers/sine-wave.js`
- Test: `tests/f0-core.test.js`

**Interfaces:**
- Consumes: `WIDE_SEARCH_HZ_MIN`, `WIDE_SEARCH_HZ_MAX`, `MIN_FRAME_LENGTH_MULTIPLIER`, `PEAK_TOLERANCE` from `src/config.js` (Task 1)
- Produces: `detectPitch(frame: Float32Array, sampleRate: number): { hz: number|null, confidence: number, rms: number }`

This is the one piece of math that later runs inside an `AudioWorkletProcessor` (Plan 3). It's written here as a plain function taking a `Float32Array` so it can be fully tested under Node — the worklet wrapper will be a thin shell around this exact function, not a reimplementation.

**Design note:** `detectPitch` does NOT accept the acceptance band (`minHz`/`maxHz`) as parameters and does not itself decide accept/reject against `DETECTION_BAND_HZ` — that decision belongs entirely to `gate.js` (Task 4), which compares the returned `hz` against `DETECTION_BAND_HZ`. This estimator's only job is: search a wide plausible-speech range, and report a pitch *only* if there's a genuine periodic peak in it, `null` otherwise. Earlier drafts of this task tied the search range directly to the acceptance band, which caused two real bugs later caught in a whole-branch review: (1) non-periodic input (DC offset, slow drift, a transient thump) pinned "confidently" at the edge of the search range with no way to detect that it wasn't a real peak, and (2) a genuine tone right at 400 Hz classified differently at 44.1 kHz vs 48 kHz sample rates, because the search range's edge was defined by the same band it was being judged against. Both are fixed by decoupling "where to search" (wide, fixed) from "what to accept" (`gate.js`, unchanged).

**Design note 2 — one measure, not two:** lag SELECTION and CONFIDENCE must use the *same* metric. An earlier version of this task selected the lag by the raw sum `Σ x[i]·x[i+lag]` while reporting confidence as a normalized cross-correlation. The raw sum has `frame.length - lag` terms, so it shrinks with lag for reasons that have nothing to do with periodicity — a short-lag artifact outscored the genuine peak of a real 65 Hz tone (measured at 48 kHz: 168.6 at lag 96 vs 166.3 at the true lag 728), the interior-peak guard correctly rejected the edge-pinned result, and a real voice at the bottom of the band went undetected. Selection now scores every lag with the same normalized cross-correlation confidence uses. That alone is not enough, though: normalized correlation is ≈1.0 at *every* integer multiple of the true period, so taking the tallest peak reports a subharmonic (measured: a 110 Hz tone picks lag 873 → 55 Hz). The fix is to take the **shortest** interior peak within `PEAK_TOLERANCE` of the tallest one. Do not invert this rule to "longest lag" — that is the correct intuition for a *difference* function like YIN's CMND, where subharmonics score worse, and it is exactly backwards for correlation (measured under a longest-lag rule: 110 Hz → 55 Hz, 200 Hz → 66.7 Hz, 400 Hz → 57.1 Hz).

- [ ] **Step 1: Create the sine-wave test helper**

```js
// tests/helpers/sine-wave.js
export function generateSineWave(hz, sampleRate, numSamples, amplitude = 0.5) {
  const frame = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    frame[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return frame;
}

export function generateSilence(numSamples) {
  return new Float32Array(numSamples);
}
```

- [ ] **Step 2: Write the failing test**

```js
// tests/f0-core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/f0-core.js';
import { generateSineWave, generateSilence } from './helpers/sine-wave.js';

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 2048;

test('detects a 110 Hz sine wave within 1% accuracy', () => {
  const frame = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(result.hz !== null);
  assert.ok(Math.abs(result.hz - 110) / 110 < 0.01, `got ${result.hz} Hz`);
});

test('detects a 200 Hz sine wave — above the range ceiling, inside the detection band', () => {
  const frame = generateSineWave(200, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(Math.abs(result.hz - 200) / 200 < 0.01, `got ${result.hz} Hz`);
});

test('reports high confidence for a clean sine wave', () => {
  const frame = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(result.confidence > 0.9, `expected high confidence, got ${result.confidence}`);
});

test('confidence is high at both ends of the detection band, not just in the middle', () => {
  // Regression test for the lag-dependent confidence bias: a naive
  // normalization (dividing by full-frame energy) scores a clean 65 Hz
  // tone far lower than a clean 400 Hz tone purely because of lag length,
  // not signal quality. Both ends must score high once fixed.
  const lowResult = detectPitch(generateSineWave(65, SAMPLE_RATE, FRAME_SIZE), SAMPLE_RATE);
  const highResult = detectPitch(generateSineWave(400, SAMPLE_RATE, FRAME_SIZE), SAMPLE_RATE);
  assert.ok(lowResult.confidence > 0.9, `expected high confidence at 65 Hz, got ${lowResult.confidence}`);
  assert.ok(highResult.confidence > 0.9, `expected high confidence at 400 Hz, got ${highResult.confidence}`);
});

test('reports hz null and rms 0 for silence', () => {
  const frame = generateSilence(FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.rms, 0);
  assert.equal(result.hz, null);
});

test('reports rms proportional to amplitude', () => {
  const quiet = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE, 0.1);
  const loud = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE, 0.5);
  const quietResult = detectPitch(quiet, SAMPLE_RATE);
  const loudResult = detectPitch(loud, SAMPLE_RATE);
  assert.ok(loudResult.rms > quietResult.rms);
});

test('a harmonic-rich signal still detects the fundamental, not an overtone', () => {
  const numSamples = FRAME_SIZE;
  const frame = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    frame[i] =
      0.5 * Math.sin(2 * Math.PI * 100 * t) +
      0.25 * Math.sin(2 * Math.PI * 200 * t) +
      0.125 * Math.sin(2 * Math.PI * 300 * t);
  }
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(Math.abs(result.hz - 100) / 100 < 0.03, `got ${result.hz} Hz`);
});

// Regression tests for a real bug caught in whole-branch review: input with
// no genuine periodicity was reported as a confident, high-hz "voiced"
// reading, because the old search picked whatever lag scored highest across
// its range with no check that it was an actual peak rather than the edge
// of the search window non-periodic signals pin against.

test('reports no pitch for a constant DC offset (no periodicity at all)', () => {
  const frame = new Float32Array(FRAME_SIZE).fill(0.02);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for slow sub-audible drift (8 Hz)', () => {
  const frame = generateSineWave(8, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for a decaying transient thump (40 Hz, damped)', () => {
  const frame = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    const t = i / SAMPLE_RATE;
    frame[i] = 0.3 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 40 * t);
  }
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for low-frequency rumble (30-50 Hz) below the search range', () => {
  for (const hz of [30, 40, 50]) {
    const frame = generateSineWave(hz, SAMPLE_RATE, FRAME_SIZE);
    const result = detectPitch(frame, SAMPLE_RATE);
    assert.equal(result.hz, null, `expected no pitch for ${hz} Hz rumble, got ${result.hz}`);
  }
});

test('classifies a genuine 399 Hz tone consistently at both 44.1kHz and 48kHz', () => {
  for (const sampleRate of [44100, 48000]) {
    const frame = generateSineWave(399, sampleRate, FRAME_SIZE);
    const result = detectPitch(frame, sampleRate);
    assert.ok(result.hz !== null, `expected a pitch at ${sampleRate}Hz, got null`);
    assert.ok(Math.abs(result.hz - 399) / 399 < 0.01, `got ${result.hz} Hz at ${sampleRate}Hz sample rate`);
  }
});

test('returns no pitch for an undersized frame instead of a truncated-search guess', () => {
  // A 128-sample frame (one AudioWorklet quantum) cannot reliably resolve
  // a 110 Hz tone — MIN_FRAME_LENGTH_MULTIPLIER guards this explicitly
  // rather than silently narrowing the search and misreporting.
  const frame = generateSineWave(110, SAMPLE_RATE, 128);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch from an undersized frame, got ${result.hz} Hz`);
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/f0-core.js'`

- [ ] **Step 4: Implement `src/f0-core.js`**

```js
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
```

Note for whoever implements this: the obvious-looking simplification of only checking
`bestLag === searchMinLag || bestLag === searchMaxLag` (skipping the
`MIN_FRAME_LENGTH_MULTIPLIER` guard) is not sufficient on its own — a true 400 Hz tone
at 48 kHz has `searchMinLag` sitting very close to its real period, and an undersized
frame can still produce a spurious interior-looking result within a narrowed range.
Keep both checks.

Also keep the peak predicate as written (`scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]`,
scanned only over lags strictly inside the search range). The one-sided-strict form
tolerates a flat-topped peak in a real signal while still yielding *zero* candidates for a
constant DC frame, whose normalized correlation is exactly 1.0 at every lag — that "no
interior peak at all" outcome is what makes the non-periodic inputs return `hz: null`.
`PEAK_TOLERANCE = 0.9` is a margin choice, not a value the test suite pins down: the suite
passes for any tolerance from 0.1 up to 0.9996 and fails at 0.9997 (where the shortest
correct peak of the 399 Hz tone falls out of tolerance). A separate measurement on
weak-/missing-fundamental harmonic signals put the competing short-lag harmonic peaks at
≈0.36 of the best peak, so a tolerance much below ~0.4 would start admitting octave-up
errors. 0.9 sits with margin on both sides.

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm test`
Expected: all `f0-core.test.js` tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/f0-core.js tests/helpers/sine-wave.js tests/f0-core.test.js
git commit -m "Add autocorrelation pitch/volume estimator core"
```

---

### Task 4: Gate classification

**Files:**
- Create: `src/gate.js`
- Test: `tests/gate.test.js`

**Interfaces:**
- Consumes: `DETECTION_BAND_HZ` from `src/note-hz.js` (Task 1), `CONFIDENCE_MIN` from `src/config.js` (Task 1); consumes the `{hz, confidence, rms}` shape produced by `src/f0-core.js`'s `detectPitch` (Task 3), passed in as a parameter
- Produces: `CATEGORIES: string[]` (the four category names, in a single place so Task 5's session tracker doesn't hardcode its own copy), `classifyFrame(reading: {hz, confidence, rms}, options: {floorRms, confidenceMin?}): { category: 'voiced'|'too-quiet'|'no-pitch'|'out-of-range', hz: number|null }`

This is where the detection-band-vs-range-band fix lives: `classifyFrame` only ever rejects on `DETECTION_BAND_HZ` (65–400 Hz), never on the user's selectable range. A reading above the user's chosen ceiling but inside 65–400 Hz comes back `voiced`, not `out-of-range` — that's what lets the call-time face show "Too high" instead of freezing.

- [ ] **Step 1: Write the failing test**

```js
// tests/gate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFrame } from '../src/gate.js';

test('classifies as too-quiet when rms is below the floor', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.001 }, { floorRms: 0.01 });
  assert.equal(result.category, 'too-quiet');
  assert.equal(result.hz, null);
});

test('classifies as no-pitch when confidence is below the minimum', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.2, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'no-pitch');
  assert.equal(result.hz, null);
});

test('classifies as no-pitch when hz is null', () => {
  const result = classifyFrame({ hz: null, confidence: 0, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'no-pitch');
});

test('classifies as out-of-range when hz is above the 65-400 Hz detection band', () => {
  const result = classifyFrame({ hz: 500, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'out-of-range');
  assert.equal(result.hz, null);
});

test('classifies as out-of-range when hz is below the 65-400 Hz detection band', () => {
  const result = classifyFrame({ hz: 50, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'out-of-range');
  assert.equal(result.hz, null);
});

test('the detection band boundaries (65 Hz and 400 Hz) are themselves voiced, inclusive', () => {
  const low = classifyFrame({ hz: 65, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  const high = classifyFrame({ hz: 400, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(low.category, 'voiced');
  assert.equal(high.category, 'voiced');
});

test('rms exactly at the floor counts as loud enough (floor is inclusive)', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.01 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
});

test('classifies as voiced when loud enough, confident enough, and inside the detection band', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
  assert.equal(result.hz, 110);
});

test('classifies a reading above the F2-C3 ceiling but inside the detection band as voiced, not rejected', () => {
  // Regression test: this is the exact bug the design review caught — a
  // scream at 200 Hz must be measured and reported, not dropped.
  const result = classifyFrame({ hz: 200, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
  assert.equal(result.hz, 200);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/gate.js'`

- [ ] **Step 3: Implement `src/gate.js`**

```js
import { DETECTION_BAND_HZ } from './note-hz.js';
import { CONFIDENCE_MIN } from './config.js';

export const CATEGORIES = ['voiced', 'too-quiet', 'no-pitch', 'out-of-range'];

export function classifyFrame({ hz, confidence, rms }, { floorRms, confidenceMin = CONFIDENCE_MIN }) {
  if (rms < floorRms) {
    return { category: 'too-quiet', hz: null };
  }
  if (hz === null || confidence < confidenceMin) {
    return { category: 'no-pitch', hz: null };
  }
  if (hz < DETECTION_BAND_HZ.min || hz > DETECTION_BAND_HZ.max) {
    return { category: 'out-of-range', hz: null };
  }
  return { category: 'voiced', hz };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `gate.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/gate.js tests/gate.test.js
git commit -m "Add gate classification with detection-band-only rejection"
```

---

### Task 5: In-memory session tracking

**Files:**
- Create: `src/session.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `CATEGORIES` from `src/gate.js` (Task 4) — the category list is defined once, in `gate.js`, and derived here rather than re-hardcoded, so the two modules can never silently drift apart; the `{category, hz}` shape produced by `classifyFrame` is passed in as a parameter
- Produces: `createSession(): { record({category, hz}, timestampMs): void, getCounts(): {voiced, 'too-quiet', 'no-pitch', 'out-of-range'}, getHistory(): Array<{timestampMs, category, hz}>, reset(): void }`

Nothing this module produces is ever written to `chrome.storage` or any other persistent store — later plans must only ever call `reset()` between calls, never persist the output of `getHistory()`/`getCounts()`.

- [ ] **Step 1: Write the failing test**

```js
// tests/session.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';

test('getCounts starts all categories at zero', () => {
  const session = createSession();
  assert.deepEqual(session.getCounts(), {
    voiced: 0,
    'too-quiet': 0,
    'no-pitch': 0,
    'out-of-range': 0,
  });
});

test('record increments the matching category count', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.record({ category: 'voiced', hz: 115 }, 1100);
  session.record({ category: 'too-quiet', hz: null }, 1200);
  const counts = session.getCounts();
  assert.equal(counts.voiced, 2);
  assert.equal(counts['too-quiet'], 1);
  assert.equal(counts['no-pitch'], 0);
  assert.equal(counts['out-of-range'], 0);
});

test('getHistory returns entries in the order they were recorded', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.record({ category: 'voiced', hz: 200 }, 2000);
  const history = session.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].hz, 110);
  assert.equal(history[1].hz, 200);
});

test('getHistory returns a copy, not a live reference', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  const history = session.getHistory();
  history.push({ category: 'voiced', hz: 999, timestampMs: 9999 });
  assert.equal(session.getHistory().length, 1);
});

test('reset clears counts and history', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.reset();
  assert.deepEqual(session.getCounts(), {
    voiced: 0,
    'too-quiet': 0,
    'no-pitch': 0,
    'out-of-range': 0,
  });
  assert.equal(session.getHistory().length, 0);
});

test('getCounts returns a copy, not a live reference', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  const counts = session.getCounts();
  counts.voiced = 999;
  assert.equal(session.getCounts().voiced, 1);
});

test('record throws on an unrecognized category rather than silently corrupting counts', () => {
  const session = createSession();
  assert.throws(() => session.record({ category: 'bogus', hz: 110 }, 1000));
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/session.js'`

- [ ] **Step 3: Implement `src/session.js`**

```js
import { CATEGORIES } from './gate.js';

const EMPTY_COUNTS = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));

export function createSession() {
  let counts = { ...EMPTY_COUNTS };
  let history = [];

  function record({ category, hz }, timestampMs) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Unrecognized category: ${category}`);
    }
    counts[category] += 1;
    history.push({ timestampMs, category, hz });
  }

  function getCounts() {
    return { ...counts };
  }

  function getHistory() {
    return history.slice();
  }

  function reset() {
    counts = { ...EMPTY_COUNTS };
    history = [];
  }

  return { record, getCounts, getHistory, reset };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `session.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/session.js tests/session.test.js
git commit -m "Add in-memory session tracking"
```

---

## Self-Review

**Spec coverage:**
- Detection band vs. range band separation → Tasks 1 & 4 ✓
- Self-calibrating noise floor (10th percentile, ~20s window, dB margin, bounded) → Task 2 ✓
- Confidence threshold (0.45 default) → Task 4 ✓
- Gate-rejection categories (voiced / too-quiet / no-pitch / out-of-range) → Task 4 ✓
- Session data never persists (in-memory only) → Task 5 ✓ (persistence is simply never wired to this module; enforced by later plans not calling any storage API on it)
- Every tunable constant in one place → Task 1 (`src/config.js`) ✓

**Placeholder scan:** No TBD/TODO, no "add appropriate error handling," no unshown code. Clear.

**Type consistency:** `classifyFrame`'s return shape `{category, hz}` (Task 4) matches exactly what `session.record` (Task 5) destructures. `detectPitch`'s return shape `{hz, confidence, rms}` (Task 3) matches exactly what `classifyFrame` (Task 4) destructures. Confirmed consistent.

**Post-implementation correction (final whole-branch review, after all 5 tasks were individually approved):** a Critical defect was found in `detectPitch` — it reported a confident, high-Hz "voiced" reading for non-periodic input (DC offset, slow drift, transients), because it never checked whether its winning lag was a genuine correlation peak versus just the edge of its search window. A related bug classified the same 399–400 Hz tone differently at 44.1 kHz vs 48 kHz. Both are fixed by decoupling the estimator's search range (now a fixed, wide `WIDE_SEARCH_HZ_MIN`/`MAX` in `config.js`) from the acceptance band (`DETECTION_BAND_HZ`, unchanged, still gate.js's sole responsibility), and requiring the winning lag to be strictly interior to the search range. Task 3's section above reflects the corrected design directly — an implementer working from this plan today builds the fixed version from the start. Three Important findings were fixed at the same time: the noise-floor percentile test couldn't distinguish a percentile from a minimum (Task 2, now fixed), the category-name enum was duplicated with no shared source and no guard against a typo (Tasks 4/5, now fixed via `CATEGORIES` exported from `gate.js`), and the F2/C3 range-band anchors were string literals in `note-hz.js` instead of `config.js` (Task 1, now fixed). Remaining Minor findings from the final review (out-of-range being hard to reach organically, a local test re-declaring `FRAME_SIZE` instead of importing it, `FLOOR_MAX_RMS === VOLUME_CEILING_RMS`, timestamp-unit documentation, the `package.json` test glob) are deferred — none block the next two plans.

**Second correction (same review wave, follow-up fix):** widening the search range exposed a second, latent defect the first correction did not address — `detectPitch` selected its lag with the raw, unnormalized correlation sum while reporting confidence from a normalized one. Those two metrics disagree, and at the low end of the widened range the raw sum's built-in short-lag bias beat the true peak, so a genuine 65 Hz tone was rejected as edge-pinned. Selection now uses the same normalized measure as confidence, taking the shortest interior peak within `PEAK_TOLERANCE` of the tallest — see "Design note 2 — one measure, not two" in Task 3, whose Step 4 code block is the exact shipped implementation. All 45 tests pass.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-14-fndmntl-detection-engine.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
