# FNDMNTL Extension Shell + Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome extension's install-time onboarding flow (disclaimer → instructions → "do you know your tone?" fork → range/target setup) and the local settings storage it saves to, matching the PDF flow exactly.

**Architecture:** A single `onboarding.html` extension page, opened automatically on install via `chrome.runtime.onInstalled`, with a small vanilla-JS screen-switcher (plain `hidden` attribute toggling, no framework). Settings are persisted through a dependency-injectable `prefs.js` module so its logic is Node-testable even though `chrome.storage` itself only exists inside a real extension. This plan assumes the detection-engine plan (`2026-08-14-fndmntl-detection-engine.md`) is already implemented — the setup screen imports `notesInRange`/`RANGE_BAND_NOTES` from `src/note-hz.js` directly.

**Tech Stack:** Manifest V3, vanilla JS (ES modules for the page script), `chrome.storage.local`, Node's built-in test runner for the storage-logic parts that don't touch `chrome.*` directly.

## Global Constraints

- **Hard stop on "No."** If the user says they don't know their fundamental tone, onboarding ends at a disclaimer pointing them to a speech pathologist — no fallback, no estimate, ever.
- **Setup persists, nothing else does.** `chrome.storage.local` holds only `rangeLowNote`, `rangeHighNote`, `targetNote` (and, once Plan 3 extends it, `referenceToneNote`). No session/voice data is ever written here or anywhere else.
- **Range picker bounded to F2–C3.** Use `RANGE_BAND_NOTES`/`notesInRange` from `src/note-hz.js` — never hardcode a separate note list.
- **"Not a medical device" disclaimer copy must appear verbatim** on the no-tone screen and the mic-access disclaimer copy verbatim on the first screen (both quoted from the approved design spec).
- **No `MediaRecorder`, no network call, anywhere** in this extension.

---

### Task 1: Manifest, background service worker, and onboarding page shell

**Files:**
- Create: `manifest.json`
- Create: `extension/background.js`
- Create: `extension/onboarding/onboarding.html`
- Create: `extension/onboarding/onboarding.css`
- Create: `extension/onboarding/onboarding.js`

**Interfaces:**
- Produces: an installed extension that opens `extension/onboarding/onboarding.html` automatically, showing a disclaimer screen with Accept/Decline, wired all the way through to the "instructions" screen on Accept.

