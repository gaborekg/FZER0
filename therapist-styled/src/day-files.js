// What "Share day" sends: every recording of a day, named after the day's
// own names, plus one results.txt that reads as a table in any app.
import { hzToNote } from './note-hz.js';
import { describeSemitones, describeDb } from './day-groups.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const DASH = '—';
const missing = (value) => value === null || value === undefined;

const clock = (ms, sep) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}${sep}${pad(d.getMinutes())}`;
};

const fileSafe = (text) =>
  String(text ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function dayFileNames(day, person, extFor) {
  const who = fileSafe(person);
  const names = day.recordings.map((r) => fileSafe(r.name) || r.autoName);
  const counts = new Map();
  names.forEach((n) => counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) ?? 0) + 1));

  const lead = (time) => [day.key, time, who].filter(Boolean).join(' ');
  return {
    recordings: day.recordings.map((r, i) => {
      const clash = counts.get(names[i].toLowerCase()) > 1;
      return `${lead(clash ? clock(r.session.startedAtMs, '-') : '')} - ${names[i]}.${extFor(r)}`;
    }),
    results: `${lead('')} - results.txt`,
  };
}

function longDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const ROWS = [
  ['Time', (s) => clock(s.startedAtMs, ':')],
  ['Average', (s) => (missing(s.meanHz) ? DASH : `${hzToNote(s.meanHz)} (${Math.round(s.meanHz)} Hz)`)],
  ['In range', (s) => (missing(s.inZoneShare) ? DASH : `${Math.round(s.inZoneShare * 100)}%`)],
  ['Spread', (s) => (missing(s.semitoneSd) ? DASH : `${s.semitoneSd.toFixed(1)} st`)],
  ['Volume', (s) => (missing(s.meanDb) ? DASH : `${Math.round(s.meanDb)} dB`)],
  [
    'Duration',
    (s) => {
      if (missing(s.durationMs)) return DASH;
      const total = Math.round(s.durationMs / 1000);
      return `${Math.floor(total / 60)}:${pad(total % 60)}`;
    },
  ],
];

const LABEL_WIDTH = 12;

export function buildDayResultsText(day, patient) {
  const names = day.recordings.map((r) => r.name);
  const width = Math.max(14, ...names.map((n) => n.length + 2));
  const line = (label, cells) =>
    label.padEnd(LABEL_WIDTH) + cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(width) : c)).join('');

  const lines = [`FZER0 · Day · ${longDate(day.key)}`];
  if (patient) {
    lines.push(`Patient: ${patient.displayName}${patient.yearOfBirth ? ` · born ${patient.yearOfBirth}` : ''}`);
  }
  lines.push('', line('', names));
  ROWS.forEach(([label, format]) => lines.push(line(label, day.recordings.map((r) => format(r.session)))));
  lines.push('');

  if (day.comparison) {
    lines.push(
      `First → last: ${describeSemitones(day.comparison.pitchSemitones)} · volume ${describeDb(day.comparison.volumeDb)}`
    );
  }
  if (day.calibrationChanged) lines.push('Calibration changed during this day — compare volume with care.');

  const ref = day.last;
  const target = [];
  if (ref.targetNote) target.push(`Target: ${ref.targetNote}`);
  if (ref.rangeLowNote && ref.rangeHighNote) target.push(`Range: ${ref.rangeLowNote}–${ref.rangeHighNote}`);
  if (target.length) lines.push(target.join(' · '));

  return `${lines.join('\n')}\n`;
}
