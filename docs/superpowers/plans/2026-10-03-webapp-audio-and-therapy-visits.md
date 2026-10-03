# Web App Audio Recordings & Therapy Visits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the FZER0 web app record audio alongside a measurement, pair a Before and After measurement into a "therapy visit" with a computed change, keep the audio on the device, and hand recordings + a results.txt to the iOS share sheet (Save to Files / Mail).

**Architecture:** Pure logic (visit state, file names, results text, store changes) lives in `src/` and is tested with `node --test`. Browser-only code lives in `webapp/`: IndexedDB for audio blobs, `MediaRecorder` on the microphone stream the measurement already opens, and `navigator.share({ files })` with a download fallback. Session summaries gain an `id` that keys their audio; visits are a small list in localStorage that point at two session ids.

**Tech Stack:** Plain ES modules, no build step, no dependencies. Node's built-in test runner. Safari on iPhone/iPad is the target browser.

**Spec:** `docs/superpowers/specs/2026-10-03-webapp-audio-and-therapy-visits-design.md`

## Global Constraints

- Work on a feature branch (`webapp-audio-visits`), never directly on `main`. Do not push until Gabor says so — the live GitHub Pages URL is the app he uses with his therapist.
- Web app only. Do not modify anything under `extension/` or `mock/`. Shared `src/` files may change only additively; `npm test` must stay green.
- No new dependencies, no build step, no network calls, no paid services.
- Recordings run until the user taps Stop — no length limit.
- No Zip. Shared/saved output is separate files.
- File names: `YYYY-MM-DD visit - before.<ext>`, `YYYY-MM-DD visit - after.<ext>`, `YYYY-MM-DD visit - results.txt`; when another visit exists on the same day: `YYYY-MM-DD HH-MM visit - …`. Normal session: `YYYY-MM-DD HH-MM session.<ext>` and `YYYY-MM-DD HH-MM session - results.txt`.
- Audio is saved in IndexedDB; numbers stay in localStorage.
- Visit recordings always record audio; normal sessions record audio only when the "Also record audio" switch is on.
- Sessions saved before this feature (no `id`) must keep displaying and exporting unchanged.
- The app reports facts ("2.0 semitones lower"), never advice.
- Measure screen must not scroll on a phone (see `webapp/app.js` comment) — new Measure UI is one compact row; the visit result is a `<dialog>`.

## Review Focus

1. **Share sheet losing the tap** — iOS refuses `navigator.share` if the tap is "used up" by slow async work first. Expected: files are fully prepared *before* the share buttons are enabled, so a tap shares immediately. (Task 6 builds files before rendering buttons; Task 8 checklist item.)
2. **App closed mid-recording** — reopening must not leave a visit stuck "recording". Expected: message "The last recording was interrupted…" and the same step can be recorded again. (Task 2 `clearRecording` test; Task 7 init code.)
3. **Old sessions without `id`** — expected: still listed as plain sessions, never grouped into a visit, no audio controls. (Task 2 `historyItems` test with an id-less session.)
4. **Session cap drops a session that has audio** — expected: its audio is deleted too, no orphaned blobs. (Task 4 `droppedIds` test; Task 7 wiring.)
5. **Audio cleared by iOS but numbers remain** — expected: card shows "Audio no longer in the app — check your Files folder.", results.txt still shareable. (Task 6 `filesFor…` returns `missingAudio`; Task 8 checklist item.)

---

## File map

| File | New/Changed | Responsibility |
|---|---|---|
| `src/share-files.js` | New | File names + audio extension from MIME type |
| `src/visit.js` | New | Visit record, stages, interrupted state, Before/After comparison, History grouping |
| `src/results-text.js` | New | Builds results.txt for a visit or a single session |
| `src/app-store.js` | Changed | `makeId`, `droppedIds`, `updateSession`, `deleteSessions`, visits, flags |
| `webapp/audio.js` | Changed | Expose the mic `stream` on the capture object |
| `webapp/audio-store.js` | New | IndexedDB put/get/delete/clear for audio |
| `webapp/audio-recorder.js` | New | `MediaRecorder` wrapper |
| `webapp/share.js` | New | Build `File`s for a visit/session, share sheet + fallback, share buttons |
| `webapp/visit-result.js` | New | The "Visit complete" dialog |
| `webapp/measure.js` | Changed | Audio switch, visit flow, saving audio |
| `webapp/history.js` | Changed | Visit cards, playback, share buttons, "Not saved yet" |
| `webapp/profile.js` | Changed | Delete-all also deletes audio + visits |
| `webapp/index.html`, `webapp/app.css` | Changed | Markup, styles, wiring |
| `tests/share-files.test.js`, `tests/visit.test.js`, `tests/results-text.test.js` | New | Unit tests |
| `tests/app-store.test.js` | Changed | Store tests |
| `tests/manual/audio-visits-checklist.md` | New | On-device checklist |

---

### Task 1: File names (`src/share-files.js`)

**Files:**
- Create: `src/share-files.js`
- Test: `tests/share-files.test.js`

**Interfaces:**
- Produces:
  - `audioExtension(mimeType: string | undefined): string`
  - `visitFileNames(startedAtMs: number, otherVisitStarts: number[], { beforeExt, afterExt }): { before: string, after: string, results: string }` — `otherVisitStarts` must NOT include this visit.
  - `sessionFileNames(startedAtMs: number, ext: string): { audio: string, results: string }`

- [ ] **Step 1: Write the failing test**

```js
// tests/share-files.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioExtension, visitFileNames, sessionFileNames } from '../src/share-files.js';

// Local time on purpose: the names are for the person holding the phone.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

test('Safari recordings are named .m4a', () => {
  assert.equal(audioExtension('audio/mp4'), 'm4a');
  assert.equal(audioExtension('audio/mp4;codecs=mp4a.40.2'), 'm4a');
});

test('other recorder formats keep their own extension', () => {
  assert.equal(audioExtension('audio/webm;codecs=opus'), 'webm');
  assert.equal(audioExtension('audio/ogg'), 'ogg');
});

test('an unknown or missing type falls back to m4a', () => {
  assert.equal(audioExtension(''), 'm4a');
  assert.equal(audioExtension(undefined), 'm4a');
});

test('a visit alone on its day is named by date only', () => {
  const names = visitFileNames(at(2026, 10, 3, 10, 5), [], { beforeExt: 'm4a', afterExt: 'm4a' });
  assert.deepEqual(names, {
    before: '2026-10-03 visit - before.m4a',
    after: '2026-10-03 visit - after.m4a',
    results: '2026-10-03 visit - results.txt',
  });
});

test('a second visit on the same day adds the time so nothing is overwritten', () => {
  const names = visitFileNames(at(2026, 10, 3, 14, 30), [at(2026, 10, 3, 9, 0)], {
    beforeExt: 'm4a',
    afterExt: 'm4a',
  });
  assert.equal(names.before, '2026-10-03 14-30 visit - before.m4a');
  assert.equal(names.results, '2026-10-03 14-30 visit - results.txt');
});

test('a visit on another day does not count as a clash', () => {
  const names = visitFileNames(at(2026, 10, 3, 14, 30), [at(2026, 10, 2, 14, 30)], {
    beforeExt: 'm4a',
    afterExt: 'm4a',
  });
  assert.equal(names.before, '2026-10-03 visit - before.m4a');
});

test('a normal session is named by date and time', () => {
  assert.deepEqual(sessionFileNames(at(2026, 10, 2, 18, 10), 'm4a'), {
    audio: '2026-10-02 18-10 session.m4a',
    results: '2026-10-02 18-10 session - results.txt',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/share-files.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/share-files.js
// Names for the files handed to the share sheet. Every name starts with the
// date, so a Files folder holding months of visits sorts itself.

const pad = (n) => String(n).padStart(2, '0');

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A hyphen, not a colon: colons are not allowed in file names everywhere.
function localTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

const EXTENSIONS = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

// Safari, the target, records audio/mp4. Anything unrecognised is most likely
// that too, under a name this table does not know.
export function audioExtension(mimeType) {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? 'm4a';
}

export function visitFileNames(startedAtMs, otherVisitStarts, { beforeExt, afterExt }) {
  const day = localDate(startedAtMs);
  const clash = otherVisitStarts.some((ms) => localDate(ms) === day);
  const base = clash ? `${day} ${localTime(startedAtMs)} visit` : `${day} visit`;
  return {
    before: `${base} - before.${beforeExt}`,
    after: `${base} - after.${afterExt}`,
    results: `${base} - results.txt`,
  };
}

export function sessionFileNames(startedAtMs, ext) {
  const base = `${localDate(startedAtMs)} ${localTime(startedAtMs)} session`;
  return { audio: `${base}.${ext}`, results: `${base} - results.txt` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass (99 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add src/share-files.js tests/share-files.test.js
git commit -m "Name shared files by date, adding the time when a day has two visits"
```

