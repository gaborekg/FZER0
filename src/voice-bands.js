import { notesInRange, noteToHz } from './note-hz.js';

// Which notes the chart shows.
//
// Typical speaking fundamentals, from the voice-science literature: adult male
// roughly 85–180 Hz, adult female roughly 165–255 Hz. Those overlap in the
// middle, which is the whole reason this app exists — the interesting work
// happens in that overlap.
//
// Every band deliberately extends past its own norms in both directions. A
// chart that stops where "normal" stops cannot show you starting outside it
// and moving in, which is the thing a person doing voice work most wants to
// see. It also avoids telling someone their actual voice is off the scale.

export const VOICE_BANDS = {
  // 82–220 Hz. Covers a bass speaking voice at the bottom and reaches a few
  // semitones above the male norm, into the gender-neutral zone (~145–185 Hz).
  male: { lowNote: 'E2', highNote: 'A3' },

  // 110–330 Hz. Starts well below the female norm — someone working upward
  // needs to see where they are starting from — and clears the top of it by
  // about four semitones.
  female: { lowNote: 'A2', highNote: 'E4' },

  // Everything both of the above cover. Used when we have not been told, so
  // that no voice falls off the end of a chart because of an assumption.
  unspecified: { lowNote: 'E2', highNote: 'E4' },
};

const ALIASES = {
  female: 'female',
  male: 'male',
};

export function bandFor(sex) {
  return VOICE_BANDS[ALIASES[String(sex ?? '').trim().toLowerCase()] ?? 'unspecified'];
}

export function bandNotesFor(sex) {
  const band = bandFor(sex);
  return notesInRange(band.lowNote, band.highNote);
}

// Changing the band can leave a saved range hanging outside it. Pull it back in
// rather than dropping it: someone who set F2–C3 and then picks Female should
// keep as much of their choice as still exists, not start over.
export function clampRangeToBand({ rangeLowNote, rangeHighNote, targetNote }, sex) {
  const notes = bandNotesFor(sex);
  const inBand = (note) => note && notes.includes(note);

  const low = inBand(rangeLowNote)
    ? rangeLowNote
    : nearestInBand(rangeLowNote, notes) ?? notes[0];
  const high = inBand(rangeHighNote)
    ? rangeHighNote
    : nearestInBand(rangeHighNote, notes) ?? notes[notes.length - 1];

  // A range that collapsed to one note is not a range; fall back to the band.
  const ordered = notes.indexOf(low) < notes.indexOf(high);
  const rangeLow = ordered ? low : notes[0];
  const rangeHigh = ordered ? high : notes[notes.length - 1];

  const withinRange = notesInRange(rangeLow, rangeHigh);
  return {
    rangeLowNote: rangeLow,
    rangeHighNote: rangeHigh,
    // Only kept if it still sits inside the range; otherwise it is a target
    // for a note the chart no longer offers.
    targetNote: withinRange.includes(targetNote) ? targetNote : '',
  };
}

function nearestInBand(note, notes) {
  if (!note) return null;
  let hz;
  try {
    hz = noteToHz(note);
  } catch {
    return null;
  }
  // Nearest in log space, because a semitone is a ratio and not a fixed gap.
  return notes.reduce((best, candidate) =>
    Math.abs(Math.log2(hz / noteToHz(candidate))) < Math.abs(Math.log2(hz / noteToHz(best)))
      ? candidate
      : best
  );
}
