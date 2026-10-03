// Progress for the therapist: what today did (first → last), and how today's
// start and end compare with the previous day and with the very first day.
const semitones = (fromHz, toHz) => (fromHz && toHz ? 12 * Math.log2(toHz / fromHz) : null);
const known = (value) => value !== null && value !== undefined;

function calibrationsOf(day) {
  return new Set(day.recordings.map((r) => r.session.calibratedAtMs).filter(known));
}

function differentCalibration(a, b) {
  if (a.calibrationChanged || b.calibrationChanged) return true;
  const ca = calibrationsOf(a);
  const cb = calibrationsOf(b);
  if (ca.size === 0 || cb.size === 0) return false;
  return [...ca].some((value) => !cb.has(value));
}

function compare(today, other) {
  return {
    day: other,
    startSemitones: semitones(other.first.meanHz, today.first.meanHz),
    endSemitones: semitones(other.last.meanHz, today.last.meanHz),
    differentCalibration: differentCalibration(today, other),
  };
}

// `days` newest first, as groupDays returns them.
export function summariseProgress(days) {
  if (days.length === 0) return null;
  const today = days[0];
  const single = today.recordings.length === 1;
  return {
    today: { day: today, semitones: single ? null : semitones(today.first.meanHz, today.last.meanHz), single },
    previous: days.length > 1 ? compare(today, days[1]) : null,
    first: days.length > 2 ? compare(today, days[days.length - 1]) : null,
    previousIsFirst: days.length === 2,
  };
}

// Whether a move went towards the patient's own target: 'good' closer,
// 'warn' further, '' no clear change or nothing to compare. Never a judgement
// that lower or higher is better in itself.
const distanceTo = (hz, targetHz) => Math.abs(12 * Math.log2(hz / targetHz));
export function towardsTarget(fromHz, toHz, targetHz) {
  if (!fromHz || !toHz || !targetHz) return '';
  const closer = distanceTo(fromHz, targetHz) - distanceTo(toHz, targetHz);
  if (closer > 0.05) return 'good';
  if (closer < -0.05) return 'warn';
  return '';
}