---

### Task 2: Visit logic (`src/visit.js`)

**Files:**
- Create: `src/visit.js`
- Test: `tests/visit.test.js`

**Interfaces:**
- Produces:
  - Visit shape: `{ id: string, startedAtMs: number, beforeId: string|null, afterId: string|null, recording: 'before'|'after'|null, shared: boolean }`
  - `createVisit(id: string, nowMs: number): Visit`
  - `visitStage(visit): 'before' | 'after' | 'complete'`
  - `markRecording(visit): Visit` — sets `recording` to the current stage
  - `markRecorded(visit, sessionId: string): Visit` — fills the current stage's id, clears `recording`
  - `clearRecording(visit): Visit`
  - `compareVisit(before: Summary|null, after: Summary|null): { semitones: number|null, direction: 'lower'|'higher'|'same'|'pending'|null }` — `'pending'` when there is no After yet
  - `describeChange(comparison): string`
  - `historyItems(sessions: Summary[], visits: Visit[]): Array<{ kind: 'visit', visit, before, after } | { kind: 'session', session }>` newest first

- [ ] **Step 1: Write the failing test**

```js
// tests/visit.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVisit,
  visitStage,
  markRecording,
  markRecorded,
  clearRecording,
  compareVisit,
  describeChange,
  historyItems,
} from '../src/visit.js';

test('a new visit waits for Before', () => {
  const visit = createVisit('v1', 1000);
  assert.deepEqual(visit, {
    id: 'v1',
    startedAtMs: 1000,
    beforeId: null,
    afterId: null,
    recording: null,
    shared: false,
  });
  assert.equal(visitStage(visit), 'before');
});

test('recording Before then After completes the visit', () => {
  let visit = createVisit('v1', 1000);
  visit = markRecording(visit);
  assert.equal(visit.recording, 'before');
  visit = markRecorded(visit, 's1');
  assert.equal(visit.beforeId, 's1');
  assert.equal(visit.recording, null);
  assert.equal(visitStage(visit), 'after');

  visit = markRecorded(markRecording(visit), 's2');
  assert.equal(visit.afterId, 's2');
  assert.equal(visitStage(visit), 'complete');
});

test('a recording interrupted by closing the app can be cleared and redone', () => {
  // On reload, a visit still marked as recording was cut off mid-take.
  let visit = markRecording(markRecorded(createVisit('v1', 1000), 's1'));
  assert.equal(visit.recording, 'after');
  visit = clearRecording(visit);
  assert.equal(visit.recording, null);
  assert.equal(visitStage(visit), 'after');
});

test('a complete visit cannot record a third measurement', () => {
  const done = markRecorded(markRecorded(createVisit('v1', 1000), 's1'), 's2');
  assert.throws(() => markRecording(done));
  assert.throws(() => markRecorded(done, 's3'));
});

test('a lower average pitch after the session reads as lower', () => {
  const result = compareVisit({ meanHz: 110 }, { meanHz: 98 });
  assert.equal(result.direction, 'lower');
  assert.ok(Math.abs(result.semitones - 12 * Math.log2(98 / 110)) < 1e-9);
  assert.equal(describeChange(result), '2.0 semitones lower');
});

test('a higher average pitch reads as higher', () => {
  assert.equal(describeChange(compareVisit({ meanHz: 98 }, { meanHz: 110 })), '2.0 semitones higher');
});

test('less than half a semitone is reported as no clear change', () => {
  const result = compareVisit({ meanHz: 100 }, { meanHz: 101 });
  assert.equal(result.direction, 'same');
  assert.equal(describeChange(result), 'about the same (within half a semitone)');
});

test('without a pitch on both sides there is nothing to compare', () => {
  assert.deepEqual(compareVisit({ meanHz: null }, { meanHz: 98 }), { semitones: null, direction: null });
  assert.equal(describeChange({ semitones: null, direction: null }), 'not enough voice to compare');
});

test('a visit with no After yet says so, rather than blaming the voice', () => {
  const result = compareVisit({ meanHz: 110 }, null);
  assert.deepEqual(result, { semitones: null, direction: 'pending' });
  assert.equal(describeChange(result), 'After not recorded yet');
});

test('history groups a visit\'s two sessions into one item, newest first', () => {
  const sessions = [
    { id: 'a', startedAtMs: 100 },
    { id: 'b', startedAtMs: 200 },
    { id: 'c', startedAtMs: 300 },
  ];
  const visits = [{ ...createVisit('v1', 150), beforeId: 'b', afterId: 'c' }];
  const items = historyItems(sessions, visits);

  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'visit');
  assert.equal(items[0].before.id, 'b');
  assert.equal(items[0].after.id, 'c');
  assert.equal(items[1].kind, 'session');
  assert.equal(items[1].session.id, 'a');
});

test('sessions from before this feature have no id and stay plain sessions', () => {
  const items = historyItems([{ startedAtMs: 100 }, { startedAtMs: 200 }], []);
  assert.deepEqual(
    items.map((item) => [item.kind, item.session.startedAtMs]),
    [
      ['session', 200],
      ['session', 100],
    ]
  );
});

test('a visit waiting for After shows with an empty After', () => {
  const items = historyItems([{ id: 'b', startedAtMs: 200 }], [{ ...createVisit('v1', 150), beforeId: 'b' }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].after, null);
});

test('a visit whose sessions are all gone is left out', () => {
  assert.deepEqual(historyItems([], [createVisit('v1', 150)]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/visit.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/visit.js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/visit.js tests/visit.test.js
git commit -m "Add therapy visits: Before/After stages, the change between them, History grouping"
```

---

### Task 3: results.txt (`src/results-text.js`)

**Files:**
- Create: `src/results-text.js`
- Test: `tests/results-text.test.js`

**Interfaces:**
- Consumes: `compareVisit`, `describeChange` from `src/visit.js`; `hzToNote` from `src/note-hz.js`.
- Produces:
  - `buildVisitResultsText(visit, before: Summary|null, after: Summary|null): string`
  - `buildSessionResultsText(session: Summary): string`

- [ ] **Step 1: Write the failing test**

