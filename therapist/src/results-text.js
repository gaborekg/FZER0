// results.txt — the figures as plain text, so they open on any phone or
// computer without an app, next to the recordings they belong to.
import { hzToNote } from './note-hz.js';
import { compareVisit, describeChange } from './visit.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

function longDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function clock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DASH = '—';
const missing = (value) => value === null || value === undefined;

const pitch = (s) => (missing(s.meanHz) ? DASH : `${hzToNote(s.meanHz)} (${Math.round(s.meanHz)} Hz)`);
const percent = (v) => (missing(v) ? DASH : `${Math.round(v * 100)}%`);
const spread = (v) => (missing(v) ? DASH : `${v.toFixed(1)} st`);
const volume = (v) => (missing(v) ? DASH : `${Math.round(v)} dB`);

function duration(ms) {
  if (missing(ms)) return DASH;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

const ROWS = [
  ['Average', (s) => pitch(s)],
  ['In range', (s) => percent(s.inZoneShare)],
  ['Spread', (s) => spread(s.semitoneSd)],
  ['Volume', (s) => volume(s.meanDb)],
  ['Duration', (s) => duration(s.durationMs)],
];

// Fixed-width columns: a therapist reading this in Mail sees a table, not a
// run of numbers.
const LABEL_WIDTH = 12;
const COLUMN_WIDTH = 14;

function line(label, cells) {
  const body = cells.map((cell, i) => (i < cells.length - 1 ? cell.padEnd(COLUMN_WIDTH) : cell)).join('');
  return label.padEnd(LABEL_WIDTH) + body;
}

function targetLine(summary) {
  if (!summary) return null;
  const parts = [];
  if (summary.targetNote) parts.push(`Target: ${summary.targetNote}`);
  if (summary.rangeLowNote && summary.rangeHighNote) {
    parts.push(`Range: ${summary.rangeLowNote}–${summary.rangeHighNote}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function finish(lines, summary) {
  const target = targetLine(summary);
  if (target) lines.push(target);
  return `${lines.join('\n')}\n`;
}

function patientLines(patient) {
  if (!patient) return [];
  const born = patient.yearOfBirth ? ` · born ${patient.yearOfBirth}` : '';
  return [`Patient: ${patient.displayName}${born}`];
}

export function buildVisitResultsText(visit, before, after, patient) {
  const cell = (summary, format) => (summary ? format(summary) : DASH);
  const lines = [
    `FZER0 · Therapy visit · ${longDate(visit.startedAtMs)}`,
    ...patientLines(patient),
    '',
    line('', ['Before', 'After']),
    ...ROWS.map(([label, format]) => line(label, [cell(before, format), cell(after, format)])),
    '',
    `Change: ${describeChange(compareVisit(before, after))}`,
  ];
  return finish(lines, after ?? before);
}

export function buildSessionResultsText(session, patient) {
  const lines = [
    `FZER0 · Session · ${longDate(session.startedAtMs)}, ${clock(session.startedAtMs)}`,
    ...patientLines(patient),
    '',
    ...ROWS.map(([label, format]) => line(label, [format(session)])),
    '',
  ];
  return finish(lines, session);
}
