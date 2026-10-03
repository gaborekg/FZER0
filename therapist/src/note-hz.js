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

// Pure, testable range-validity check used by onboarding's setup form: a
// range is only usable if it spans at least two distinct notes. This is
// stricter than "notesInRange doesn't throw" — notesInRange('F2', 'F2')
// returns a valid, non-empty single-element array (no throw), but a
// zero-width range divides by zero downstream in the in-call panel's gauge
// math (rangeHighHz - rangeLowHz === 0). Wrapped in try/catch so an inverted
// range (already caught by notesInRange's throw) degrades to `false` here
// too, rather than propagating the exception to callers that just want a
// yes/no answer.
export function isValidRange(lowNote, highNote) {
  try {
    return notesInRange(lowNote, highNote).length >= 2;
  } catch {
    return false;
  }
}

export const RANGE_BAND_HZ = {
  min: noteToHz(RANGE_BAND_LOW_NOTE),
  max: noteToHz(RANGE_BAND_HIGH_NOTE),
};
export const RANGE_BAND_NOTES = notesInRange(RANGE_BAND_LOW_NOTE, RANGE_BAND_HIGH_NOTE);
