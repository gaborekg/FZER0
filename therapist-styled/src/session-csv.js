import { hzToNote } from './note-hz.js';

// The session log as a spreadsheet, for handing to a speech therapist.
//
// It opens with a short block naming who the readings belong to, then a blank
// line, then the table. That preamble is not strict CSV, and it is deliberate:
// this file is read by a person in Excel or Numbers, and a page of numbers with
// no name on it is not a clinical record.

const COLUMNS = [
  'Date',
  'Duration (min)',
  'Time speaking (%)',
  'Average pitch',
  'Average pitch (Hz)',
  'Pitch spread (semitones)',
  'Low 5% ',
  'High 95%',
  'Range measured against',
  'Target',
  'Time in range (%)',
  'Average volume (dB)',
  'Peak volume (dB)',
];

function escapeField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const row = (fields) => fields.map(escapeField).join(',');

const round = (value, places = 0) =>
  value === null || value === undefined ? '' : Number(value.toFixed(places));

const note = (hz) => (hz === null || hz === undefined ? '' : hzToNote(hz));

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

export function buildSessionsCsv(sessions, profile = {}) {
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');

  const preamble = [
    row(['FZER0 voice sessions']),
    row(['Name', name]),
    row(['Year of birth', profile.yearOfBirth ?? '']),
    row(['Sex', profile.sex ?? '']),
    row(['Fundamental tone', profile.fundamentalNote ?? '']),
    row(['Sessions', sessions.length]),
    '',
  ];

  const table = sessions.map((session) =>
    row([
      isoDate(session.startedAtMs),
      round(session.durationMs / 60000, 1),
      round(session.voicedShare * 100),
      note(session.meanHz),
      round(session.meanHz, 1),
      round(session.semitoneSd, 1),
      note(session.p5Hz),
      note(session.p95Hz),
      session.rangeLowNote && session.rangeHighNote
        ? `${session.rangeLowNote}-${session.rangeHighNote}`
        : '',
      session.targetNote ?? '',
      session.inZoneShare === null ? '' : round(session.inZoneShare * 100),
      round(session.meanDb),
      round(session.maxDb),
    ])
  );

  return [...preamble, row(COLUMNS), ...table].join('\n');
}
