import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, bandNotesFor, clampRangeToBand, VOICE_BANDS } from '../src/voice-bands.js';
import { noteToHz } from '../src/note-hz.js';

// Typical speaking fundamentals from the voice-science literature.
const MALE_SPEECH = { low: 85, high: 180 };
const FEMALE_SPEECH = { low: 165, high: 255 };

const spans = (band, { low, high }) =>
  noteToHz(band.lowNote) < low && noteToHz(band.highNote) > high;

test('the female band covers female speech with room on both sides', () => {
  // The point of the headroom: someone working their pitch upward has to be
  // able to see where they are starting from, which is below the norm.
  const band = bandFor('Female');
  assert.ok(spans(band, FEMALE_SPEECH), `${band.lowNote}-${band.highNote} should contain 165-255 Hz`);
  assert.ok(noteToHz(band.lowNote) < 145, 'reaches down into the gender-neutral zone');
});

test('the male band covers male speech with room on both sides', () => {
  const band = bandFor('Male');
  assert.ok(spans(band, MALE_SPEECH));
  assert.ok(noteToHz(band.highNote) > 185, 'reaches up past the gender-neutral zone');
});

test('the two bands overlap, because that is where the work happens', () => {
  const male = bandFor('male');
  const female = bandFor('female');
  assert.ok(noteToHz(female.lowNote) < noteToHz(male.highNote), 'they share the middle');
});

test('anything unstated gets a band that excludes nobody', () => {
  const wide = bandFor('');
  for (const sex of [undefined, null, '', 'Intersex', 'Prefer not to say', 'nonsense']) {
    assert.deepEqual(bandFor(sex), wide, `${sex} should not be guessed at`);
  }
  assert.ok(noteToHz(wide.lowNote) <= noteToHz(bandFor('male').lowNote));
  assert.ok(noteToHz(wide.highNote) >= noteToHz(bandFor('female').highNote));
});

test('the answer is not case sensitive', () => {
  assert.deepEqual(bandFor('FEMALE'), VOICE_BANDS.female);
  assert.deepEqual(bandFor('  female  '), VOICE_BANDS.female);
});

test('a band lists every semitone in it', () => {
  const notes = bandNotesFor('female');
  assert.equal(notes[0], 'A2');
  assert.equal(notes.at(-1), 'E4');
  assert.ok(notes.includes('C#3'), 'sharps included');
});

test('a range already inside the new band is left alone', () => {
  const kept = clampRangeToBand(
    { rangeLowNote: 'C3', rangeHighNote: 'A3', targetNote: 'E3' },
    'female'
  );
  assert.deepEqual(kept, { rangeLowNote: 'C3', rangeHighNote: 'A3', targetNote: 'E3' });
});

test('a range hanging below the new band is pulled in, not thrown away', () => {
  // Someone set a male range and then picked Female: keep as much of their
  // choice as still exists rather than making them start over.
  const moved = clampRangeToBand(
    { rangeLowNote: 'E2', rangeHighNote: 'C3', targetNote: 'G2' },
    'female'
  );
  assert.equal(moved.rangeLowNote, 'A2', 'the lowest note the female band has');
  assert.equal(moved.rangeHighNote, 'C3', 'this one was already inside');
});

test('a target that no longer sits inside the range is dropped', () => {
  const moved = clampRangeToBand(
    { rangeLowNote: 'E2', rangeHighNote: 'G2', targetNote: 'F2' },
    'female'
  );
  assert.equal(moved.targetNote, '', 'F2 is not on a female chart');
  assert.notEqual(moved.rangeLowNote, moved.rangeHighNote, 'and the range is still a range');
});

test('a collapsed or inverted range falls back to the whole band', () => {
  const band = bandFor('female');
  for (const broken of [
    { rangeLowNote: 'E4', rangeHighNote: 'A2' },
    { rangeLowNote: 'C3', rangeHighNote: 'C3' },
  ]) {
    const fixed = clampRangeToBand({ ...broken, targetNote: 'C3' }, 'female');
    assert.equal(fixed.rangeLowNote, band.lowNote);
    assert.equal(fixed.rangeHighNote, band.highNote);
  }
});

test('an empty or unrecognisable saved range becomes the whole band', () => {
  const band = bandFor('male');
  const fixed = clampRangeToBand({ rangeLowNote: '', rangeHighNote: 'H9', targetNote: '' }, 'male');
  assert.equal(fixed.rangeLowNote, band.lowNote);
  assert.equal(fixed.rangeHighNote, band.highNote);
});
