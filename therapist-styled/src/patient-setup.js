// A patient's setup: the notes a measurement is judged against, and whether
// their voice has been calibrated. The target follows the fundamental tone
// until the therapist picks one by hand.
import { notesInRange, isValidRange } from './note-hz.js';
import { bandNotesFor, clampRangeToBand } from './voice-bands.js';

const blank = (value) => !String(value ?? '').trim();

function rangeNotes(profile) {
  const { rangeLowNote: low, rangeHighNote: high } = profile;
  return !blank(low) && !blank(high) && isValidRange(low, high) ? notesInRange(low, high) : null;
}

export function fundamentalOutsideRange(profile) {
  const notes = rangeNotes(profile);
  return Boolean(notes && !blank(profile.fundamentalNote) && !notes.includes(profile.fundamentalNote));
}

export function applyProfileChange(profile, patch) {
  const next = { ...profile, ...patch };

  // Undefined (profiles saved before this rule) means: automatic only if
  // there is no target yet, so an existing choice is never thrown away.
  let automatic = next.targetIsAutomatic ?? blank(profile.targetNote);
  if ('targetNote' in patch) automatic = blank(patch.targetNote);

  const notes = rangeNotes(next);
  if (!automatic && !(notes && notes.includes(next.targetNote))) automatic = true;

  if (automatic) {
    next.targetNote = notes && notes.includes(next.fundamentalNote) ? next.fundamentalNote : '';
  }
  next.targetIsAutomatic = automatic;
  return next;
}

// A new sex can mean a different voice band. A range already chosen is moved
// into it; an empty range stays empty; a fundamental the new band does not
// offer is cleared rather than kept where nobody can see it. Only the notes
// are patched, so an automatic target stays automatic.
export function applySexChange(profile, sex) {
  const patch = { sex };
  if (profile.fundamentalNote && !bandNotesFor(sex).includes(profile.fundamentalNote)) {
    patch.fundamentalNote = '';
  }
  if (profile.rangeLowNote || profile.rangeHighNote) {
    const { rangeLowNote, rangeHighNote } = clampRangeToBand(profile, sex);
    Object.assign(patch, { rangeLowNote, rangeHighNote });
  }
  return applyProfileChange(profile, patch);
}

export function setupStatus(profile, currentYear) {
  const missing = [];
  const year = Number(profile.yearOfBirth);
  if (blank(profile.yearOfBirth) || !Number.isInteger(year) || year < 1900 || year > currentYear) {
    missing.push('Year of birth');
  }
  if (blank(profile.sex)) missing.push('Sex');
  if (blank(profile.fundamentalNote)) missing.push('Fundamental tone');
  const notes = rangeNotes(profile);
  if (!notes) missing.push('Range');
  if (blank(profile.targetNote) || !(notes && notes.includes(profile.targetNote))) missing.push('Target note');

  const notesDone = missing.length === 0;
  const calibrated = Boolean(profile.calibratedAtMs);
  if (!calibrated) missing.push('Calibration');
  return { notes: notesDone, calibrated, ready: notesDone && calibrated, missing };
}