```js
// tests/results-text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisitResultsText, buildSessionResultsText } from '../src/results-text.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

const before = {
  startedAtMs: at(2026, 10, 3, 10, 5),
  durationMs: 45_000,
  meanHz: 110,
  inZoneShare: 0.71,
  semitoneSd: 2.1,
  meanDb: 58.2,
  targetNote: 'G2',
  rangeLowNote: 'F2',
  rangeHighNote: 'A2',
};

const after = {
  ...before,
  startedAtMs: at(2026, 10, 3, 11, 10),
  durationMs: 50_000,
  meanHz: 98,
  inZoneShare: 0.84,
  semitoneSd: 1.6,
  meanDb: 61,
};

test('a visit is a two-column table with the change underneath', () => {
  const text = buildVisitResultsText({ startedAtMs: before.startedAtMs }, before, after);
  assert.equal(
    text,
    [
      'FZER0 · Therapy visit · 3 Oct 2026',
      '',
      '            Before        After',
      'Average     A2 (110 Hz)   G2 (98 Hz)',
      'In range    71%           84%',
      'Spread      2.1 st        1.6 st',
      'Volume      58 dB         61 dB',
      'Duration    0:45          0:50',
      '',
      'Change: 2.0 semitones lower',
      'Target: G2 · Range: F2–A2',
      '',
    ].join('\n')
  );
});

test('a visit with no After yet shows dashes and no change', () => {
  const text = buildVisitResultsText({ startedAtMs: before.startedAtMs }, before, null);
  assert.match(text, /Average {5}A2 \(110 Hz\) {3}—/);
  assert.match(text, /Change: After not recorded yet/);
});

test('missing figures show a dash instead of "null"', () => {
  const quiet = { ...after, meanHz: null, inZoneShare: null, semitoneSd: null, meanDb: null };
  const text = buildVisitResultsText({ startedAtMs: before.startedAtMs }, before, quiet);
  assert.doesNotMatch(text, /null|NaN|undefined/);
});

test('a normal session is a single column with its time in the title', () => {
  const text = buildSessionResultsText(after);
  assert.equal(
    text,
    [
      'FZER0 · Session · 3 Oct 2026, 11:10',
      '',
      'Average     G2 (98 Hz)',
      'In range    84%',
      'Spread      1.6 st',
      'Volume      61 dB',
      'Duration    0:50',
      '',
      'Target: G2 · Range: F2–A2',
      '',
    ].join('\n')
  );
});

test('a session with no target or range leaves that line out', () => {
  const text = buildSessionResultsText({ ...after, targetNote: '', rangeLowNote: '', rangeHighNote: '' });
  assert.doesNotMatch(text, /Target|Range:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/results-text.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/results-text.js
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

export function buildVisitResultsText(visit, before, after) {
  const cell = (summary, format) => (summary ? format(summary) : DASH);
  const lines = [
    `FZER0 · Therapy visit · ${longDate(visit.startedAtMs)}`,
    '',
    line('', ['Before', 'After']),
    ...ROWS.map(([label, format]) => line(label, [cell(before, format), cell(after, format)])),
    '',
    `Change: ${describeChange(compareVisit(before, after))}`,
  ];
  return finish(lines, after ?? before);
}

export function buildSessionResultsText(session) {
  const lines = [
    `FZER0 · Session · ${longDate(session.startedAtMs)}, ${clock(session.startedAtMs)}`,
    '',
    ...ROWS.map(([label, format]) => line(label, [format(session)])),
    '',
  ];
  return finish(lines, session);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass. If the visit table test fails only on spacing, compare character by character — the expected string is the spec's layout and is the source of truth.

- [ ] **Step 5: Commit**

```bash
git add src/results-text.js tests/results-text.test.js
git commit -m "Build results.txt for a visit or a single session"
```

---

### Task 4: Store — ids, visits, flags (`src/app-store.js`)

**Files:**
- Modify: `src/app-store.js`
- Test: `tests/app-store.test.js` (append)

**Interfaces:**
- Consumes: `visitStage` from `src/visit.js`.
- Produces (added to the object `createAppStore` returns, plus one export):
  - `export function makeId(): string`
  - `addSession(summary) → { dropped: number, droppedIds: string[] }` (was `{ dropped }`)
  - `updateSession(id: string, patch: object): Summary | null`
  - `deleteSessions(ids: string[]): void`
  - `listVisits(): Visit[]`
  - `saveVisit(visit: Visit): void` — insert or replace by `id`
  - `deleteVisit(id: string): void`
  - `getOpenVisit(): Visit | null` — the visit that is not `complete`
  - `getFlag(name: string): boolean`, `setFlag(name: string, value: boolean): void`
  - `clearSessions()` now also clears visits

- [ ] **Step 1: Write the failing tests** (append to `tests/app-store.test.js`; update the import line)

Change the import at the top to:

```js
import { createAppStore, EMPTY_PROFILE, MAX_SESSIONS, makeId } from '../src/app-store.js';
```

Append:

```js
test('ids are unique strings', () => {
  const ids = new Set(Array.from({ length: 500 }, () => makeId()));
  assert.equal(ids.size, 500);
  ids.forEach((id) => assert.equal(typeof id, 'string'));
});

test('addSession names the ids it dropped, so their audio can go too', () => {
  const store = createAppStore(fakeStorage());
  for (let i = 0; i < MAX_SESSIONS; i += 1) store.addSession({ id: `s${i}`, startedAtMs: i });
  const result = store.addSession({ id: 'new', startedAtMs: MAX_SESSIONS });

  assert.equal(result.dropped, 1);
  assert.deepEqual(result.droppedIds, ['s0']);
});

test('dropped sessions without an id are not listed as dropped ids', () => {
  const store = createAppStore(fakeStorage());
  for (let i = 0; i < MAX_SESSIONS; i += 1) store.addSession({ startedAtMs: i });
  assert.deepEqual(store.addSession({ id: 'new', startedAtMs: 999 }).droppedIds, []);
});

test('a session can be updated by id', () => {
  const store = createAppStore(fakeStorage());
  store.addSession({ id: 'a', startedAtMs: 1, shared: false });
  const updated = store.updateSession('a', { shared: true });

  assert.equal(updated.shared, true);
  assert.equal(store.listSessions()[0].shared, true);
  assert.equal(store.updateSession('missing', { shared: true }), null);
});

test('sessions can be deleted by id, leaving the rest', () => {
  const store = createAppStore(fakeStorage());
  ['a', 'b', 'c'].forEach((id, i) => store.addSession({ id, startedAtMs: i }));
  store.deleteSessions(['a', 'c']);
  assert.deepEqual(
    store.listSessions().map((s) => s.id),
    ['b']
  );
});

test('a visit is saved, replaced by id, and found while it is open', () => {
  const store = createAppStore(fakeStorage());
  const visit = { id: 'v1', startedAtMs: 1, beforeId: null, afterId: null, recording: null, shared: false };
  store.saveVisit(visit);
  assert.equal(store.getOpenVisit().id, 'v1');

  store.saveVisit({ ...visit, beforeId: 's1', afterId: 's2' });
  assert.equal(store.listVisits().length, 1);
  assert.equal(store.getOpenVisit(), null);
});

test('a visit can be deleted', () => {
  const store = createAppStore(fakeStorage());
  store.saveVisit({ id: 'v1', startedAtMs: 1, beforeId: null, afterId: null, recording: null, shared: false });
  store.deleteVisit('v1');
  assert.deepEqual(store.listVisits(), []);
});

test('flags default to off and remember being set', () => {
  const store = createAppStore(fakeStorage());
  assert.equal(store.getFlag('recordAudio'), false);
  store.setFlag('recordAudio', true);
  assert.equal(store.getFlag('recordAudio'), true);
  store.setFlag('recordAudio', false);
  assert.equal(store.getFlag('recordAudio'), false);
});

test('clearing sessions clears visits too', () => {
  const store = createAppStore(fakeStorage());
  store.addSession({ id: 'a', startedAtMs: 1 });
  store.saveVisit({ id: 'v1', startedAtMs: 1, beforeId: 'a', afterId: null, recording: null, shared: false });
  store.clearSessions();
  assert.deepEqual(store.listSessions(), []);
  assert.deepEqual(store.listVisits(), []);
});

