// A therapy visit: one measurement before the session, one after, and the
// change between them. The visit only points at the two sessions by id — the
// figures themselves live in the session log like any other measurement.

// The same threshold the progress trend uses: a voice does not hold still to a
// tenth of a semitone, so smaller movement is not reported as a change.
const SAME_SEMITONES = 0.5;

export function createVisit(id, nowMs) {
  return { id, startedAtMs: nowMs, beforeId: null, afterId: null, recording: null, shared: false };
}

export function visitStage(visit) {
  if (!visit.beforeId) return 'before';
  if (!visit.afterId) return 'after';
  return 'complete';
}

function openStage(visit) {
  const stage = visitStage(visit);
  if (stage === 'complete') throw new Error('This visit already has Before and After.');
  return stage;
}

// Saved the moment recording starts. If the app is closed mid-take, the visit
// comes back still marked — which is how the next launch knows to say so.
export function markRecording(visit) {
  return { ...visit, recording: openStage(visit) };
}

export function markRecorded(visit, sessionId) {
  return { ...visit, [`${openStage(visit)}Id`]: sessionId, recording: null };
}

export function clearRecording(visit) {
  return { ...visit, recording: null };
}

export function compareVisit(before, after) {
  if (!after) return { semitones: null, direction: 'pending' };
  if (!before?.meanHz || !after.meanHz) return { semitones: null, direction: null };
  const semitones = 12 * Math.log2(after.meanHz / before.meanHz);
  let direction = 'same';
  if (semitones <= -SAME_SEMITONES) direction = 'lower';
  if (semitones >= SAME_SEMITONES) direction = 'higher';
  return { semitones, direction };
}

export function describeChange({ semitones, direction }) {
  if (direction === 'pending') return 'After not recorded yet';
  if (direction === null) return 'not enough voice to compare';
  if (direction === 'same') return 'about the same (within half a semitone)';
  return `${Math.abs(semitones).toFixed(1)} semitones ${direction}`;
}

// The History list: visits as one item each, every other session on its own.
// Sessions saved before visits existed have no id and can never be in one.
export function historyItems(sessions, visits) {
  const byId = new Map(sessions.filter((s) => s.id).map((s) => [s.id, s]));
  const inVisit = new Set();
  const items = [];

  visits.forEach((visit) => {
    const before = (visit.beforeId && byId.get(visit.beforeId)) || null;
    const after = (visit.afterId && byId.get(visit.afterId)) || null;
    if (!before && !after) return;
    if (before) inVisit.add(before.id);
    if (after) inVisit.add(after.id);
    items.push({ kind: 'visit', visit, before, after, sortMs: visit.startedAtMs });
  });

  sessions.forEach((session) => {
    if (session.id && inVisit.has(session.id)) return;
    items.push({ kind: 'session', session, sortMs: session.startedAtMs });
  });

  return items
    .sort((a, b) => b.sortMs - a.sortMs)
    .map(({ sortMs, ...item }) => item);
}
