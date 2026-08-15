import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSessionsCsv } from '../src/session-csv.js';

const SESSION = {
  startedAtMs: Date.UTC(2026, 7, 15, 9, 30),
  durationMs: 25 * 60 * 1000,
  voicedShare: 0.42,
  meanHz: 110,
  semitoneSd: 2.34,
  p5Hz: 98,
  p95Hz: 130.81,
  inZoneShare: 0.61,
  meanDb: 62.4,
  maxDb: 88.6,
  rangeLowNote: 'G2',
  rangeHighNote: 'D3',
  targetNote: 'A2',
};

const lines = (csv) => csv.split('\n');
const tableRows = (csv) => {
  const all = lines(csv);
  return all.slice(all.indexOf('') + 1); // header + data, after the blank line
};

test('the file names who the readings belong to before any numbers', () => {
  const csv = buildSessionsCsv([SESSION], {
    firstName: 'Danny',
    lastName: 'Rico',
    yearOfBirth: '1987',
    sex: 'Male',
    fundamentalNote: 'B2',
  });

  assert.match(csv, /^FZER0 voice sessions/);
  assert.match(csv, /\nName,Danny Rico\n/);
  assert.match(csv, /\nYear of birth,1987\n/);
  assert.match(csv, /\nFundamental tone,B2\n/);
});

test('a blank line separates the preamble from the table', () => {
  const csv = buildSessionsCsv([SESSION], {});
  const blankAt = lines(csv).indexOf('');
  assert.ok(blankAt > 0);
  assert.match(lines(csv)[blankAt + 1], /^Date,Duration/);
});

test('one row per session, in the order given', () => {
  const csv = buildSessionsCsv([SESSION, { ...SESSION, startedAtMs: Date.UTC(2026, 7, 16, 9, 0) }], {});
  const rows = tableRows(csv);
  assert.equal(rows.length, 3, 'header plus two sessions');
  assert.match(rows[1], /^2026-08-15 09:30,/);
  assert.match(rows[2], /^2026-08-16 09:00,/);
});

test('figures are rounded to something a person can read', () => {
  const row = tableRows(buildSessionsCsv([SESSION], {}))[1].split(',');
  assert.equal(row[1], '25', 'duration in minutes');
  assert.equal(row[2], '42', 'time speaking as a percentage');
  assert.equal(row[3], 'A2', 'average pitch as a note');
  assert.equal(row[5], '2.3', 'pitch spread to one decimal');
  assert.equal(row[8], 'G2-D3', 'the range it was measured against');
  assert.equal(row[10], '61', 'time in range as a percentage');
});

test('a silent session leaves the pitch columns empty rather than writing null', () => {
  const silent = {
    ...SESSION,
    meanHz: null,
    semitoneSd: null,
    p5Hz: null,
    p95Hz: null,
    inZoneShare: null,
  };
  const row = tableRows(buildSessionsCsv([silent], {}))[1].split(',');

  assert.equal(row[3], '');
  assert.equal(row[5], '');
  assert.equal(row[10], '');
  assert.equal(row[11], '62', 'volume was still measured');
});

test('a comma in a name cannot break the columns', () => {
  const csv = buildSessionsCsv([], { firstName: 'Rico, Danny', lastName: '' });
  assert.match(csv, /\nName,"Rico, Danny"\n/);
});

test('a quote in a name is doubled, as CSV requires', () => {
  const csv = buildSessionsCsv([], { firstName: 'Dan "D" Rico', lastName: '' });
  assert.match(csv, /\nName,"Dan ""D"" Rico"\n/);
});

test('an empty log still produces a usable file with headers', () => {
  const rows = tableRows(buildSessionsCsv([], {}));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /^Date,/);
});
