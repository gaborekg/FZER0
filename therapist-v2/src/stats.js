// Session-long averages for the in-call panel.
//
// These are all INCREMENTAL: one sample in, O(1) work. Recomputing an average
// by walking session history on every audio frame is exactly the pattern that
// made the panel lag before — frames arrive ~20x a second and the history
// grows for the whole call.

export function createRunningMean() {
  let count = 0;
  let total = 0;
  return {
    add(value) {
      count += 1;
      total += value;
    },
    mean() {
      return count === 0 ? null : total / count;
    },
  };
}

// Average pitch has to be a GEOMETRIC mean. A semitone is a constant ratio,
// not a constant Hz gap, so the arithmetic mean of 100 Hz and 200 Hz (one
// octave apart) is 150 Hz — which is a fifth above the low note, not the
// midpoint between them. Averaging in log2 space and converting back gives
// the true musical midpoint, 141.4 Hz.
export function createPitchAverage() {
  const logMean = createRunningMean();
  return {
    add(hz) {
      logMean.add(Math.log2(hz));
    },
    meanHz() {
      const mean = logMean.mean();
      return mean === null ? null : 2 ** mean;
    },
  };
}

// A true rolling window: the mean of every sample from the last windowMs,
// with older ones dropped outright. Unlike the decaying weights below, a
// sample either counts in full or not at all — which is what "the average of
// the last minute" actually means.
export function createWindowedMean(windowMs) {
  const values = [];
  const timestamps = [];
  let start = 0; // index of the oldest sample still inside the window
  let total = 0;

  function evict(nowMs) {
    while (start < timestamps.length && nowMs - timestamps[start] > windowMs) {
      total -= values[start];
      start += 1;
    }
    // Evicted samples are only unlinked, not removed, so eviction stays O(1).
    // Compact once enough have piled up — and recompute the total from
    // scratch while we are here, so an hour of add/subtract cannot drift.
    if (start > 1024) {
      values.splice(0, start);
      timestamps.splice(0, start);
      start = 0;
      total = values.reduce((sum, value) => sum + value, 0);
    }
  }

  return {
    add(value, timestampMs) {
      values.push(value);
      timestamps.push(timestampMs);
      total += value;
      evict(timestampMs);
    },
    // Takes the current time because the window keeps sliding while you are
    // silent: a minute after the last word, the last minute is empty.
    mean(nowMs) {
      evict(nowMs);
      const count = values.length - start;
      return count === 0 ? null : total / count;
    },
  };
}

// The same window, averaged in log2 space — see createPitchAverage for why
// pitch cannot use an arithmetic mean.
export function createWindowedPitchAverage(windowMs) {
  const logMean = createWindowedMean(windowMs);
  return {
    add(hz, timestampMs) {
      logMean.add(Math.log2(hz), timestampMs);
    },
    meanHz(nowMs) {
      const mean = logMean.mean(nowMs);
      return mean === null ? null : 2 ** mean;
    },
  };
}

// The frequency bar chart's data: how much of the RECENT past was spent on
// each note. Every observation is weighted by age, halving every halfLifeMs,
// so what you said a minute ago stops mattering and the bars follow the voice
// instead of accumulating a whole call's worth of history.
// Normal speech is voiced barely half the time — the gaps between words, the
// breaths, the unvoiced consonants all land as silence. Requiring a solid wall
// of sound before the chart reads as "full" would leave the bars permanently
// stuck at half height, so this share of the window counts as fully active.
const FULL_ACTIVITY_SHARE = 0.5;

export function createDecayingHistogram(notes, halfLifeMs, fullActivityShare = FULL_ACTIVITY_SHARE) {
  const weights = new Map(notes.map((note) => [note, 0]));
  let voicedWeight = 0;
  let totalWeight = 0;
  let lastTimestampMs = null;

  function decayTo(timestampMs) {
    if (lastTimestampMs === null) {
      lastTimestampMs = timestampMs;
      return;
    }
    const elapsedMs = Math.max(0, timestampMs - lastTimestampMs);
    lastTimestampMs = timestampMs;
    if (elapsedMs === 0) return;

    const factor = 2 ** (-elapsedMs / halfLifeMs);
    weights.forEach((weight, note) => weights.set(note, weight * factor));
    voicedWeight *= factor;
    totalWeight *= factor;
  }

  return {
    // Called for EVERY frame. `note` is null when the frame carried no usable
    // pitch — silence has to count towards the total, otherwise the chart
    // could never tell "quiet" from "talking".
    //
    // A note outside the chart is dropped rather than throwing: the detection
    // band is deliberately wider than the charted band, so a pitch with no bar
    // to land on is a normal event, not an error.
    observe(note, timestampMs) {
      decayTo(timestampMs);
      totalWeight += 1;
      if (note === null) return;
      voicedWeight += 1;
      if (weights.has(note)) weights.set(note, weights.get(note) + 1);
    },

    // Share of recent VOICED time spent on the given notes, 0..1, or null
    // before anything has been heard. Silence is excluded from both sides, so
    // this answers "when I speak, how often am I in the zone" rather than
    // being diluted by how much you happened to talk.
    //
    // Pitches outside the charted band still count towards the denominator
    // (they are voiced), so drifting above the chart correctly pushes the
    // figure down instead of going unnoticed.
    shareOf(notes) {
      if (voicedWeight === 0) return null;
      let inside = 0;
      notes.forEach((note) => {
        inside += weights.get(note) ?? 0;
      });
      return inside / voicedWeight;
    },

    // Bar heights as fractions of full, note -> 0..1.
    //
    // Two factors multiplied together. SHAPE is each note's weight relative to
    // the busiest one, which is what makes the distribution readable. ACTIVITY
    // is the share of the recent window that was voiced at all — and it is the
    // reason the chart sinks when you stop talking. Decaying the bars alone
    // would not do it: every weight shrinks by the same factor, so their
    // heights relative to each other would never change.
    heights() {
      const peak = Math.max(0, ...weights.values());
      const voicedShare = totalWeight === 0 ? 0 : voicedWeight / totalWeight;
      const activity = Math.min(1, voicedShare / fullActivityShare);
      const result = new Map();
      weights.forEach((weight, note) => {
        result.set(note, peak === 0 ? 0 : (weight / peak) * activity);
      });
      return result;
    },
  };
}