This task has no automated test — `chrome.runtime.onInstalled` and `chrome.tabs.create` don't exist outside a real browser, so verification here is manual, same as the reference project's own approach to browser-only glue. Later tasks in this plan add Node-tested logic (`src/prefs.js`) on top of this shell.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "FNDMNTL",
  "version": "0.0.1",
  "description": "Measures your voice's fundamental frequency and volume during Google Meet calls.",
  "permissions": ["storage"],
  "background": {
    "service_worker": "extension/background.js"
  },
  "action": {
    "default_title": "FNDMNTL"
  },
  "options_page": "extension/onboarding/onboarding.html"
}
```

(`options_page` was added during this plan's final whole-branch review fix round, not in the original Task 1. Without it, closing the onboarding tab mid-flow — or simply finishing onboarding and wanting to redo it later — leaves the flow unreachable without reinstalling the extension: there's no `default_popup` and no `chrome.action.onClicked` listener. `options_page` gives users a way back in via chrome://extensions → Details → Extension options (and often a right-click on the toolbar icon). Reaching onboarding this way always restarts at the disclaimer screen — there is no prefill from previously-saved setup; that's intentionally left to the in-call-panel plan, not this one.)

- [ ] **Step 2: Create `extension/background.js`**

```js
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('extension/onboarding/onboarding.html') });
  }
});
```

- [ ] **Step 3: Create `extension/onboarding/onboarding.html`**

All screens are written up front as hidden `<section>`s; only the disclaimer is shown initially. Later tasks add behavior to the sections that already exist here.

(Correction from this plan's final whole-branch review fix round: "nothing about this markup changes" turned out not to hold. Every `<h1>` below gained `tabindex="-1"` so `showScreen()` — Task 1 Step 5, revised further down — can move focus to it after a screen transition; headings aren't focusable by default, and leaving screen-reader/keyboard users focused on a hidden, removed-from-view element after every transition was a real accessibility gap the review caught. This is the final, accurate markup.)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>FNDMNTL setup</title>
  <link rel="stylesheet" href="onboarding.css" />
</head>
<body>
  <main>
    <section data-screen="disclaimer">
      <h1 tabindex="-1">FNDMNTL</h1>
      <p>
        This plugin needs you to accept the use of the microphone.
        We are not recording or keeping any information about you or
        your conversations.
      </p>
      <button data-action="accept-mic">Accept the rights to access the microphone</button>
      <button data-action="decline-mic">Decline the rights to access the microphone</button>
    </section>

    <section data-screen="declined" hidden>
      <h1 tabindex="-1">FNDMNTL can't run without the microphone</h1>
      <p>
        This extension has no purpose without microphone access. To remove
        it, go to <code>chrome://extensions</code>, find FNDMNTL, and click
        Remove.
      </p>
    </section>

    <section data-screen="instructions" hidden>
      <h1 tabindex="-1">Before you join a call</h1>
      <ul>
        <li>Headset mandatory</li>
        <li>Measures volume</li>
      </ul>
      <p>Do you know your fundamental tone?</p>
      <button data-action="know-tone-yes">Yes</button>
      <button data-action="know-tone-no">No</button>
    </section>

    <section data-screen="no-tone" hidden>
      <h1 tabindex="-1">Find your fundamental tone first</h1>
      <p>
        This is not a medical device. If you have doubts, go to your speech
        pathologist to find out your fundamental tone to start using
        FNDMNTL.
      </p>
    </section>

    <section data-screen="setup" hidden>
      <h1 tabindex="-1">Set your range and target</h1>
      <form data-form="setup">
        <label>
          Lowest note in your range
          <select data-field="rangeLowNote" required></select>
        </label>
        <label>
          Highest note in your range
          <select data-field="rangeHighNote" required></select>
        </label>
        <label>
          Your target note
          <select data-field="targetNote" required></select>
        </label>
        <button type="submit">Save and finish setup</button>
      </form>
    </section>

    <section data-screen="done" hidden>
      <h1 tabindex="-1">You're set up</h1>
      <p>Join any Google Meet call — the panel will appear on its own.</p>
    </section>
  </main>
  <script type="module" src="onboarding.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `extension/onboarding/onboarding.css`**

```css
body {
  font-family: system-ui, sans-serif;
  max-width: 32rem;
  margin: 3rem auto;
  padding: 0 1rem;
  line-height: 1.5;
}

button {
  display: block;
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.75rem;
  font-size: 1rem;
}

section[hidden] {
  display: none;
}

label {
  display: block;
  margin-top: 1rem;
}

select {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.5rem;
}
```

- [ ] **Step 5: Create `extension/onboarding/onboarding.js`** (disclaimer + decline/accept only — the "Yes"/"No" buttons on the instructions screen are inert until Task 2)

```js
function showScreen(name) {
  document.querySelectorAll('[data-screen]').forEach((section) => {
    section.hidden = section.dataset.screen !== name;
  });
}

document.querySelector('[data-action="decline-mic"]').addEventListener('click', () => {
  showScreen('declined');
});

document.querySelector('[data-action="accept-mic"]').addEventListener('click', () => {
  showScreen('instructions');
});
```

**Correction from this plan's final whole-branch review fix round:** `showScreen` above is the ORIGINAL Task 1 version. The final, actual `showScreen` (in the real file today) also moves focus into the newly-shown screen, so screen-reader/keyboard users aren't left focused on a hidden element after every transition — toggling `hidden` first, then focusing (a hidden element can't take focus), landing on the screen's `<h1>` (via the `tabindex="-1"` added to Step 3's markup) or a button if no heading is found:

```js
function showScreen(name) {
  document.querySelectorAll('[data-screen]').forEach((section) => {
    section.hidden = section.dataset.screen !== name;
  });
  document
    .querySelector(`[data-screen="${name}"] h1, [data-screen="${name}"] button`)
    ?.focus();
}
```

This is additive to `showScreen`'s existing behavior (the `hidden`-toggling loop is unchanged) and doesn't affect any of Tasks 2/4's calls to `showScreen(name)` — they all still work exactly as written, they now just also move focus.

- [ ] **Step 6: Manual verification**

1. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, select the `fndmntl` project folder.
2. Confirm a new tab opens automatically showing the disclaimer screen.
3. Click **Decline** → confirm the "can't run without the microphone" screen shows.
4. Reload the extension (chrome://extensions → reload icon), reopen the onboarding tab manually by clicking the extension's puzzle-piece entry if needed, click **Accept** → confirm the instructions screen shows with inert Yes/No buttons.

Expected: all four checks pass. If the tab doesn't auto-open, check `chrome://extensions` for a red "Errors" button on the FNDMNTL card and read the message before proceeding.

