import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRecorder } from '../src/session-recorder.js';

const NOTES = ['G2', 'G#2', 'A2', 'A#2', 'B2'];
const FRAME_MS = 50;

function record(recorder, frames) {
  frames.forEach((frame, index) => recorder.observe(frame, index * FRAME_MS));
}

const silence = { note: null, hz: null, db: 20 };
const at = (note, hz, db = 60) => ({ note, hz, db });

test('a session with no frames produces no record at all', () => {
  assert.equal(createSessionRecorder(NOTES).finish(), null);
});

test('duration and voiced share come from every frame, silence included', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [
    at('A2', 110), at('A2', 110), at('A2', 110),
    silence,
  ]);

  const summary = recorder.finish();
  assert.equal(summary.durationMs, 150);
  assert.equal(summary.voicedShare, 0.75);
  assert.equal(summary.voicedMs, 113);
});

test('mean pitch is geometric, so an octave averages to its true midpoint', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [at('A2', 100), at('A2', 200)]);
  assert.ok(Math.abs(recorder.finish().meanHz - 141.42) < 0.01);
});

test('a monotone voice has a pitch spread of zero semitones', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [at('A2', 110), at('A2', 110), at('A2', 110)]);
  assert.ok(Math.abs(recorder.finish().semitoneSd) < 1e-9);
});

test('pitch spread is measured in semitones, not hertz', () => {
  // Two values a semitone either side of centre: the population SD of
  // {-1, +1} semitones is exactly 1.
  const recorder = createSessionRecorder(NOTES);
  const centre = 110;
  record(recorder, [
    at('A2', centre / 2 ** (1 / 12)),
    at('A2', centre * 2 ** (1 / 12)),
  ]);
  assert.ok(Math.abs(recorder.finish().semitoneSd - 1) < 1e-6);
});

test('the reported range uses percentiles, so one stray frame cannot define it', () => {
  const recorder = createSessionRecorder(NOTES);
  // Ninety-nine frames at 110 Hz and a single octave-error frame at 55.
  const frames = Array.from({ length: 99 }, () => at('A2', 110));
  frames.push(at('A2', 55));
  record(recorder, frames);

  const summary = recorder.finish();
  assert.ok(Math.abs(summary.p5Hz - 110) < 0.001, `p5 was ${summary.p5Hz}`);
  assert.ok(Math.abs(summary.p95Hz - 110) < 0.001);
});

test('volume is averaged over every frame and the loudest is kept', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [
    { note: null, hz: null, db: 40 },
    at('A2', 110, 80),
  ]);

  const summary = recorder.finish();
  assert.equal(summary.meanDb, 60);
  assert.equal(summary.maxDb, 80);
});

test('in-zone share counts voiced frames outside the chart against you', () => {
  // Three voiced frames: one in the zone, one on a charted note outside it,
  // one on a note with no bar at all. Only the first is in the zone, and the
  // third must still count towards the total.
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [at('A2', 110), at('B2', 123), at('E4', 330)]);

  const summary = recorder.finish({ zoneNotes: ['G#2', 'A2', 'A#2'] });
  assert.ok(Math.abs(summary.inZoneShare - 1 / 3) < 1e-9);
});

test('note counts ignore pitches that have no bar rather than throwing', () => {
  const recorder = createSessionRecorder(NOTES);
  assert.doesNotThrow(() => record(recorder, [at('E4', 330)]));
  assert.equal(recorder.finish().noteCounts.A2, 0);
});

test('the settings in force are stored alongside the measurements', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [at('A2', 110)]);

  const summary = recorder.finish({
    zoneNotes: ['A2'],
    rangeLowNote: 'G2',
    rangeHighNote: 'B2',
    targetNote: 'A2',
  });

  assert.equal(summary.rangeLowNote, 'G2');
  assert.equal(summary.rangeHighNote, 'B2');
  assert.equal(summary.targetNote, 'A2');
});

test('a session of pure silence still records, with no pitch figures', () => {
  const recorder = createSessionRecorder(NOTES);
  record(recorder, [silence, silence]);

  const summary = recorder.finish();
  assert.equal(summary.voicedShare, 0);
  assert.equal(summary.meanHz, null);
  assert.equal(summary.semitoneSd, null);
  assert.equal(summary.inZoneShare, null);
  assert.equal(summary.meanDb, 20);
});
