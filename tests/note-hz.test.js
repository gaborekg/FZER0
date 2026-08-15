import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  noteToHz,
  hzToNote,
  notesInRange,
  isValidRange,
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

test('RANGE_BAND_HZ matches E2 to A3', () => {
  assert.ok(Math.abs(RANGE_BAND_HZ.min - 82.41) < 0.05);
  assert.ok(Math.abs(RANGE_BAND_HZ.max - 220) < 0.05);
});

test('RANGE_BAND_NOTES matches E2 through A3', () => {
  assert.deepEqual(RANGE_BAND_NOTES, [
    'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2',
    'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3',
  ]);
});

test('isValidRange is false for a zero-width range (low === high)', () => {
  // notesInRange('F2', 'F2') does NOT throw — it returns ['F2'], a valid,
  // non-empty single-element array. That's exactly the gap this function
  // closes: non-throwing is not the same as usable (a zero-width range
  // divides by zero downstream in the in-call panel's gauge math).
  assert.equal(isValidRange('F2', 'F2'), false);
});

test('isValidRange is true for a genuine two-or-more-note range', () => {
  assert.equal(isValidRange('F2', 'C3'), true);
});

test('isValidRange is false (not throwing) for an inverted range', () => {
  assert.equal(isValidRange('C3', 'F2'), false);
});
