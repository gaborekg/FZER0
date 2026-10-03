// Is the voice moving towards the target, away from it, or holding?
//
// The comparison is always against the person's OWN target. "Closer" and
// "further" are then statements of fact about distance, not judgements about
// whether their voice is good — which is not something this app is in a
// position to say.

// Two sessions on each side of the comparison is the least that can mean
// anything; one-versus-one is just two numbers.
const MIN_PER_SIDE = 2;
const MAX_PER_SIDE = 3;
export const MIN_SESSIONS_FOR_TREND = MIN_PER_SIDE * 2;

// A voice does not hold still to a tenth of a semitone from one call to the
// next. Movement smaller than this is reported as no change rather than
// dressed up as a trend.
const PITCH_SAME_SEMITONES = 0.5;
const ZONE_SAME_POINTS = 5;

function semitonesBetween(fromHz, toHz) {
  return 12 * Math.log2(toHz / fromHz);
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function geometricMean(values) {
  if (values.length === 0) return null;
  return 2 ** mean(values.map((value) => Math.log2(value)));
}

function direction(deltaTowardsBetter, threshold, [better, worse, same]) {
  if (deltaTowardsBetter > threshold) return better;
  if (deltaTowardsBetter < -threshold) return worse;
  return same;
}

// `summaries` oldest first, as stored.
export function summariseTrend(summaries, targetHz) {
  const usable = summaries.filter((summary) => summary.meanHz !== null);

  if (usable.length < MIN_SESSIONS_FOR_TREND) {
    return {
      status: 'not-enough',
      sessionsRecorded: usable.length,
      sessionsNeeded: MIN_SESSIONS_FOR_TREND - usable.length,
    };
  }

  // Split down the middle, capped — so an early run of sessions doesn't stay
  // in the baseline forever, and "recent" keeps meaning recent.
  const perSide = Math.min(MAX_PER_SIDE, Math.floor(usable.length / 2));
  const earlier = usable.slice(usable.length - perSide * 2, usable.length - perSide);
  const recent = usable.slice(usable.length - perSide);

  const earlierHz = geometricMean(earlier.map((summary) => summary.meanHz));
  const recentHz = geometricMean(recent.map((summary) => summary.meanHz));

  // Distance to target, unsigned — moving up towards a higher target and down
  // towards a lower one are the same movement.
  const earlierDistance = Math.abs(semitonesBetween(targetHz, earlierHz));
  const recentDistance = Math.abs(semitonesBetween(targetHz, recentHz));
  const closerBy = earlierDistance - recentDistance;

  const withZone = (list) => list.filter((summary) => summary.inZoneShare !== null);
  const earlierZone = mean(withZone(earlier).map((summary) => summary.inZoneShare));
  const recentZone = mean(withZone(recent).map((summary) => summary.inZoneShare));
  const zonePoints =
    earlierZone === null || recentZone === null ? null : (recentZone - earlierZone) * 100;

  return {
    status: 'ready',
    sessionsCompared: perSide,
    pitch: {
      earlierHz,
      recentHz,
      movedSemitones: semitonesBetween(earlierHz, recentHz),
      closerBySemitones: closerBy,
      direction: direction(closerBy, PITCH_SAME_SEMITONES, ['closer', 'further', 'same']),
    },
    inZone: {
      earlierShare: earlierZone,
      recentShare: recentZone,
      deltaPoints: zonePoints,
      direction:
        zonePoints === null
          ? 'same'
          : direction(zonePoints, ZONE_SAME_POINTS, ['up', 'down', 'same']),
    },
  };
}