test('corrupt visits or flags fall back to empty', () => {
  const store = createAppStore(fakeStorage({ 'fzer0.visits': '{bad', 'fzer0.flags': '[1]' }));
  assert.deepEqual(store.listVisits(), []);
  assert.equal(store.getFlag('recordAudio'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `makeId` is not exported / `store.updateSession is not a function`.

- [ ] **Step 3: Implement**

In `src/app-store.js`:

Add after the existing imports area (top of file, below the header comment):

```js
import { visitStage } from './visit.js';
```

Add keys next to the existing ones:

```js
const VISITS_KEY = 'fzer0.visits';
const FLAGS_KEY = 'fzer0.flags';
```

Add above `createAppStore`:

```js
// Not crypto.randomUUID: that only exists on HTTPS, and the app is also opened
// over plain HTTP on the local network while testing on a phone.
export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
```

Replace `addSession` with:

```js
  // Returns what had to go, so the caller can say so — and delete any audio
  // that belonged to it.
  function addSession(summary) {
    const sessions = [...listSessions(), summary];
    const dropped = Math.max(0, sessions.length - MAX_SESSIONS);
    let kept = dropped > 0 ? sessions.slice(dropped) : sessions;
    let gone = sessions.slice(0, dropped);

    try {
      write(SESSIONS_KEY, kept);
    } catch {
      // Out of quota despite the cap — something else on this origin is using
      // the space. Halve the log and try once more; losing the older half
      // beats losing the session that just finished.
      const cut = Math.floor(kept.length / 2);
      gone = [...gone, ...kept.slice(0, cut)];
      kept = kept.slice(cut);
      write(SESSIONS_KEY, kept);
    }

    return { dropped: gone.length, droppedIds: gone.map((s) => s.id).filter(Boolean) };
  }

  function updateSession(id, patch) {
    let updated = null;
    const sessions = listSessions().map((session) => {
      if (session.id !== id) return session;
      updated = { ...session, ...patch };
      return updated;
    });
    if (updated) write(SESSIONS_KEY, sessions);
    return updated;
  }

  function deleteSessions(ids) {
    const doomed = new Set(ids);
    write(
      SESSIONS_KEY,
      listSessions().filter((session) => !doomed.has(session.id))
    );
  }

  function listVisits() {
    const visits = read(VISITS_KEY, []);
    return Array.isArray(visits) ? visits : [];
  }

  function saveVisit(visit) {
    const others = listVisits().filter((v) => v.id !== visit.id);
    write(VISITS_KEY, [...others, visit]);
  }

  function deleteVisit(id) {
    write(
      VISITS_KEY,
      listVisits().filter((v) => v.id !== id)
    );
  }

  function getOpenVisit() {
    return listVisits().find((v) => visitStage(v) !== 'complete') ?? null;
  }

  function readFlags() {
    const flags = read(FLAGS_KEY, {});
    return flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : {};
  }

  function getFlag(name) {
    return readFlags()[name] === true;
  }

  function setFlag(name, value) {
    write(FLAGS_KEY, { ...readFlags(), [name]: Boolean(value) });
  }
```

Replace `clearSessions` with:

```js
  function clearSessions() {
    write(SESSIONS_KEY, []);
    write(VISITS_KEY, []);
  }
```

Replace the return line with:

```js
  return {
    getProfile,
    saveProfile,
    listSessions,
    addSession,
    updateSession,
    deleteSessions,
    clearSessions,
    listVisits,
    saveVisit,
    deleteVisit,
    getOpenVisit,
    getFlag,
    setFlag,
  };
```

Check the existing quota-halving test in `tests/app-store.test.js` still passes — the `dropped` count semantics are unchanged (old sessions removed in total).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass, including every pre-existing app-store test.

- [ ] **Step 5: Commit**

```bash
git add src/app-store.js tests/app-store.test.js
git commit -m "Store: session ids, visits and flags; report which sessions the cap dropped"
```

---

### Task 5: Browser audio plumbing (`audio.js`, `audio-store.js`, `audio-recorder.js`)

**Files:**
- Modify: `webapp/audio.js` (the object returned by `startCapture`)
- Create: `webapp/audio-store.js`
- Create: `webapp/audio-recorder.js`

**Interfaces:**
- Produces:
  - `startCapture(onFrame)` result gains `stream: MediaStream`
  - `putAudio(id: string, blob: Blob): Promise<void>` (rejects on quota)
  - `getAudio(id: string): Promise<Blob | null>`
  - `deleteAudio(ids: string[]): Promise<void>`
  - `clearAudio(): Promise<void>`
  - `askToPersist(): void`
  - `canRecordAudio(): boolean`
  - `startAudioRecording(stream: MediaStream): { stop(): Promise<Blob | null> }`

These touch IndexedDB and MediaRecorder, which Node does not have; they are checked in the browser in Task 7 and on the device in Task 9.

- [ ] **Step 1: Expose the stream**

In `webapp/audio.js`, in the object returned at the end of `startCapture`, add `stream,` as the first property:

```js
  return {
    // The recorder records from this same stream: one microphone, not two.
    stream,
    // A backgrounded tab — ...existing comment...
    isRunning: () => audioContext.state === 'running',
```

- [ ] **Step 2: Create `webapp/audio-store.js`**

```js
// The recordings, kept in IndexedDB — localStorage holds about 5 MB, which is
// a few minutes of audio. Keyed by the session id the recording belongs to.
//
// Stored as bytes + type rather than as a Blob: older Safari could not keep
// Blobs in IndexedDB, and bytes work everywhere.

const DB_NAME = 'fzer0-audio';
const STORE = 'recordings';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

async function run(mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function putAudio(id, blob) {
  const record = { type: blob.type, data: await blob.arrayBuffer() };
  await run('readwrite', (store) => store.put(record, id));
}

export async function getAudio(id) {
  const record = await run('readonly', (store) => store.get(id));
  return record ? new Blob([record.data], { type: record.type }) : null;
}

export async function deleteAudio(ids) {
  if (ids.length === 0) return;
  await run('readwrite', (store) => {
    ids.forEach((id) => store.delete(id));
  });
}

export async function clearAudio() {
  await run('readwrite', (store) => store.clear());
}

// Asks the browser not to clear this site's storage under pressure. Safari may
// say no; the copy in Files is the safe one either way.
export function askToPersist() {
  navigator.storage?.persist?.().catch(() => {});
}
```

- [ ] **Step 3: Create `webapp/audio-recorder.js`**

```js
// Records the microphone to a compressed file while the measurement runs.
// Safari produces audio/mp4 (.m4a), which plays on every phone and computer.

const PREFERRED_TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export function canRecordAudio() {
  return typeof window.MediaRecorder !== 'undefined';
}

export function startAudioRecording(stream) {
  const mimeType = PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported?.(type));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.start();

  const collect = () =>
    chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/mp4' }) : null;

  return {
    // Must be called BEFORE the capture's tracks are stopped — stopping the
    // tracks first can end the recorder without its last chunk.
    stop: () =>
      new Promise((resolve) => {
        if (recorder.state === 'inactive') {
          resolve(collect());
          return;
        }
        recorder.onstop = () => resolve(collect());
        recorder.stop();
      }),
  };
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check webapp/audio-store.js && node --check webapp/audio-recorder.js && node --check webapp/audio.js && npm test`
Expected: no output from the checks; tests all pass.

- [ ] **Step 5: Commit**

```bash
git add webapp/audio.js webapp/audio-store.js webapp/audio-recorder.js
git commit -m "Web app: record the microphone and keep recordings in IndexedDB"
```

---

### Task 6: Sharing (`webapp/share.js`)

**Files:**
- Create: `webapp/share.js`

**Interfaces:**
- Consumes: `getAudio` (Task 5); `audioExtension`, `visitFileNames`, `sessionFileNames` (Task 1); `buildVisitResultsText`, `buildSessionResultsText` (Task 3).
- Produces:
  - `filesForVisit(visit, before, after, allVisits): Promise<{ files: File[], blobs: { before: Blob|null, after: Blob|null }, missingAudio: boolean }>`
  - `filesForSession(session): Promise<{ files: File[], blob: Blob|null, missingAudio: boolean }>`
  - `shareFiles(files: File[], title: string): Promise<'shared' | 'cancelled' | 'downloaded'>`
  - `createShareButtons({ files, title, onShared }): HTMLElement` — a `div.share-actions` with "Save to Files" and "Send by email"

- [ ] **Step 1: Create `webapp/share.js`**

```js
// Hands recordings and results.txt to the iOS share sheet — "Save to Files"
// puts them in a folder, Mail attaches them. A website cannot write into a
// folder by itself; this is the one door iOS leaves open.
import { getAudio } from './audio-store.js';
import { audioExtension, visitFileNames, sessionFileNames } from '../src/share-files.js';
import { buildVisitResultsText, buildSessionResultsText } from '../src/results-text.js';

async function loadAudio(summary) {
  if (!summary?.hasAudio) return null;
  try {
    return await getAudio(summary.id);
  } catch {
    return null;
  }
}

const textFile = (text, name) => new File([text], name, { type: 'text/plain' });
const audioFile = (blob, name) => new File([blob], name, { type: blob.type || 'audio/mp4' });

export async function filesForVisit(visit, before, after, allVisits) {
  const [beforeBlob, afterBlob] = await Promise.all([loadAudio(before), loadAudio(after)]);
  const others = allVisits.filter((v) => v.id !== visit.id).map((v) => v.startedAtMs);
  const names = visitFileNames(visit.startedAtMs, others, {
    beforeExt: audioExtension(beforeBlob?.type),
    afterExt: audioExtension(afterBlob?.type),
  });

  const files = [];
  if (beforeBlob) files.push(audioFile(beforeBlob, names.before));
  if (afterBlob) files.push(audioFile(afterBlob, names.after));
  files.push(textFile(buildVisitResultsText(visit, before, after), names.results));

  return {
    files,
    blobs: { before: beforeBlob, after: afterBlob },
    missingAudio: Boolean((before?.hasAudio && !beforeBlob) || (after?.hasAudio && !afterBlob)),
  };
}

export async function filesForSession(session) {
  const blob = await loadAudio(session);
  const names = sessionFileNames(session.startedAtMs, audioExtension(blob?.type));
  const files = [];
  if (blob) files.push(audioFile(blob, names.audio));
  files.push(textFile(buildSessionResultsText(session), names.results));
  return { files, blob, missingAudio: Boolean(session.hasAudio && !blob) };
}

// Without file sharing (a desktop browser, mostly) each file downloads instead.
export async function shareFiles(files, title) {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }

  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  return 'downloaded';
}

// Both buttons open the same iOS sheet; two labels so it is obvious that both
// jobs are possible. The files are built BEFORE this is shown: iOS refuses to
// open the sheet if the tap is spent waiting on storage first.
export function createShareButtons({ files, title, onShared }) {
  const wrap = document.createElement('div');
  wrap.className = 'share-actions';
  const message = document.createElement('p');
  message.className = 'share-message';
  message.setAttribute('role', 'status');

  [
    ['Save to Files', 'save'],
    ['Send by email', 'email'],
  ].forEach(([label, kind]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wide-button';
    button.dataset.share = kind;
    button.textContent = label;
    button.addEventListener('click', async () => {
      message.textContent = '';
      try {
        const result = await shareFiles(files, title);
        if (result !== 'cancelled') onShared?.();
      } catch {
        message.textContent = 'iPhone did not open the share window. Tap the button again.';
      }
    });
    wrap.appendChild(button);
  });

  wrap.appendChild(message);
  return wrap;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check webapp/share.js && npm test`
Expected: no output from the check; tests all pass.

- [ ] **Step 3: Commit**

```bash
git add webapp/share.js
git commit -m "Web app: build visit and session files and hand them to the share sheet"
```

---

### Task 7: Measure — audio switch, therapy visit flow, result dialog

**Files:**
- Modify: `webapp/index.html` (record bar; new dialog)
- Modify: `webapp/app.css` (append new styles)
- Create: `webapp/visit-result.js`
- Modify: `webapp/measure.js`

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 5, 6.
- Produces: `showVisitResult(dialog: HTMLDialogElement, { store, visit, onShared }): Promise<void>`

- [ ] **Step 1: Markup** — in `webapp/index.html`, inside `<div class="record-bar">`, insert directly **after** the `<p class="record-status" …>…</p>` element and **before** `<div class="record-actions">`:

```html
          <!-- One compact row each, swapped: Measure must fit without
               scrolling, so the visit gets a line, not a panel. -->
          <div class="record-options" data-el="record-options">
            <label class="audio-switch">
              <input type="checkbox" data-field="record-audio" />
              <span data-el="record-audio-label">Also record audio</span>
            </label>
            <button type="button" class="link-button" data-action="start-visit">Start therapy visit</button>
          </div>
          <div class="visit-bar" data-el="visit-bar" hidden>
            <span class="visit-stage" data-el="visit-stage"></span>
            <button type="button" class="link-button danger" data-action="cancel-visit">Cancel visit</button>
          </div>
```

And directly before `</section>` that closes `data-screen="measure"`, add the dialog:

```html
      <dialog class="visit-result" data-el="visit-result">
        <h2>Visit complete</h2>
        <p class="visit-result-change" data-el="visit-result-change"></p>
        <div class="visit-result-figures" data-el="visit-result-figures"></div>
        <div data-el="visit-result-actions"></div>
        <form method="dialog">
          <button class="cta visit-result-done">Done</button>
        </form>
      </dialog>
```

- [ ] **Step 2: Styles** — append to `webapp/app.css` (before the `@media (prefers-reduced-motion…)` block):

```css
/* --- Audio & therapy visits ---------------------------------------------- */

.record-options,
.visit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin: 0 0.25rem 0.5rem;
  font-size: 0.82rem;
}

.audio-switch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ink-2);
}

.audio-switch input {
  accent-color: var(--accent);
  width: 1.1rem;
  height: 1.1rem;
}

.visit-stage {
  font-weight: 650;
  color: var(--accent);
}

.link-button {
  padding: 0.35rem 0;
  font: inherit;
  font-weight: 650;
  color: var(--accent);
  background: none;
  border: 0;
  cursor: pointer;
}

.link-button.danger {
  color: var(--danger);
}

.link-button:disabled {
  color: var(--ink-2);
  cursor: default;
}

.visit-result {
  width: min(28rem, calc(100vw - 2rem));
  border: 0;
  border-radius: var(--radius-card);
  padding: 1.2rem 1rem 1rem;
  background: var(--card);
  color: var(--ink);
}

.visit-result::backdrop {
  background: rgba(0, 0, 0, 0.35);
}

.visit-result h2 {
  margin: 0 0 0.3rem;
  font-size: 1.1rem;
}

.visit-result-change {
  margin: 0 0 0.8rem;
  font-weight: 650;
  color: var(--accent);
}

.visit-result-figures {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 0.25rem 0.9rem;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}

.visit-result-figures .head {
  color: var(--ink-2);
  font-size: 0.75rem;
}

.visit-result-done {
  margin-top: 0.9rem;
}

.share-message {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--danger);
}

.share-message:empty {
  display: none;
}
```

- [ ] **Step 3: Create `webapp/visit-result.js`**

```js
// "Visit complete": Before vs After, the change, and the two ways to keep it.
import { hzToNote } from '../src/note-hz.js';
import { compareVisit, describeChange } from '../src/visit.js';
import { filesForVisit, createShareButtons } from './share.js';

const pitch = (s) => (s?.meanHz ? `${hzToNote(s.meanHz)} · ${Math.round(s.meanHz)} Hz` : '—');
const percent = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

export async function showVisitResult(dialog, { store, visit, onShared }) {
  const sessions = store.listSessions();
  const before = sessions.find((s) => s.id === visit.beforeId) ?? null;
  const after = sessions.find((s) => s.id === visit.afterId) ?? null;

  dialog.querySelector('[data-el="visit-result-change"]').textContent =
    `Change: ${describeChange(compareVisit(before, after))}`;

  dialog.querySelector('[data-el="visit-result-figures"]').innerHTML = `
    <span></span><span class="head">Before</span><span class="head">After</span>
    <span>Average</span><b>${pitch(before)}</b><b>${pitch(after)}</b>
    <span>In range</span><b>${percent(before?.inZoneShare)}</b><b>${percent(after?.inZoneShare)}</b>
  `;

  const actions = dialog.querySelector('[data-el="visit-result-actions"]');
  actions.textContent = 'Preparing files…';
  dialog.showModal();

  const { files } = await filesForVisit(visit, before, after, store.listVisits());
  actions.replaceChildren(
    createShareButtons({
      files,
      title: 'FZER0 therapy visit',
      onShared: () => {
        const latest = store.listVisits().find((v) => v.id === visit.id);
        if (latest) store.saveVisit({ ...latest, shared: true });
        onShared?.();
      },
    })
  );
}
```

- [ ] **Step 4: Wire `webapp/measure.js`**

4a. Add imports below the existing ones:

```js
import { makeId } from '../src/app-store.js';
import { createVisit, visitStage, markRecording, markRecorded, clearRecording } from '../src/visit.js';
import { canRecordAudio, startAudioRecording } from './audio-recorder.js';
import { putAudio, deleteAudio, askToPersist } from './audio-store.js';
import { showVisitResult } from './visit-result.js';
```

4b. After the existing `micBlockedStepsEl` query, add:

```js
  const recordOptionsEl = root.querySelector('[data-el="record-options"]');
  const audioSwitch = root.querySelector('[data-field="record-audio"]');
  const audioSwitchLabel = root.querySelector('[data-el="record-audio-label"]');
  const startVisitButton = root.querySelector('[data-action="start-visit"]');
  const visitBarEl = root.querySelector('[data-el="visit-bar"]');
  const visitStageEl = root.querySelector('[data-el="visit-stage"]');
  const cancelVisitButton = root.querySelector('[data-action="cancel-visit"]');
  const visitResultDialog = root.querySelector('[data-el="visit-result"]');
```

4c. In the `// --- state ---` block, add:

```js
  let audioRecording = null;
  // What the current recording is for, fixed at Start: which visit (if any)
  // and whether audio is being kept.
  let recordingPlan = null;
```

4d. Add these functions just above `// --- recording ---`:

```js
  // --- therapy visits -------------------------------------------------------
  const stageName = (visit) => (visitStage(visit) === 'before' ? 'Before' : 'After');

  // The record button and the one row above it describe what the NEXT tap
  // does. While recording they are left alone — the button says Stop.
  function renderVisitControls() {
    const visit = store.getOpenVisit();
    const recording = capture !== null;

    recordOptionsEl.hidden = Boolean(visit) || recording;
    visitBarEl.hidden = !visit;
    cancelVisitButton.hidden = recording;

    if (visit) {
      visitStageEl.textContent = `Therapy visit · ${visitStage(visit) === 'before' ? '1' : '2'} of 2: ${stageName(visit)}`;
    }
    if (!recording) recordButton.textContent = visit ? `Record ${stageName(visit)}` : 'Start measuring';
  }

  if (!canRecordAudio()) {
    audioSwitch.disabled = true;
    audioSwitchLabel.textContent = "This browser can't record audio";
    startVisitButton.disabled = true;
  }

  audioSwitch.checked = canRecordAudio() && store.getFlag('recordAudio');
  audioSwitch.addEventListener('change', () => store.setFlag('recordAudio', audioSwitch.checked));

  startVisitButton.addEventListener('click', () => {
    if (capture || store.getOpenVisit()) return;
    store.saveVisit(createVisit(makeId(), Date.now()));
    renderVisitControls();
    setStatus('Record Before now. Then do your therapy session and come back for After.');
  });

  cancelVisitButton.addEventListener('click', () => {
    const visit = store.getOpenVisit();
    if (!visit || capture) return;
    if (!window.confirm('Cancel this visit? Its recordings will be deleted.')) return;

    const ids = [visit.beforeId, visit.afterId].filter(Boolean);
    store.deleteSessions(ids);
    store.deleteVisit(visit.id);
    deleteAudio(ids).catch(() => {});
    onSessionSaved();
    renderVisitControls();
    setStatus('Visit cancelled.');
  });
```

4e. In `start()`, directly after `hideMicHelp();`, add:

```js
    const visit = store.getOpenVisit();
    recordingPlan = {
      visitId: visit?.id ?? null,
      withAudio: canRecordAudio() && (visit ? true : audioSwitch.checked),
    };
    if (visit) store.saveVisit(markRecording(visit));

    let audioFailed = false;
    audioRecording = null;
    if (recordingPlan.withAudio) {
      try {
        audioRecording = startAudioRecording(capture.stream);
      } catch {
        audioFailed = true;
      }
    }
```

and replace the last line of `start()`:

```js
    setStatus('Measuring. You can switch to your call — leave this tab open.');
```

with:

```js
    renderVisitControls();
    setStatus(
      audioFailed
        ? 'Measuring — but audio could not be recorded, so only the numbers will be saved.'
        : 'Measuring. You can switch to your call — leave this tab open.'
    );
```

4f. In `stop()`, directly after `await releaseWakeLock();` and **before** `await capture?.stop();`, add:

```js
    // The recorder first: stopping the microphone first can lose its last chunk.
    const audioBlob = audioRecording ? await audioRecording.stop().catch(() => null) : null;
    audioRecording = null;
    const plan = recordingPlan;
    recordingPlan = null;
```

4g. In `stop()`, replace:

```js
    recordButton.textContent = 'Start measuring';
    delete recordButton.dataset.recording;
```

with:

```js
    delete recordButton.dataset.recording;
```

4h. In `stop()`, replace everything from `if (!summary) {` to the end of the function with:

```js
    const visit = plan?.visitId ? store.listVisits().find((v) => v.id === plan.visitId) ?? null : null;

    if (!summary) {
      if (visit) store.saveVisit(clearRecording(visit));
      renderVisitControls();
      setStatus('Nothing was recorded.');
      return;
    }

    const id = makeId();
    let hasAudio = false;
    let audioNote = '';
    if (audioBlob) {
      try {
        await putAudio(id, audioBlob);
        hasAudio = true;
        askToPersist();
      } catch {
        audioNote = " Audio couldn't be saved — phone storage may be full.";
      }
    }

    const role = visit ? visitStage(visit) : null;
    const { dropped, droppedIds } = store.addSession({
      ...summary,
      id,
      hasAudio,
      shared: false,
      visitId: visit?.id ?? null,
      visitRole: role,
    });
    if (droppedIds.length > 0) deleteAudio(droppedIds).catch(() => {});

    let finishedVisit = null;
    if (visit) {
      finishedVisit = markRecorded(visit, id);
      store.saveVisit(finishedVisit);
    }

    onSessionSaved();
    renderVisitControls();

    let message;
    if (role === 'before') message = 'Before saved. Do your therapy session, then come back and record After.';
    else if (role === 'after') message = 'Visit complete.';
    else if (dropped > 0)
      message = `Saved to History. The ${dropped} oldest session${dropped > 1 ? 's were' : ' was'} removed to make room.`;
    else message = `Saved to History — ${formatElapsed(summary.durationMs)} measured.`;

    // Once: on iPhone a Home Screen app is exempt from Safari clearing site
    // data after seven days unused.
    let tip = '';
    if (hasAudio && !window.navigator.standalone && !store.getFlag('homeScreenTipShown')) {
      store.setFlag('homeScreenTipShown', true);
      tip = ' Tip: Share › Add to Home Screen keeps recordings safer on this iPhone.';
    }

    setStatus(message + audioNote + tip);

    if (role === 'after') {
      showVisitResult(visitResultDialog, { store, visit: finishedVisit, onShared: onSessionSaved });
    }
```

4i. Just above the final `return { isRecording… }` of `createMeasureScreen`, after `clearReadouts();`, add:

```js
  // A visit still marked as recording means the app was closed mid-take.
  const openVisit = store.getOpenVisit();
  if (openVisit?.recording) {
    store.saveVisit(clearRecording(openVisit));
    setStatus(`The last recording was interrupted. Tap Record ${stageName(openVisit)} to record it again.`);
  } else if (openVisit) {
    setStatus(`Therapy visit in progress — tap Record ${stageName(openVisit)} when you are ready.`);
  }
  renderVisitControls();
```

- [ ] **Step 5: Check it in a real browser** (desktop Chrome with a fake microphone)

Run the server: `python3 -m http.server 8123` (from the repo root), then drive `http://localhost:8123/webapp/` with Playwright's Chromium using `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. With a target note set in Profile (Profile → set range and target), verify:
1. Measure shows "Also record audio" and "Start therapy visit"; page does not scroll at 390×844.
2. Switch on → Start measuring → wait 3 s → Stop and save → status says "Saved to History…". In devtools: `indexedDB` database `fzer0-audio` has one record; `localStorage['fzer0.sessions']` last entry has `hasAudio: true`.
3. Start therapy visit → row reads "Therapy visit · 1 of 2: Before", button "Record Before" → record 3 s → stop → "Before saved…", row reads "2 of 2: After" → reload the page → still at After → Record After → stop → dialog "Visit complete" with change line and two share buttons (desktop: clicking downloads 3 files).
4. Start a visit, start recording Before, reload mid-recording → status "The last recording was interrupted. Tap Record Before…".
5. Cancel visit → confirm → visit row gone, sessions removed.

Fix anything that fails before committing. Run `npm test` — all pass.

- [ ] **Step 6: Commit**

```bash
git add webapp/index.html webapp/app.css webapp/visit-result.js webapp/measure.js
git commit -m "Measure: record audio with a session, and run a Before/After therapy visit"
```

---

### Task 8: History — visit cards, playback, sharing, "Not saved yet"

**Files:**
- Modify: `webapp/history.js`
- Modify: `webapp/app.css` (session card styles)

**Interfaces:**
- Consumes: `historyItems`, `compareVisit`, `describeChange` (Task 2); `filesForVisit`, `filesForSession`, `createShareButtons` (Task 6); store `updateSession`, `saveVisit`, `listVisits` (Task 4).

The current session card is a single `<button>` containing the details. Audio players and share buttons cannot live inside a button, so each card becomes a `div.session` holding a toggle `button.session-toggle` and a sibling `div.session-detail`.

- [ ] **Step 1: CSS** — in `webapp/app.css`:

Replace the `.session { … }` rule with:

```css
.session {
  background: var(--card);
  border-radius: 1rem;
  padding: 0.8rem 0.9rem;
  margin-bottom: 0.6rem;
}

.session-toggle {
  display: block;
  width: 100%;
  padding: 0;
  text-align: left;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
```

Replace `.session[aria-expanded='true'] .session-chevron` with `.session-toggle[aria-expanded='true'] .session-chevron`.

Replace the `.session-detail { … }` rule with:

```css
.session-detail {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--line);
}

.figures {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.25rem 0.9rem;
  margin: 0;
  font-size: 0.8rem;
}
```

Replace `.session-detail dt` with `.figures dt` and `.session-detail dd` with `.figures dd`.

Append (before the reduced-motion block):

```css
.detail-heading {
  margin: 0.7rem 0 0.35rem;
  font-size: 0.8rem;
  font-weight: 700;
}

.detail-heading:first-child {
  margin-top: 0;
}

.audio-row {
  margin: 0.6rem 0 0;
}

.audio-row audio {
  display: block;
  width: 100%;
  height: 2.2rem;
}

.audio-missing,
.audio-loading {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: var(--ink-2);
}

.unsaved {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--warm);
  white-space: nowrap;
}
```

- [ ] **Step 2: Rewrite the card code in `webapp/history.js`**

2a. Update the imports at the top:

```js
import { hzToNote, noteToHz } from '../src/note-hz.js';
import { summariseTrend, MIN_SESSIONS_FOR_TREND } from '../src/trend.js';
import { buildSessionsCsv } from '../src/session-csv.js';
import { historyItems, compareVisit, describeChange } from '../src/visit.js';
import { filesForVisit, filesForSession, createShareButtons } from './share.js';
```

2b. Replace the whole `function sessionCard(summary) { … }` with:

```js
// Object URLs for the players on screen; released on every re-render.
let liveAudioUrls = [];

function releaseAudioUrls() {
  liveAudioUrls.forEach((url) => URL.revokeObjectURL(url));
  liveAudioUrls = [];
}

// The full figures are the ones a speech therapist would want; they are one
// tap down so the list stays readable.
function figuresList(summary) {
  const dl = document.createElement('dl');
  dl.className = 'figures';
  dl.innerHTML = `
    <dt>Average pitch</dt><dd>${note(summary.meanHz)} · ${hz(summary.meanHz)}</dd>
    <dt>Pitch spread</dt><dd>${summary.semitoneSd === null ? '—' : `${summary.semitoneSd.toFixed(1)} semitones`}</dd>
    <dt>Range (5–95%)</dt><dd>${note(summary.p5Hz)} – ${note(summary.p95Hz)}</dd>
    <dt>Time in ${rangeLabel(summary)}</dt><dd>${percent(summary.inZoneShare)}</dd>
    <dt>Time speaking</dt><dd>${formatDuration(summary.voicedMs)}</dd>
    <dt>Average volume</dt><dd>${summary.meanDb === null ? '—' : `${Math.round(summary.meanDb)} dB`}</dd>
    <dt>Loudest</dt><dd>${summary.maxDb === null ? '—' : `${Math.round(summary.maxDb)} dB`}</dd>
    <dt>Target then</dt><dd>${summary.targetNote ?? '—'}</dd>
  `;
  return dl;
}

function audioPlayer(label, blob) {
  const url = URL.createObjectURL(blob);
  liveAudioUrls.push(url);
  const figure = document.createElement('figure');
  figure.className = 'audio-row';
  figure.innerHTML = `<figcaption class="detail-heading">${label}</figcaption>`;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = url;
  figure.appendChild(audio);
  return figure;
}

function paragraph(className, text) {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

const unsavedBadge = (show) => (show ? '<span class="unsaved">Not saved yet</span>' : '');

// A card that opens on tap. `fill` runs once, on first open — that is when the
// audio is read from storage and the files are prepared, so the share buttons
// work on the first tap.
function expandableCard(headHtml, fill) {
  const card = document.createElement('div');
  card.className = 'session';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'session-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = headHtml;

  const detail = document.createElement('div');
  detail.className = 'session-detail';
  detail.hidden = true;

  let filled = false;
  toggle.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    toggle.setAttribute('aria-expanded', String(!detail.hidden));
    if (!detail.hidden && !filled) {
      filled = true;
      fill(detail, card);
    }
  });

  card.append(toggle, detail);
  return card;
}

async function addAudioAndSharing(detail, card, { load, players, title, onShared }) {
  const loading = paragraph('audio-loading', 'Loading audio…');
  detail.appendChild(loading);
  const prepared = await load();
  loading.remove();

  players(prepared).forEach(([label, blob]) => {
    if (blob) detail.appendChild(audioPlayer(label, blob));
  });
  if (prepared.missingAudio) {
    detail.appendChild(paragraph('audio-missing', 'Audio no longer in the app — check your Files folder.'));
  }
  detail.appendChild(
    createShareButtons({
      files: prepared.files,
      title,
      onShared: () => {
        onShared();
        card.querySelector('.unsaved')?.remove();
      },
    })
  );
}

function sessionCard(summary, store) {
  const head = `
    <div class="session-head">
      <span class="session-date">${formatDate(summary.startedAtMs)}</span>
      <span class="session-head-right">
        ${unsavedBadge(summary.hasAudio && !summary.shared)}
        <span class="session-duration">${formatDuration(summary.durationMs)}</span>
        <span class="session-chevron" aria-hidden="true">›</span>
      </span>
    </div>
    <div class="session-figures">
      <span>Average <b>${note(summary.meanHz)}</b></span>
      <span>In ${rangeLabel(summary)} <b>${percent(summary.inZoneShare)}</b></span>
      <span>Spoke <b>${percent(summary.voicedShare)}</b></span>
    </div>
  `;

  return expandableCard(head, (detail, card) => {
    detail.appendChild(figuresList(summary));
    // Old sessions have no id and no audio: figures only, as before.
    if (!summary.id) return;
    addAudioAndSharing(detail, card, {
      load: () => filesForSession(summary),
      players: ({ blob }) => [['Recording', blob]],
      title: 'FZER0 session',
      onShared: () => store.updateSession(summary.id, { shared: true }),
    });
  });
}

function visitCard({ visit, before, after }, store) {
  const hasAudio = Boolean(before?.hasAudio || after?.hasAudio);
  const side = (summary) =>
    summary ? `<b>${note(summary.meanHz)}</b> · ${hz(summary.meanHz)}` : 'not recorded yet';

  const head = `
    <div class="session-head">
      <span class="session-date">Therapy visit · ${formatDate(visit.startedAtMs)}</span>
      <span class="session-head-right">
        ${unsavedBadge(hasAudio && !visit.shared)}
        <span class="session-chevron" aria-hidden="true">›</span>
      </span>
    </div>
    <div class="session-figures">
      <span>Before ${side(before)}</span>
      <span>After ${side(after)}</span>
      <span>Change <b>${describeChange(compareVisit(before, after))}</b></span>
    </div>
  `;

  return expandableCard(head, (detail, card) => {
    [
      ['Before', before],
      ['After', after],
    ].forEach(([label, summary]) => {
      if (!summary) return;
      detail.appendChild(paragraph('detail-heading', label));
      detail.appendChild(figuresList(summary));
    });

    addAudioAndSharing(detail, card, {
      load: () => filesForVisit(visit, before, after, store.listVisits()),
      players: ({ blobs }) => [
        ['Before', blobs.before],
        ['After', blobs.after],
      ],
      title: 'FZER0 therapy visit',
      onShared: () => {
        const latest = store.listVisits().find((v) => v.id === visit.id);
        if (latest) store.saveVisit({ ...latest, shared: true });
      },
    });
  });
}
```

2c. In `render()`, replace:

```js
      listEl.replaceChildren();
```

with:

```js
      releaseAudioUrls();
      listEl.replaceChildren();
```

and replace:

```js
      // Newest first — the reverse of how they are stored.
      [...sessions].reverse().forEach((summary) => listEl.appendChild(sessionCard(summary)));
```

with:

```js
      // Newest first, with each visit's Before and After as one card.
      historyItems(sessions, store.listVisits()).forEach((item) =>
        listEl.appendChild(item.kind === 'visit' ? visitCard(item, store) : sessionCard(item.session, store))
      );
```

- [ ] **Step 3: Check it in a real browser** (same Playwright setup as Task 7, Step 5)

With the visit and the audio session from Task 7 recorded:
1. History shows a "Therapy visit · …" card (Before / After / Change) and a plain session card; both show "Not saved yet".
2. Opening the visit card shows Before and After figures, two audio players that play, and the two share buttons. Clicking "Save to Files" on desktop downloads `… visit - before.webm`, `… - after.webm`, `… - results.txt` (desktop Chromium records webm; iPhone gives m4a); "Not saved yet" disappears and stays gone after reload.
3. An old-style session (inject `{startedAtMs: …, durationMs: 60000, meanHz: 100, …}` without `id` into `fzer0.sessions`) still renders and opens with figures only.
4. Delete the IndexedDB record for one session in devtools, reload, open its card → "Audio no longer in the app — check your Files folder." and the share buttons still offer results.txt.
5. CSV export still downloads.

`npm test` — all pass.

- [ ] **Step 4: Commit**

```bash
git add webapp/history.js webapp/app.css
git commit -m "History: visit cards, playback, Save to Files / email, Not saved yet"
```

---

### Task 9: Delete-all, README, on-device checklist

**Files:**
- Modify: `webapp/profile.js` (the `clearButton` handler)
- Modify: `README.md` (privacy paragraph)
- Create: `tests/manual/audio-visits-checklist.md`

- [ ] **Step 1: Delete-all also deletes audio** — in `webapp/profile.js`, add the import:

```js
import { clearAudio } from './audio-store.js';
```

and replace the body of the `clearButton` click handler with:

```js
    const count = store.listSessions().length;
    if (count === 0) return;

    // Naming the number is the difference between a reflex "OK" and a decision.
    const confirmed = window.confirm(
      `Delete all ${count} session${count === 1 ? '' : 's'}, including therapy visits and recordings? ` +
        'This cannot be undone — save them to Files or export them from History first if you want to keep them.'
    );
    if (!confirmed) return;

    store.clearSessions();
    clearAudio().catch(() => {});
    onProfileChanged();
```

- [ ] **Step 2: README** — in `README.md`, replace the second paragraph ("Everything is measured inside the page. Nothing is recorded, …") with:

```markdown
Everything is measured inside the page, and there are no network calls
anywhere in the code. The extension records nothing. The web app can record
your voice if you ask it to — for a therapy visit, or with "Also record
audio" — and keeps the recording on your device until you save it to Files
or send it yourself. The extension's only permission is `storage`.
```

- [ ] **Step 3: On-device checklist** — create `tests/manual/audio-visits-checklist.md`:

```markdown
# Audio & therapy visits — iPhone / iPad checklist

Run on the live URL (HTTPS) in Safari, then again from the Home Screen app.

- [ ] Measure: switch on "Also record audio", record 20 s, stop. History card shows "Not saved yet"; open it; the recording plays through the speaker.
- [ ] Switch off: record 10 s. Card has figures only, no player, no badge.
- [ ] Start therapy visit → Record Before (30 s) → Stop → "Before saved…".
- [ ] Close Safari completely, reopen FZER0 → "Therapy visit in progress — tap Record After".
- [ ] Record After → Stop → "Visit complete" dialog shows the change.
- [ ] Save to Files → share sheet opens on the FIRST tap → Save to Files → pick/create folder "FZER0" → three files: `… visit - before.m4a`, `… visit - after.m4a`, `… visit - results.txt`. Open each in Files: audio plays, text is a readable table.
- [ ] Send by email → Mail opens with the three attachments.
- [ ] "Not saved yet" is gone on the visit card after saving.
- [ ] Second visit the same day → file names include the time.
- [ ] Start a visit, start recording Before, close Safari mid-recording, reopen → "The last recording was interrupted…" → record again works.
- [ ] Cancel visit (in the After step) → confirm → visit and its Before disappear from History.
- [ ] Profile → Delete all sessions → warning mentions recordings → History empty.
- [ ] Old sessions recorded before this update still show in History and in the CSV.
- [ ] Recordings show the right length and can be scrubbed, in History and in Files.
- [ ] Measure screen does not scroll on iPhone (portrait).
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: all pass. In the browser (Task 7 setup): Profile → Delete all sessions → confirm → IndexedDB `fzer0-audio` store is empty, History is empty.

- [ ] **Step 5: Commit**

```bash
git add webapp/profile.js README.md tests/manual/audio-visits-checklist.md
git commit -m "Delete-all removes recordings too; README and on-device checklist"
```

---

## Not in this plan (by spec)

Meet extension changes · attaching recordings from other apps · Zip · automatic folder saving · editing/trimming recordings.