- [ ] **Step 7: Commit**

```bash
git add manifest.json extension/background.js extension/onboarding/onboarding.html extension/onboarding/onboarding.css extension/onboarding/onboarding.js
git commit -m "Add extension shell and onboarding disclaimer screen"
```

---

### Task 2: "Do you know your tone?" fork

**Files:**
- Modify: `extension/onboarding/onboarding.js`

**Interfaces:**
- Consumes: `showScreen(name)` defined in Task 1
- Produces: clicking "No" shows the `no-tone` hard-stop screen; clicking "Yes" shows the `setup` screen (still empty/unwired until Task 4)

- [ ] **Step 1: Add the fork handlers to `extension/onboarding/onboarding.js`**

```js
document.querySelector('[data-action="know-tone-no"]').addEventListener('click', () => {
  showScreen('no-tone');
});

document.querySelector('[data-action="know-tone-yes"]').addEventListener('click', () => {
  showScreen('setup');
});
```

- [ ] **Step 2: Manual verification**

1. Reload the unpacked extension in `chrome://extensions`.
2. Reopen onboarding, click through Accept → instructions.
3. Click **No** → confirm the "not a medical device" hard-stop screen shows, with no way to reach setup from there.
4. Reopen onboarding again, Accept → instructions → click **Yes** → confirm the (empty) setup screen shows with three blank selects and a submit button that does nothing yet.

Expected: both paths show the correct screen; the setup form's selects are empty until Task 4.

- [ ] **Step 3: Commit**

```bash
git add extension/onboarding/onboarding.js
git commit -m "Add do-you-know-your-tone fork with hard stop on No"
```

---

### Task 3: Preferences storage module

**Files:**
- Create: `src/prefs.js`
- Test: `tests/prefs.test.js`

**Interfaces:**
- Produces: `createPrefsStore(storage?): { getSetup(): Promise<{rangeLowNote, rangeHighNote, targetNote}>, saveSetup({rangeLowNote, rangeHighNote, targetNote}): Promise<void> }`

`storage` defaults to `chrome.storage.local` when running inside the extension, but the function accepts an injected fake for Node tests — this is what makes settings-persistence logic testable without a browser.

- [ ] **Step 1: Write the failing test**

```js
// tests/prefs.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefsStore } from '../src/prefs.js';

function createFakeStorage() {
  const data = {};
  return {
    get(keys, callback) {
      const result = {};
      for (const key of keys) {
        if (key in data) result[key] = data[key];
      }
      callback(result);
    },
    set(values, callback) {
      Object.assign(data, values);
      callback();
    },
  };
}

test('getSetup returns nulls when nothing has been saved', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  const setup = await prefs.getSetup();
  assert.deepEqual(setup, { rangeLowNote: null, rangeHighNote: null, targetNote: null });
});

test('saveSetup then getSetup round-trips the saved values', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' });
  const setup = await prefs.getSetup();
  assert.deepEqual(setup, { rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' });
});

test('createPrefsStore throws when no storage backend is available', () => {
  assert.throws(() => createPrefsStore(null));
});
```

**Correction from this plan's final whole-branch review fix round:** the test block above is the ORIGINAL Task 3 version. The review found that `saveSetup` never checked for a storage failure — real `chrome.storage.local` calls don't reject on failure, they resolve the callback and surface errors only via `chrome.runtime.lastError` read inside it, so a quota-exceeded or invalidated-context failure was silently treated as success. The final, actual `tests/prefs.test.js` adds this test on top of the three above (all three are unchanged):

```js
test('saveSetup rejects when chrome.runtime.lastError is set inside the storage.set callback', async () => {
  const storage = {
    get(keys, callback) {
      callback({});
    },
    set(values, callback) {
      callback();
    },
  };
  globalThis.chrome = { runtime: { lastError: { message: 'QUOTA_BYTES_PER_ITEM exceeded' } } };
  try {
    const prefs = createPrefsStore(storage);
    await assert.rejects(
      () => prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' }),
      /QUOTA_BYTES_PER_ITEM exceeded/
    );
  } finally {
    delete globalThis.chrome;
  }
});
```

