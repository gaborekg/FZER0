// Recordings grouped by the day they were made. The day itself names them:
// its first recording is the "Before session", its last the "After session".
// Names are computed, not stored, so adding or deleting a recording shifts
// them — except a name the therapist typed, which is kept as is.

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function autoName(index, count) {
  if (index === 0) return 'Before session';
  if (index === count - 1) return 'After session';
  return `Recording ${index + 1}`;
}

const semitones = (fromHz, toHz) => (fromHz && toHz ? 12 * Math.log2(toHz / fromHz) : null);
const known = (value) => value !== null && value !== undefined;

export function groupDays(sessions) {
  const byKey = new Map();
  sessions.forEach((session) => {
    const key = dayKey(session.startedAtMs);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(session);
  });

  return [...byKey.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => {
      const ordered = [...list].sort((a, b) => a.startedAtMs - b.startedAtMs);
      const recordings = ordered.map((session, index) => {
        const auto = autoName(index, ordered.length);
        const custom = String(session.customName ?? '').trim();
        return { session, position: index + 1, autoName: auto, name: custom || auto };
      });
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      const comparison =
        ordered.length < 2
          ? null
          : {
              pitchSemitones: semitones(first.meanHz, last.meanHz),
              volumeDb: known(first.meanDb) && known(last.meanDb) ? last.meanDb - first.meanDb : null,
            };
      const calibrations = new Set(ordered.map((s) => s.calibratedAtMs).filter(known));
      return { key, recordings, first, last, comparison, calibrationChanged: calibrations.size > 1 };
    });
}

export function describeSemitones(st) {
  if (!known(st)) return '—';
  const size = Math.abs(st).toFixed(1);
  if (size === '0.0') return '0.0 st';
  return `${st < 0 ? '↓' : '↑'} ${size} st`;
}

export function describeDb(db) {
  if (!known(db)) return '—';
  const rounded = Math.round(db);
  if (rounded === 0) return '0 dB';
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)} dB`;
}
