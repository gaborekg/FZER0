// Turns a call's worth of frames into the handful of numbers worth keeping.
//
// Frames arrive ~20 times a second, so a half-hour call is ~36,000 of them.
// Everything here is accumulated as it goes and the raw samples are dropped at
// finish(), because what gets stored is the summary — the record a person
// (or their speech therapist) reads afterwards, not the recording.

// Population standard deviation of pitch, expressed in semitones. This is the
// monotone-vs-varied measure: a voice that sits on one note all call scores
// near zero. It has to be computed in log space for the same reason the mean
// does — a semitone is a ratio, not a fixed number of hertz.
function semitonesFromLog2(log2Hz) {
  return log2Hz * 12;
}

function percentile(sortedValues, percent) {
  if (sortedValues.length === 0) return null;
  const index = Math.round((percent / 100) * (sortedValues.length - 1));
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))];
}

export function createSessionRecorder(notes) {
  const noteCounts = Object.fromEntries(notes.map((note) => [note, 0]));

  let totalFrames = 0;
  let voicedFrames = 0;
  let logHzSum = 0;
  let logHzSumOfSquares = 0;
  let logHzSamples = [];

  let dbSum = 0;
  let dbFrames = 0;
  let maxDb = null;

  let startedAtMs = null;
  let lastAtMs = null;

  return {
    // Called for EVERY frame, silence included — the share of the call spent
    // actually speaking is one of the more telling numbers in the summary, and
    // it can't be known without counting the quiet frames too.
    //
    // `note` is null when the frame carried no usable pitch. `db` is always
    // present: volume is measured whether or not a pitch was found.
    observe({ note, hz, db }, timestampMs) {
      if (startedAtMs === null) startedAtMs = timestampMs;
      lastAtMs = timestampMs;
      totalFrames += 1;

      if (db !== null && db !== undefined) {
        dbSum += db;
        dbFrames += 1;
        if (maxDb === null || db > maxDb) maxDb = db;
      }

      if (note === null || hz === null || hz === undefined) return;

      voicedFrames += 1;
      const log2Hz = Math.log2(hz);
      logHzSum += log2Hz;
      logHzSumOfSquares += log2Hz * log2Hz;
      logHzSamples.push(log2Hz);

      // A pitch outside the charted notes still counts as voice — it just has
      // no bar. Dropping it from the counts but not from voicedFrames is what
      // makes the in-zone share honest.
      if (note in noteCounts) noteCounts[note] += 1;
    },

    // Returns null when nothing was heard at all: an empty session is not a
    // result worth filing.
    finish({ zoneNotes = [], rangeLowNote = null, rangeHighNote = null, targetNote = null } = {}) {
      if (totalFrames === 0) {
        return null;
      }

      const durationMs = Math.max(0, lastAtMs - startedAtMs);
      const voicedShare = voicedFrames / totalFrames;

      let meanHz = null;
      let semitoneSd = null;
      let p5Hz = null;
      let p95Hz = null;

      if (voicedFrames > 0) {
        const meanLog2 = logHzSum / voicedFrames;
        meanHz = 2 ** meanLog2;

        const variance = Math.max(0, logHzSumOfSquares / voicedFrames - meanLog2 * meanLog2);
        semitoneSd = semitonesFromLog2(Math.sqrt(variance));

        const sorted = [...logHzSamples].sort((a, b) => a - b);
        // 5th/95th rather than min/max: a single octave-error frame would
        // otherwise define the whole reported range.
        p5Hz = 2 ** percentile(sorted, 5);
        p95Hz = 2 ** percentile(sorted, 95);
      }

      const inZoneFrames = zoneNotes.reduce((sum, note) => sum + (noteCounts[note] ?? 0), 0);

      // Held only to compute the percentiles above. Releasing it here means a
      // long app session doesn't carry one recording's samples into the next.
      logHzSamples = [];

      return {
        startedAtMs,
        endedAtMs: lastAtMs,
        durationMs,
        voicedShare,
        voicedMs: Math.round(durationMs * voicedShare),
        meanHz,
        semitoneSd,
        p5Hz,
        p95Hz,
        meanDb: dbFrames > 0 ? dbSum / dbFrames : null,
        maxDb,
        inZoneShare: voicedFrames > 0 ? inZoneFrames / voicedFrames : null,
        noteCounts: { ...noteCounts },
        // The settings in force at the time, so the record stays readable even
        // after the range or target is changed.
        rangeLowNote,
        rangeHighNote,
        targetNote,
      };
    },
  };
}