The `globalThis.chrome` set/delete-in-`finally` pattern matters: this fake storage's `set()` callback doesn't carry the error itself (real `chrome.storage.local` doesn't either) — the error is read from the ambient `chrome.runtime.lastError`, so the test sets it globally before calling `saveSetup` and always cleans it up afterward so it can't leak into other tests in the same process (e.g. the round-trip test above, which would otherwise start rejecting too).

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/prefs.js'`

- [ ] **Step 3: Implement `src/prefs.js`**

```js
const DEFAULT_STORAGE =
  typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : undefined;

export function createPrefsStore(storage = DEFAULT_STORAGE) {
  if (!storage) {
    throw new Error('No storage backend available; pass one explicitly for tests.');
  }

  function getSetup() {
    return new Promise((resolve) => {
      storage.get(['rangeLowNote', 'rangeHighNote', 'targetNote'], (result) => {
        resolve({
          rangeLowNote: result.rangeLowNote ?? null,
          rangeHighNote: result.rangeHighNote ?? null,
          targetNote: result.targetNote ?? null,
        });
      });
    });
  }

  function saveSetup({ rangeLowNote, rangeHighNote, targetNote }) {
    return new Promise((resolve) => {
      storage.set({ rangeLowNote, rangeHighNote, targetNote }, resolve);
    });
  }

  return { getSetup, saveSetup };
}
```

**Correction from this plan's final whole-branch review fix round:** `saveSetup` above is the ORIGINAL Task 3 version — it resolves unconditionally, so a real storage failure (surfaced only via `chrome.runtime.lastError` inside the callback, never as a rejected promise from `chrome.storage.local` itself) was silently treated as success. The final, actual `saveSetup` in `src/prefs.js` today:

```js
  function saveSetup({ rangeLowNote, rangeHighNote, targetNote }) {
    return new Promise((resolve, reject) => {
      storage.set({ rangeLowNote, rangeHighNote, targetNote }, () => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
```

The `typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError` guard (not `chrome.runtime?.lastError`) matters: optional chaining only guards a null/undefined *value*, not an undeclared *binding* — with no `chrome` global at all (the Node test's fake storage runs with none), `chrome.runtime?.lastError` throws `ReferenceError: chrome is not defined` before the optional-chaining operator ever gets a chance to short-circuit. `typeof chrome !== 'undefined'` is checked first and never throws on an undeclared identifier, so the whole expression safely evaluates to `false` in Node and the promise resolves as before for every existing test. In `extension/onboarding/onboarding.js`, the `await prefs.saveSetup(...)` call is wrapped in try/catch so a rejection shows the same inline error element used for the range-validity case (see Task 4's correction below) instead of navigating to `done`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `prefs.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/prefs.js tests/prefs.test.js
git commit -m "Add dependency-injectable settings storage module"
```

---

### Task 4: Wire the setup screen to prefs and the range/target pickers

**Files:**
- Modify: `extension/onboarding/onboarding.js`

**Interfaces:**
- Consumes: `RANGE_BAND_NOTES`, `notesInRange` from `src/note-hz.js` (detection-engine plan, Task 1); `createPrefsStore` from `src/prefs.js` (Task 3)
- Produces: a working setup form that saves to `chrome.storage.local` and navigates to the `done` screen

- [ ] **Step 1: Add the setup-screen wiring to `extension/onboarding/onboarding.js`**

```js
import { RANGE_BAND_NOTES, notesInRange } from '../../src/note-hz.js';
import { createPrefsStore } from '../../src/prefs.js';

function populateSelect(select, notes) {
  select.innerHTML = '';
  for (const note of notes) {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    select.appendChild(option);
  }
}

const lowSelect = document.querySelector('[data-field="rangeLowNote"]');
const highSelect = document.querySelector('[data-field="rangeHighNote"]');
const targetSelect = document.querySelector('[data-field="targetNote"]');

populateSelect(lowSelect, RANGE_BAND_NOTES);
populateSelect(highSelect, RANGE_BAND_NOTES);

function refreshTargetOptions() {
  try {
    populateSelect(targetSelect, notesInRange(lowSelect.value, highSelect.value));
    targetSelect.disabled = false;
  } catch {
    targetSelect.innerHTML = '';
    targetSelect.disabled = true;
  }
}

lowSelect.addEventListener('change', refreshTargetOptions);
highSelect.addEventListener('change', refreshTargetOptions);
refreshTargetOptions();

const prefs = createPrefsStore();

document.querySelector('[data-form="setup"]').addEventListener('submit', async (event) => {
  event.preventDefault();
  await prefs.saveSetup({
    rangeLowNote: lowSelect.value,
    rangeHighNote: highSelect.value,
    targetNote: targetSelect.value,
  });
  showScreen('done');
});
```

This must be added at the top of the existing file (the `import` statements have to precede other code) — put the two `import` lines as the very first lines of `onboarding.js`, then the rest of this step's code after the existing `showScreen`/event-listener code already in the file from Tasks 1–2.

**Corrections from two later rounds (Task 4's own fix round, then this plan's final whole-branch review fix round) — the code above is the ORIGINAL Task 4 version. `extension/onboarding/onboarding.js` has changed twice since:**

1. **Task 4's fix round** (documented in `.superpowers/sdd/2026-08-15-fndmntl-extension-shell-onboarding/task-4-report.md`): the original submit handler above had no guard at all — an inverted range (low > high) left `targetSelect` disabled and empty via `refreshTargetOptions`'s catch, but HTML constraint validation skips disabled controls, so `required` didn't block submission. The form would submit anyway with `targetNote: ''`. That round added an inline error `<p data-error="setup">` (created in JS, inserted before the submit button) and a submit-time guard: `if (targetSelect.disabled || !targetSelect.value) { ...show error, return; }`.

2. **This plan's final whole-branch review fix round** found that guard still had a hole: `notesInRange('F2', 'F2')` (low === high) does NOT throw — it returns `['F2']`, a valid non-empty array — so `refreshTargetOptions` never disables `targetSelect`, and `targetSelect.disabled || !targetSelect.value` never catches it. Worse, both range selects defaulted to `RANGE_BAND_NOTES[0]` (`F2`), so an **untouched, unsubmitted-by-hand** form already saved a zero-width range — which divides by zero in the in-call panel's `gaugePosition` math. This round:
   - Added `export function isValidRange(lowNote, highNote)` to `src/note-hz.js` (tested in `tests/note-hz.test.js`) — returns `true` only when `notesInRange(...).length >= 2`, wrapped in try/catch so an inverted range degrades to `false` instead of throwing. This is additive to `src/note-hz.js`/`tests/note-hz.test.js`, which the detection-engine plan owns — no existing export or test there was touched.
   - Changed the submit guard to `if (!isValidRange(lowSelect.value, highSelect.value) || !targetSelect.value)`, catching both the inverted-range case and the valid-but-zero-width case through one explicit check, while still independently guarding an empty `targetNote`.
   - Set `highSelect.value = RANGE_BAND_NOTES[RANGE_BAND_NOTES.length - 1]` right after populating it (and before the initial `refreshTargetOptions()` call, which reads `highSelect.value`), so the untouched/default state is already F2–C3, not F2–F2.
   - Wrapped `await prefs.saveSetup(...)` in try/catch: on rejection (see Task 3's `saveSetup` correction above), shows the same inline error element with "Something went wrong saving your setup — please try again," and does not call `showScreen('done')`.
   - Added a `change` listener on `targetSelect` (it previously had none) and cleared the inline error at the top of both range selects' `change` handlers and on `targetSelect`'s, so a stale error doesn't linger after the user corrects their input.
   - Set `setupError.setAttribute('role', 'alert')` so screen readers announce it (finding #4, bundled into this round as a cheap, directly adjacent fix alongside the focus-on-transition change documented in Task 1 Step 5's correction above).

The final, actual `extension/onboarding/onboarding.js` in full, reflecting both rounds:

```js
import { RANGE_BAND_NOTES, notesInRange, isValidRange } from '../../src/note-hz.js';
import { createPrefsStore } from '../../src/prefs.js';

function showScreen(name) {
  document.querySelectorAll('[data-screen]').forEach((section) => {
    section.hidden = section.dataset.screen !== name;
  });
  document
    .querySelector(`[data-screen="${name}"] h1, [data-screen="${name}"] button`)
    ?.focus();
}

document.querySelector('[data-action="decline-mic"]').addEventListener('click', () => {
  showScreen('declined');
});

document.querySelector('[data-action="accept-mic"]').addEventListener('click', () => {
  showScreen('instructions');
});

document.querySelector('[data-action="know-tone-no"]').addEventListener('click', () => {
  showScreen('no-tone');
});

document.querySelector('[data-action="know-tone-yes"]').addEventListener('click', () => {
  showScreen('setup');
});

function populateSelect(select, notes) {
  select.innerHTML = '';
  for (const note of notes) {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    select.appendChild(option);
  }
}

const lowSelect = document.querySelector('[data-field="rangeLowNote"]');
const highSelect = document.querySelector('[data-field="rangeHighNote"]');
const targetSelect = document.querySelector('[data-field="targetNote"]');

const prefs = createPrefsStore();

const setupForm = document.querySelector('[data-form="setup"]');

const setupError = document.createElement('p');
setupError.dataset.error = 'setup';
setupError.setAttribute('role', 'alert');
setupError.hidden = true;
setupForm.insertBefore(setupError, setupForm.querySelector('button[type="submit"]'));

function clearSetupError() {
  setupError.hidden = true;
}

populateSelect(lowSelect, RANGE_BAND_NOTES);
populateSelect(highSelect, RANGE_BAND_NOTES);
highSelect.value = RANGE_BAND_NOTES[RANGE_BAND_NOTES.length - 1];

function refreshTargetOptions() {
  try {
    populateSelect(targetSelect, notesInRange(lowSelect.value, highSelect.value));
    targetSelect.disabled = false;
  } catch {
    targetSelect.innerHTML = '';
    targetSelect.disabled = true;
  }
}

lowSelect.addEventListener('change', () => {
  clearSetupError();
  refreshTargetOptions();
});
highSelect.addEventListener('change', () => {
  clearSetupError();
  refreshTargetOptions();
});
targetSelect.addEventListener('change', clearSetupError);
refreshTargetOptions();

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!isValidRange(lowSelect.value, highSelect.value) || !targetSelect.value) {
    setupError.textContent = 'Your low note must be lower than your high note.';
    setupError.hidden = false;
    return;
  }

  setupError.hidden = true;

  try {
    await prefs.saveSetup({
      rangeLowNote: lowSelect.value,
      rangeHighNote: highSelect.value,
      targetNote: targetSelect.value,
    });
  } catch {
    setupError.textContent = 'Something went wrong saving your setup — please try again.';
    setupError.hidden = false;
    return;
  }

  showScreen('done');
});
```

- [ ] **Step 2: Manual verification**

1. Reload the unpacked extension.
2. Walk through onboarding: Accept → instructions → Yes → setup screen now shows populated selects (F2 through C3) for both range fields, and a target select scoped to whatever range you pick.
3. Pick a low/high range, pick a target, submit → confirm the "You're set up" screen shows.
4. Open the service worker console (chrome://extensions → FNDMNTL → "service worker" link isn't relevant here; instead inspect the onboarding tab itself → Application tab → Storage → Extension storage) and confirm `rangeLowNote`, `rangeHighNote`, `targetNote` are saved with the values you picked.
5. Reload the onboarding page directly (not reinstall) and confirm re-submitting with different values overwrites the stored ones.

Expected: all five checks pass.

- [ ] **Step 3: Commit**

```bash
git add extension/onboarding/onboarding.js
git commit -m "Wire setup screen to range/target pickers and settings storage"
```

---

## Self-Review

**Spec coverage:**
- Onboarding flow exactly as the PDF: disclaimer → accept/decline → instructions → yes/no fork → setup or hard-stop → done → Tasks 1, 2, 4 ✓
- Hard stop on "No," verbatim medical-device disclaimer → Task 1 (markup), Task 2 (wiring) ✓
- Setup persists via `chrome.storage.local`, nothing else does → Task 3, Task 4 ✓
- Range picker bounded to F2–C3 → Task 4, reusing `RANGE_BAND_NOTES`/`notesInRange` rather than a new list ✓
- No `MediaRecorder`/network calls → nothing in this plan touches either ✓

**Placeholder scan:** No TBD/TODO. The "inert until Task 2/4" notes in Tasks 1 and 2 describe real, working intermediate states (buttons exist and are clickable, they just have no listener yet) — not vague placeholders; the exact next task that wires them is named.

**Type consistency:** `createPrefsStore`'s returned `getSetup()`/`saveSetup()` field names (`rangeLowNote`, `rangeHighNote`, `targetNote`) match exactly between Task 3's implementation and Task 4's caller. `notesInRange`/`RANGE_BAND_NOTES` names match their definitions in the detection-engine plan.

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-15-fndmntl-extension-shell-onboarding.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
