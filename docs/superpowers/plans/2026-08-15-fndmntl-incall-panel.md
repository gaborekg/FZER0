# FNDMNTL In-Call Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the panel that appears during a live Google Meet call — the non-technical call-time face (gauge, verdict words, volume meter, "Hear your tone") and the technical details view (`⋯`/`←`) behind it — wired to real microphone capture, and confirm it actually works on a real call.

**Architecture:** A single ISOLATED-world content script (`extension/content.js`) — confirmed sufficient by a live permission spike on 2026-08-14, no MAIN-world script or postMessage bridge needed — detects a Meet call, reads settings via `src/prefs.js`, and mounts a Shadow-DOM panel (`extension/panel/panel.js`) that is environment-agnostic: it takes a host element and a settings object and returns a `renderReading` function, with no `chrome.*` dependency of its own. That separation is what lets the exact same panel code run inside the real extension and inside an offline mock Meet page for development. Audio capture (`getUserMedia` + `AudioContext` + an `AudioWorkletNode` wrapping the already-tested `detectPitch` core) lives entirely in `content.js`, which is the one file that actually needs to be "the real thing."

**Tech Stack:** Manifest V3 content script (classic script using dynamic `import()` to reach extension-internal ES modules — content scripts cannot be declared `"type": "module"` the way the background service worker can), Web Audio API, `AudioWorkletProcessor`, Shadow DOM, Node's built-in test runner for every piece of logic that doesn't require a live `AudioContext`/`chrome.*`.

This plan assumes both prior plans are implemented: the detection-engine plan (`2026-08-14-fndmntl-detection-engine.md`) for `src/f0-core.js`, `src/gate.js`, `src/noise-floor.js`, `src/session.js`, `src/note-hz.js`, `src/config.js`; and the extension-shell plan (`2026-08-15-fndmntl-extension-shell-onboarding.md`) for `manifest.json`, `src/prefs.js`.

## Global Constraints

- **Call-time face shows a position, never a number, while a call is active.** No Hz, no note names, no live numeric readout on the face — those live only behind `⋯`.
- **"Too high" must be a live, moving state, not a frozen one.** A voiced reading above the user's ceiling (but inside 65–400 Hz) updates the gauge marker immediately into the unshaded zone. Freezing the marker is reserved *only* for genuine silence/no-pitch/too-quiet frames — never for an above-ceiling reading. This is the direct, testable consequence of the gate fix from the detection-engine plan; get this wrong and the whole redesign is pointless.
- **Reference tone plays to the user's own output device only**, and pauses live analysis while it plays (resuming after `TONE_RESUME_DELAY_MS`, from `src/config.js`).
- **No second microphone permission prompt** on a live call — confirmed working from an ISOLATED-world content script; if a real call ever shows one, that's a regression, not expected behavior.
- **No recording, no network call, ever**, in any file this plan touches.
- **Panel teardown is real**: leaving a call removes the panel and stops the microphone stream — verified by an actual OS/browser mic-in-use indicator going dark, not just by the DOM node disappearing.

---

### Task 1: Gauge and volume presentation logic

**Files:**
- Create: `src/gauge.js`
- Test: `tests/gauge.test.js`

**Interfaces:**
- Produces: `gaugePosition(hz: number|null, {rangeLowHz, rangeHighHz}): number|null`, `gaugeVerdict(position: number|null): 'Good'|'Too high'|null`, `volumeLevel(rms: number|null, {floorRms, ceilingRms}): number|null` (clamped 0–1), `volumeVerdict(rms: number|null, ceilingRms: number): 'Good'|'Too loud'|null`

`gaugePosition` returns `0` at the low end of the range, `1` at the ceiling, and values above `1` for readings above the ceiling — the panel later renders that as the marker moving into the unshaded zone above the ceiling line.

- [ ] **Step 1: Write the failing test**

```js
// tests/gauge.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugePosition, gaugeVerdict, volumeLevel, volumeVerdict } from '../src/gauge.js';

const RANGE = { rangeLowHz: 100, rangeHighHz: 150 };

test('gaugePosition maps the low end of the range to 0', () => {
  assert.equal(gaugePosition(100, RANGE), 0);
});

test('gaugePosition maps the ceiling to 1', () => {
  assert.equal(gaugePosition(150, RANGE), 1);
});

test('gaugePosition maps a reading above the ceiling to a value above 1', () => {
  const position = gaugePosition(200, RANGE);
  assert.ok(position > 1, `expected > 1, got ${position}`);
});

test('gaugePosition returns null when there is no reading', () => {
  assert.equal(gaugePosition(null, RANGE), null);
});

test('gaugeVerdict is Good at or below the ceiling', () => {
  assert.equal(gaugeVerdict(0.5), 'Good');
  assert.equal(gaugeVerdict(1), 'Good');
});

test('gaugeVerdict is Too high above the ceiling', () => {
  assert.equal(gaugeVerdict(1.01), 'Too high');
});

test('gaugeVerdict is null when there is no reading', () => {
  assert.equal(gaugeVerdict(null), null);
});

test('volumeLevel clamps to 0 and 1', () => {
  assert.equal(volumeLevel(0, { floorRms: 0.01, ceilingRms: 0.05 }), 0);
  assert.equal(volumeLevel(1, { floorRms: 0.01, ceilingRms: 0.05 }), 1);
});

test('volumeVerdict is Too loud above the ceiling, Good at or below it', () => {
  assert.equal(volumeVerdict(0.06, 0.05), 'Too loud');
  assert.equal(volumeVerdict(0.04, 0.05), 'Good');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/gauge.js'`

- [ ] **Step 3: Implement `src/gauge.js`**

```js
export function gaugePosition(hz, { rangeLowHz, rangeHighHz }) {
  if (hz === null) return null;
  return (hz - rangeLowHz) / (rangeHighHz - rangeLowHz);
}

export function gaugeVerdict(position) {
  if (position === null) return null;
  return position > 1 ? 'Too high' : 'Good';
}

export function volumeLevel(rms, { floorRms, ceilingRms }) {
  if (rms === null) return null;
  const level = (rms - floorRms) / (ceilingRms - floorRms);
  return Math.max(0, Math.min(1, level));
}

export function volumeVerdict(rms, ceilingRms) {
  if (rms === null) return null;
  return rms > ceilingRms ? 'Too loud' : 'Good';
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `gauge.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/gauge.js tests/gauge.test.js
git commit -m "Add gauge and volume presentation logic"
```

---

### Task 2: Meet call URL detection

**Files:**
- Create: `src/meet-url.js`
- Test: `tests/meet-url.test.js`

**Interfaces:**
- Produces: `isMeetCallUrl(pathname: string): boolean`

- [ ] **Step 1: Write the failing test**

```js
// tests/meet-url.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeetCallUrl } from '../src/meet-url.js';

test('recognizes a real Meet call code path', () => {
  assert.equal(isMeetCallUrl('/abc-defg-hij'), true);
});

test('rejects the Meet landing page', () => {
  assert.equal(isMeetCallUrl('/'), false);
  assert.equal(isMeetCallUrl('/landing'), false);
});

test('rejects a path missing the third segment', () => {
  assert.equal(isMeetCallUrl('/abc-defg'), false);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/meet-url.js'`

- [ ] **Step 3: Implement `src/meet-url.js`**

```js
export function isMeetCallUrl(pathname) {
  return /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(pathname);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `meet-url.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/meet-url.js tests/meet-url.test.js
git commit -m "Add Meet call URL detection"
```

---

### Task 3: Reference tone player

**Files:**
- Create: `src/tone-player.js`
- Test: `tests/tone-player.test.js`

**Interfaces:**
- Consumes: `noteToHz` from `src/note-hz.js` (detection-engine plan)
- Produces: `createTonePlayer(audioContextFactory?): { play(note: string, {durationMs?, onStart?, onEnd?}): void }`

`AudioContext` doesn't exist in Node, so the factory is injectable — tests supply a fake with just enough shape (`createOscillator`, `destination`, `currentTime`) to verify the real logic (frequency selection, start/end callback timing, context reuse) without a browser.

- [ ] **Step 1: Write the failing test**

```js
// tests/tone-player.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTonePlayer } from '../src/tone-player.js';

function createFakeAudioContext() {
  const calls = { oscillators: [] };
  const fakeContext = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const oscillator = {
        connect() {},
        start() {
          oscillator.started = true;
        },
        stop(when) {
          oscillator.stoppedAt = when;
        },
        frequency: { value: null },
      };
      calls.oscillators.push(oscillator);
      return oscillator;
    },
  };
  return { fakeContext, calls };
}

test("play sets the oscillator frequency to the note's Hz value", () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  player.play('A2');
  assert.ok(Math.abs(calls.oscillators[0].frequency.value - 110) < 0.5);
});

test('play calls onStart before starting the oscillator', () => {
  const { fakeContext } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  let startedCalled = false;
  player.play('A2', { onStart: () => { startedCalled = true; } });
  assert.equal(startedCalled, true);
});

test('play calls onEnd when the oscillator fires onended', () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  let endedCalled = false;
  player.play('A2', { onEnd: () => { endedCalled = true; } });
  calls.oscillators[0].onended();
  assert.equal(endedCalled, true);
});

test('reuses the same AudioContext across multiple play calls', () => {
  let factoryCalls = 0;
  const { fakeContext } = createFakeAudioContext();
  const player = createTonePlayer(() => {
    factoryCalls += 1;
    return fakeContext;
  });
  player.play('A2');
  player.play('C3');
  assert.equal(factoryCalls, 1);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/tone-player.js'`

- [ ] **Step 3: Implement `src/tone-player.js`**

```js
import { noteToHz } from './note-hz.js';

export function createTonePlayer(audioContextFactory = () => new AudioContext()) {
  let audioContext = null;

  function play(note, { durationMs = 1200, onStart, onEnd } = {}) {
    if (!audioContext) {
      audioContext = audioContextFactory();
    }
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = noteToHz(note);
    oscillator.connect(audioContext.destination);
    if (onStart) onStart();
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationMs / 1000);
    oscillator.onended = () => {
      if (onEnd) onEnd();
    };
  }

  return { play };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `tone-player.test.js` tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tone-player.js tests/tone-player.test.js
git commit -m "Add reference tone player"
```

---

### Task 4: AudioWorklet pitch/volume processor

**Files:**
- Create: `extension/worklet/f0-processor.js`
- Create: `tests/manual/worklet-harness.html`

**Interfaces:**
- Consumes: `detectPitch` from `src/f0-core.js` (detection-engine plan), `FRAME_SIZE` from `src/config.js`
- Produces: an `AudioWorkletProcessor` registered as `'fndmntl-f0-processor'` that posts `{hz, confidence, rms}` messages to the main thread once per accumulated `FRAME_SIZE`-sample buffer

`AudioWorkletGlobalScope` doesn't exist in Node, so this cannot be unit tested — it's a thin wrapper around the already-tested `detectPitch`, verified manually in a browser via the harness page below.

- [ ] **Step 1: Implement `extension/worklet/f0-processor.js`**

```js
import { detectPitch } from '../../src/f0-core.js';
import { FRAME_SIZE } from '../../src/config.js';

class F0Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.bufferIndex] = channel[i];
      this.bufferIndex += 1;
      if (this.bufferIndex === FRAME_SIZE) {
        const result = detectPitch(this.buffer, sampleRate);
        this.port.postMessage(result);
        this.bufferIndex = 0;
      }
    }

    return true;
  }
}

registerProcessor('fndmntl-f0-processor', F0Processor);
```

- [ ] **Step 2: Create the manual test harness `tests/manual/worklet-harness.html`**

```html
<!DOCTYPE html>
<html>
<head><title>f0-processor manual test</title></head>
<body>
<p>Open the console. You should see repeated postMessage logs with hz close to 110.</p>
<script type="module">
  const audioContext = new AudioContext();
  await audioContext.audioWorklet.addModule('../../extension/worklet/f0-processor.js');

  const oscillator = audioContext.createOscillator();
  oscillator.frequency.value = 110;

  const workletNode = new AudioWorkletNode(audioContext, 'fndmntl-f0-processor');
  workletNode.port.onmessage = (event) => {
    console.log('f0-processor result:', event.data);
  };

  oscillator.connect(workletNode);
  oscillator.start();
</script>
</body>
</html>
```

- [ ] **Step 3: Manual verification**

1. From the project root, start a static server: `python3 -m http.server 8123` (module imports are blocked over `file://`, same reason the reference project needed one).
2. Open `http://localhost:8123/tests/manual/worklet-harness.html`.
3. Open DevTools console.
4. Confirm repeated logs showing `hz` close to `110`, `confidence` high (> 0.9), `rms` greater than 0.
5. **If `addModule` throws an import-related error** (some Chrome versions restrict static `import` inside worklet modules): remove the `import` line from `f0-processor.js`, paste `detectPitch`'s full function body (and its `autocorrelationAt` helper) directly into the file in place of the import, and re-test. Note in your commit message which path was needed — this is a real, known risk flagged during design review, not a hypothetical.

Expected: step 4's console output confirms the worklet correctly wraps the tested estimator.

- [ ] **Step 4: Commit**

```bash
git add extension/worklet/f0-processor.js tests/manual/worklet-harness.html
git commit -m "Add AudioWorklet wrapper around the pitch/volume estimator"
```

---

### Task 5: Shadow DOM panel shell + call-time face

**Files:**
- Create: `extension/panel/panel.js`
- Create: `extension/panel/panel.css`

**Interfaces:**
- Consumes: `gaugePosition`, `gaugeVerdict`, `volumeLevel`, `volumeVerdict` from `src/gauge.js` (Task 1); `noteToHz` from `src/note-hz.js`; `createNoiseFloor` from `src/noise-floor.js`; `classifyFrame` from `src/gate.js`; `createSession` from `src/session.js`; `createTonePlayer` from `src/tone-player.js`; `VOLUME_CEILING_RMS`, `CONFIDENCE_MIN` from `src/config.js` (all detection-engine plan)
- Produces: `mountPanel(hostElement: HTMLElement, setup: {rangeLowNote, rangeHighNote, targetNote}): { renderReading({hz, confidence, rms}): void }`

`panel.js` has zero `chrome.*` dependency — it resolves its own CSS via `import.meta.url`, not `chrome.runtime.getURL`, so the exact same file works inside the real extension and inside an offline mock page (Task 7). This task builds the call-time face only; the details view is added (already present in the markup, but not switched to) in Task 6.

- [ ] **Step 1: Implement `extension/panel/panel.css`**

```css
:host {
  all: initial;
}

.face, .details {
  position: fixed;
  top: 5rem;
  right: 1rem;
  width: 12rem;
  padding: 0.75rem;
  background: #202124;
  color: #e8eaed;
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  border-radius: 0.5rem;
  z-index: 2147483647;
}

.gauge {
  position: relative;
  height: 8rem;
  width: 1.5rem;
  margin: 0.5rem auto;
  background: #3c4043;
  border-radius: 0.25rem;
}

.gauge-band {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 100%;
  background: #4a6b8a;
  border-radius: 0.25rem;
}

.gauge-ceiling {
  position: absolute;
  bottom: 100%;
  width: 100%;
  height: 2px;
  background: #e8eaed;
}

.gauge-marker {
  position: absolute;
  bottom: 0;
  width: 100%;
  height: 3px;
  background: #fbbc04;
}

.verdict {
  text-align: center;
  margin: 0.25rem 0;
}

.volume-meter {
  height: 0.5rem;
  width: 100%;
  background: #3c4043;
  border-radius: 0.25rem;
  overflow: hidden;
}

.volume-fill {
  height: 100%;
  background: #4a6b8a;
}

button {
  display: block;
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.4rem;
  font-size: 0.8rem;
}

.details-button {
  width: auto;
  float: right;
}

dl {
  margin: 0;
}

dt {
  font-weight: bold;
  margin-top: 0.5rem;
}

dd {
  margin: 0;
}
```

- [ ] **Step 2: Implement `extension/panel/panel.js`**

```js
import { gaugePosition, gaugeVerdict, volumeLevel, volumeVerdict } from '../../src/gauge.js';
import { noteToHz } from '../../src/note-hz.js';
import { createNoiseFloor } from '../../src/noise-floor.js';
import { classifyFrame } from '../../src/gate.js';
import { createSession } from '../../src/session.js';
import { createTonePlayer } from '../../src/tone-player.js';
import { VOLUME_CEILING_RMS, TONE_RESUME_DELAY_MS } from '../../src/config.js';

const PANEL_HTML = `
  <div class="face" data-view="face">
    <button class="details-button" data-action="open-details">⋯</button>
    <div class="gauge">
      <div class="gauge-band"></div>
      <div class="gauge-ceiling"></div>
      <div class="gauge-marker"></div>
    </div>
    <p class="verdict" data-el="pitch-verdict">&nbsp;</p>
    <div class="volume-meter">
      <div class="volume-fill" data-el="volume-fill"></div>
    </div>
    <p class="verdict" data-el="volume-verdict">&nbsp;</p>
    <button data-action="hear-tone">Hear your tone</button>
  </div>

  <div class="details" data-view="details" hidden>
    <button data-action="close-details">← Back</button>
    <dl>
      <dt>Live reading</dt>
      <dd data-el="live-hz">—</dd>
      <dt>Voiced</dt>
      <dd data-el="count-voiced">0</dd>
      <dt>Too quiet</dt>
      <dd data-el="count-too-quiet">0</dd>
      <dt>No pitch</dt>
      <dd data-el="count-no-pitch">0</dd>
      <dt>Out of range</dt>
      <dd data-el="count-out-of-range">0</dd>
    </dl>
  </div>
`;

export function mountPanel(hostElement, setup) {
  const shadow = hostElement.attachShadow({ mode: 'open' });

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./panel.css', import.meta.url).href;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = PANEL_HTML;
  shadow.appendChild(wrapper);

  const rangeLowHz = noteToHz(setup.rangeLowNote);
  const rangeHighHz = noteToHz(setup.rangeHighNote);

  const noiseFloor = createNoiseFloor();
  const session = createSession();
  const tonePlayer = createTonePlayer();

  let analysisPaused = false;

  const pitchVerdictEl = shadow.querySelector('[data-el="pitch-verdict"]');
  const volumeFillEl = shadow.querySelector('[data-el="volume-fill"]');
  const volumeVerdictEl = shadow.querySelector('[data-el="volume-verdict"]');
  const markerEl = shadow.querySelector('.gauge-marker');
  const liveHzEl = shadow.querySelector('[data-el="live-hz"]');
  const countEls = {
    voiced: shadow.querySelector('[data-el="count-voiced"]'),
    'too-quiet': shadow.querySelector('[data-el="count-too-quiet"]'),
    'no-pitch': shadow.querySelector('[data-el="count-no-pitch"]'),
    'out-of-range': shadow.querySelector('[data-el="count-out-of-range"]'),
  };

  function renderReading(reading) {
    if (analysisPaused) return;

    noiseFloor.addSample(reading.rms, Date.now());
    const classified = classifyFrame(reading, { floorRms: noiseFloor.getFloor() });
    session.record(classified, Date.now());
    countEls[classified.category].textContent = session.getCounts()[classified.category];

    if (classified.category !== 'voiced') return;

    const position = gaugePosition(classified.hz, { rangeLowHz, rangeHighHz });
    markerEl.style.bottom = `${Math.max(0, Math.min(1.2, position)) * 100}%`;
    pitchVerdictEl.textContent = gaugeVerdict(position);

    const level = volumeLevel(reading.rms, { floorRms: noiseFloor.getFloor(), ceilingRms: VOLUME_CEILING_RMS });
    volumeFillEl.style.width = `${level * 100}%`;
    volumeVerdictEl.textContent = volumeVerdict(reading.rms, VOLUME_CEILING_RMS);

    liveHzEl.textContent = `${classified.hz.toFixed(1)} Hz`;
  }

  shadow.querySelector('[data-action="open-details"]').addEventListener('click', () => {
    shadow.querySelector('[data-view="face"]').hidden = true;
    shadow.querySelector('[data-view="details"]').hidden = false;
  });

  shadow.querySelector('[data-action="close-details"]').addEventListener('click', () => {
    shadow.querySelector('[data-view="details"]').hidden = true;
    shadow.querySelector('[data-view="face"]').hidden = false;
  });

  shadow.querySelector('[data-action="hear-tone"]').addEventListener('click', () => {
    tonePlayer.play(setup.targetNote, {
      onStart: () => {
        analysisPaused = true;
      },
      onEnd: () => {
        setTimeout(() => {
          analysisPaused = false;
        }, TONE_RESUME_DELAY_MS);
      },
    });
  });

  return { renderReading };
}
```

Note on the idle-vs-too-high distinction from the design spec: `renderReading` only updates the marker/verdict when `classified.category === 'voiced'` — for `too-quiet`/`no-pitch`/`out-of-range` frames it returns early, leaving the marker at its last position (the "freeze" behavior). Because the gate fix (detection-engine plan, Task 4) classifies an above-ceiling-but-in-band reading as `voiced`, that case *does* reach the update code below and moves the marker live — freezing genuinely never happens for a "too high" moment, only for real silence/no-pitch/too-quiet.

- [ ] **Step 3: Manual verification**

This task's real verification happens in Task 7 (mock page + live call), since there's no way to feed `renderReading` real data yet without either. Confirm only that the file has no syntax errors: run `node --check extension/panel/panel.js` from the project root.

Run: `node --check extension/panel/panel.js`
Expected: no output (a syntax error would print a message and exit non-zero)

- [ ] **Step 4: Commit**

```bash
git add extension/panel/panel.js extension/panel/panel.css
git commit -m "Add Shadow DOM panel shell and call-time face"
```

---

### Task 6: Details view — editable range/target, volume calibration, live readout, history chart

**Files:**
- Modify: `extension/panel/panel.js`
- Modify: `src/prefs.js` (add `referenceToneNote`)
- Modify: `tests/prefs.test.js` (cover the new field)
- Create: `src/volume-calibration.js`
- Test: `tests/volume-calibration.test.js`

**Interfaces:**
- Consumes: `notesInRange`, `hzToNote` from `src/note-hz.js`
- Produces: `computeCeilingFromSamples(rmsSamples: number[]): number` in `src/volume-calibration.js`; an extended details view in the panel with editable range/target/reference-tone selects, a "talk normally, then set it" calibration button, live Hz+note readout, and a canvas history chart

- [ ] **Step 1: Write the failing test for volume calibration**

```js
// tests/volume-calibration.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCeilingFromSamples } from '../src/volume-calibration.js';

test('computes a ceiling above the 90th percentile of normal talking volume', () => {
  const samples = Array.from({ length: 100 }, (_, i) => 0.01 + i * 0.0002); // 0.01 to ~0.03
  const ceiling = computeCeilingFromSamples(samples);
  const p90 = samples[Math.floor(0.9 * (samples.length - 1))];
  assert.ok(ceiling > p90, `expected ceiling above p90 (${p90}), got ${ceiling}`);
});

test('throws on an empty sample list', () => {
  assert.throws(() => computeCeilingFromSamples([]));
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/volume-calibration.js'`

- [ ] **Step 3: Implement `src/volume-calibration.js`**

```js
export function computeCeilingFromSamples(rmsSamples) {
  if (rmsSamples.length === 0) {
    throw new Error('Cannot calibrate from an empty sample list');
  }
  const sorted = [...rmsSamples].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (sorted.length - 1));
  return sorted[idx] * 1.5;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm test`
Expected: all `volume-calibration.test.js` tests PASS

- [ ] **Step 5: Extend `src/prefs.js` to store `referenceToneNote`**

Change the `getSetup`/`saveSetup` bodies to include the new field:

```js
function getSetup() {
  return new Promise((resolve) => {
    storage.get(['rangeLowNote', 'rangeHighNote', 'targetNote', 'referenceToneNote'], (result) => {
      resolve({
        rangeLowNote: result.rangeLowNote ?? null,
        rangeHighNote: result.rangeHighNote ?? null,
        targetNote: result.targetNote ?? null,
        referenceToneNote: result.referenceToneNote ?? null,
      });
    });
  });
}

function saveSetup({ rangeLowNote, rangeHighNote, targetNote, referenceToneNote }) {
  return new Promise((resolve) => {
    storage.set(
      { rangeLowNote, rangeHighNote, targetNote, referenceToneNote: referenceToneNote ?? targetNote },
      resolve
    );
  });
}
```

**Why the fallback matters:** the onboarding flow (extension-shell-onboarding plan, already built) calls `saveSetup({rangeLowNote, rangeHighNote, targetNote})` — three fields, no `referenceToneNote`, and that plan is already complete and not being modified here. Without the `?? targetNote` fallback, that existing call site would silently store `referenceToneNote: undefined`. Defaulting it to `targetNote` (a reasonable starting reference tone — the user's own therapy target) means the existing onboarding flow keeps working correctly without requiring a cross-plan edit to already-shipped code.

- [ ] **Step 6: Update `tests/prefs.test.js` for the new field**

Add `referenceToneNote: null` to the empty-state assertion in the "returns nulls" test, add `referenceToneNote: 'A2'` to the round-trip test's saved/expected objects, and add a new test: calling `saveSetup({rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2'})` **without** `referenceToneNote`, then `getSetup()`, expects `referenceToneNote` to equal `'A2'` (the `targetNote` fallback) — this is the regression test for the onboarding-compatibility fix above.

- [ ] **Step 7: Run the tests, verify they pass**

Run: `npm test`
Expected: all `prefs.test.js` and `volume-calibration.test.js` tests PASS

- [ ] **Step 8: Extend the details-view markup and wiring in `extension/panel/panel.js`**

Add to the `details` section of `PANEL_HTML`, just after the closing `</dl>`:

```html
<canvas data-el="history-chart" width="180" height="60"></canvas>
<label>
  Low
  <select data-field="rangeLowNote"></select>
</label>
<label>
  High
  <select data-field="rangeHighNote"></select>
</label>
<label>
  Target
  <select data-field="targetNote"></select>
</label>
<label>
  Reference tone
  <select data-field="referenceToneNote"></select>
</label>
<button data-action="save-range">Save range/target</button>
<button data-action="calibrate-volume">Talk normally, then set it</button>
```

Add these imports to the top of `panel.js`:

```js
import { notesInRange, hzToNote, RANGE_BAND_NOTES } from '../../src/note-hz.js';
import { computeCeilingFromSamples } from '../../src/volume-calibration.js';
import { createPrefsStore } from '../../src/prefs.js';
```

Add this logic inside `mountPanel`, after the existing `countEls` block and before `renderReading` is defined — `volumeCeilingRms` becomes a mutable variable rather than the fixed `VOLUME_CEILING_RMS` import, since calibration overwrites it:

```js
let volumeCeilingRms = VOLUME_CEILING_RMS;
let calibrating = false;
let calibrationSamples = [];

const historyCanvas = shadow.querySelector('[data-el="history-chart"]');
const rangeLowSelect = shadow.querySelector('[data-field="rangeLowNote"]');
const rangeHighSelect = shadow.querySelector('[data-field="rangeHighNote"]');
const targetSelect = shadow.querySelector('[data-field="targetNote"]');
const referenceToneSelect = shadow.querySelector('[data-field="referenceToneNote"]');
const prefs = createPrefsStore();

function populateSelect(select, notes, selected) {
  select.innerHTML = '';
  for (const note of notes) {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    if (note === selected) option.selected = true;
    select.appendChild(option);
  }
}

populateSelect(rangeLowSelect, RANGE_BAND_NOTES, setup.rangeLowNote);
populateSelect(rangeHighSelect, RANGE_BAND_NOTES, setup.rangeHighNote);
populateSelect(targetSelect, notesInRange(setup.rangeLowNote, setup.rangeHighNote), setup.targetNote);
populateSelect(
  referenceToneSelect,
  notesInRange(setup.rangeLowNote, setup.rangeHighNote),
  setup.referenceToneNote ?? setup.targetNote
);

shadow.querySelector('[data-action="save-range"]').addEventListener('click', async () => {
  await prefs.saveSetup({
    rangeLowNote: rangeLowSelect.value,
    rangeHighNote: rangeHighSelect.value,
    targetNote: targetSelect.value,
    referenceToneNote: referenceToneSelect.value,
  });
});

shadow.querySelector('[data-action="calibrate-volume"]').addEventListener('click', () => {
  calibrating = true;
  calibrationSamples = [];
  setTimeout(() => {
    calibrating = false;
    if (calibrationSamples.length > 0) {
      volumeCeilingRms = computeCeilingFromSamples(calibrationSamples);
    }
  }, 5000);
});

function renderHistoryChart() {
  const ctx = historyCanvas.getContext('2d');
  ctx.clearRect(0, 0, historyCanvas.width, historyCanvas.height);
  const voicedPoints = session.getHistory().filter((entry) => entry.category === 'voiced');
  if (voicedPoints.length === 0) return;

  const minTime = voicedPoints[0].timestampMs;
  const maxTime = voicedPoints[voicedPoints.length - 1].timestampMs;
  const timeSpan = Math.max(1, maxTime - minTime);

  ctx.strokeStyle = '#4a6b8a';
  ctx.beginPath();
  voicedPoints.forEach((entry, index) => {
    const x = ((entry.timestampMs - minTime) / timeSpan) * historyCanvas.width;
    const position = (entry.hz - rangeLowHz) / (rangeHighHz - rangeLowHz);
    const y = historyCanvas.height - Math.max(0, Math.min(1.2, position)) * historyCanvas.height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}
```

Now update the existing `renderReading` function: replace its `VOLUME_CEILING_RMS` references with `volumeCeilingRms`, add a calibration-sample collection line, and call `renderHistoryChart()` each time a voiced frame is recorded, and update the live Hz readout to include the note name:

```js
function renderReading(reading) {
  if (analysisPaused) return;

  if (calibrating) {
    calibrationSamples.push(reading.rms);
  }

  noiseFloor.addSample(reading.rms, Date.now());
  const classified = classifyFrame(reading, { floorRms: noiseFloor.getFloor() });
  session.record(classified, Date.now());
  countEls[classified.category].textContent = session.getCounts()[classified.category];

  if (classified.category !== 'voiced') return;

  const position = gaugePosition(classified.hz, { rangeLowHz, rangeHighHz });
  markerEl.style.bottom = `${Math.max(0, Math.min(1.2, position)) * 100}%`;
  pitchVerdictEl.textContent = gaugeVerdict(position);

  const level = volumeLevel(reading.rms, { floorRms: noiseFloor.getFloor(), ceilingRms: volumeCeilingRms });
  volumeFillEl.style.width = `${level * 100}%`;
  volumeVerdictEl.textContent = volumeVerdict(reading.rms, volumeCeilingRms);

  liveHzEl.textContent = `${classified.hz.toFixed(1)} Hz (${hzToNote(classified.hz)})`;
  renderHistoryChart();
}
```

- [ ] **Step 9: Verify no syntax errors**

Run: `node --check extension/panel/panel.js`
Expected: no output

- [ ] **Step 10: Commit**

```bash
git add extension/panel/panel.js src/prefs.js src/volume-calibration.js tests/prefs.test.js tests/volume-calibration.test.js
git commit -m "Add details view: editable setup, volume calibration, live readout, history chart"
```

---

### Task 7: Content script wiring, mock page, and live-call verification

**Files:**
- Create: `extension/content.js`
- Create: `mock/meet.html`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: `isMeetCallUrl` from `src/meet-url.js` (Task 2); `createPrefsStore` from `src/prefs.js`; `mountPanel` from `extension/panel/panel.js` (Tasks 5–6); `f0-processor.js` (Task 4)
- Produces: the fully wired extension — panel appears automatically on a live Meet call, backed by real microphone capture

Content scripts cannot be declared `"type": "module"` in the manifest (only the background service worker supports that) — `content.js` is a classic script that reaches extension-internal ES modules via dynamic `import()`, which *is* allowed from a classic script. Every file reached this way (everything under `src/*.js`, `extension/panel/*`, `extension/worklet/*`) must be listed in `web_accessible_resources`, or Chrome blocks the fetch from inside Meet's page context.

- [ ] **Step 1: Modify `manifest.json`** to add content script registration and web-accessible resources

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
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["extension/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "src/*.js",
        "extension/panel/*.js",
        "extension/panel/*.css",
        "extension/worklet/*.js"
      ],
      "matches": ["https://meet.google.com/*"]
    }
  ]
}
```

- [ ] **Step 2: Create `extension/content.js`**

```js
(async () => {
  const { isMeetCallUrl } = await import(chrome.runtime.getURL('src/meet-url.js'));
  const { createPrefsStore } = await import(chrome.runtime.getURL('src/prefs.js'));
  const { mountPanel } = await import(chrome.runtime.getURL('extension/panel/panel.js'));

  let mounted = false;
  let audioContext = null;
  let stream = null;

  async function startAudioPipeline(renderReading) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });

    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
      chrome.runtime.getURL('extension/worklet/f0-processor.js')
    );

    const source = audioContext.createMediaStreamSource(stream);
    const workletNode = new AudioWorkletNode(audioContext, 'fndmntl-f0-processor');
    workletNode.port.onmessage = (event) => renderReading(event.data);
    source.connect(workletNode);
  }

  function stopAudioPipeline() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  }

  async function maybeMountPanel() {
    if (mounted) return;
    if (!isMeetCallUrl(window.location.pathname)) return;

    const prefs = createPrefsStore();
    const setup = await prefs.getSetup();
    if (!setup.targetNote) return;

    const host = document.createElement('div');
    host.id = 'fndmntl-panel-host';
    document.body.appendChild(host);
    const { renderReading } = mountPanel(host, setup);
    await startAudioPipeline(renderReading);
    mounted = true;
  }

  function teardownPanel() {
    stopAudioPipeline();
    const existingHost = document.getElementById('fndmntl-panel-host');
    if (existingHost) existingHost.remove();
    mounted = false;
  }

  maybeMountPanel();

  let lastPathname = window.location.pathname;
  setInterval(() => {
    if (window.location.pathname !== lastPathname) {
      lastPathname = window.location.pathname;
      if (mounted && !isMeetCallUrl(lastPathname)) {
        teardownPanel();
      } else if (!mounted) {
        maybeMountPanel();
      }
    }
  }, 1000);
})();
```

Meet is a single-page app, so navigating between its landing page and a call doesn't reload the page — this polls `location.pathname` once a second to notice the transition. That's a known simplification (not tied to Meet's internal router), flagged here rather than hidden.

- [ ] **Step 3: Create `mock/meet.html`** — an offline stand-in that exercises the panel directly, bypassing `content.js`'s URL/prefs checks (those are already covered by Task 2's unit tests) so it can be opened without a real call or real settings

```html
<!DOCTYPE html>
<html>
<head><title>Mock Meet</title></head>
<body style="background:#202124; color:white; font-family: sans-serif; height:100vh; margin:0; display:flex; align-items:center; justify-content:center;">
  <p>Offline stand-in for a Meet call layout.</p>
  <script type="module">
    import { mountPanel } from '../extension/panel/panel.js';

    const host = document.createElement('div');
    document.body.appendChild(host);
    const { renderReading } = mountPanel(host, {
      rangeLowNote: 'F2',
      rangeHighNote: 'C3',
      targetNote: 'A2',
      referenceToneNote: 'A2',
    });

    // Simulate a slowly rising pitch so the "Too high" transition can be
    // checked visually without a microphone — this is what confirms the
    // gauge marker moves live above the ceiling instead of freezing.
    let hz = 90;
    setInterval(() => {
      hz += 5;
      if (hz > 250) hz = 90;
      renderReading({ hz, confidence: 0.9, rms: 0.03 });
    }, 500);
  </script>
</body>
</html>
```

- [ ] **Step 4: Manual verification on the mock page**

1. From the project root: `python3 -m http.server 8123`
2. Open `http://localhost:8123/mock/meet.html`
3. Confirm the panel appears, the gauge marker rises smoothly from the bottom of the shaded band, through the ceiling line, into the unshaded zone — and that the verdict word switches from "Good" to "Too high" exactly when it crosses the ceiling, live, without ever freezing.
4. Click `⋯` → confirm the details view shows, with live Hz+note, incrementing "voiced" count, and a chart line being drawn.
5. Click `←` → confirm it returns to the call-time face.
6. Click "Hear your tone" → confirm audio plays and the gauge stops updating for roughly a second, then resumes.

Expected: all six checks pass. This is the direct visual confirmation of the gate-fix regression test from the detection-engine plan — if the marker freezes instead of continuing to move above the ceiling, something has regressed.

- [ ] **Step 5: Live Meet call verification**

1. Complete onboarding in a real Meet tab context (or `chrome.storage.local` already populated from the extension-shell plan's Task 4).
2. Load the unpacked extension at `chrome://extensions`.
3. Join a real Google Meet call, headphones on, ideally with another participant.
4. Confirm the panel appears automatically, with **no second microphone permission prompt**.
5. Talk normally → confirm the gauge and volume meter respond.
6. Speak or shout well above your chosen ceiling → confirm "Too high" shows live (not frozen) — this is the one thing the mock page's synthetic sweep can suggest but can't fully prove, since a mock reading is scripted, not really your voice.
7. Click "Hear your tone" → confirm it's audible only to you (ask the other participant to confirm they didn't hear it), and that analysis visibly pauses and resumes.
8. Leave the call → confirm the panel disappears and your OS/browser microphone-in-use indicator turns off.

Expected: all eight checks pass. If step 4 shows a second permission prompt, that's a regression from the confirmed 2026-08-14 spike result — stop and investigate rather than assuming it's fine.

- [ ] **Step 6: Commit**

```bash
git add extension/content.js mock/meet.html manifest.json
git commit -m "Wire content script to panel and audio pipeline; add mock page"
```

---

## Self-Review

**Spec coverage:**
- Call-time face: gauge, verdict words, volume meter, "Hear your tone" → Task 5 ✓
- "Too high" as a live state, not frozen (the core bug fix) → Task 5 (code) + Task 7 Steps 4/5 (the actual visual/live proof) ✓
- Details view: range/target/reference-tone pickers, volume calibration, live Hz+note, gate counts, history chart → Task 6 ✓
- Reference tone plays to output only, pauses analysis, resumes after `TONE_RESUME_DELAY_MS` → Task 5, using the config constant rather than a hardcoded number ✓
- Single ISOLATED-world content script, no bridge → Task 7, consistent with the confirmed spike result recorded in the design spec ✓
- No second mic prompt → Task 7 Step 5 explicitly checks this and calls out what to do if it regresses ✓
- Panel/mic teardown on leaving a call → Task 7 `teardownPanel()` + Step 5 checklist item 8 ✓

**Placeholder scan:** No TBD/TODO. Task 4's "if `addModule` throws" branch is a concrete, named contingency with an exact fallback action, not a vague catch-all.

**Type consistency:** `mountPanel(hostElement, setup)` signature and its `{renderReading}` return match between Task 5's definition, Task 6's extension of the same function, Task 7's `content.js` caller, and `mock/meet.html`'s caller. `classifyFrame`'s `{category, hz}` output (detection-engine plan) is consumed identically in Task 5/6's `renderReading`. `computeCeilingFromSamples` (Task 6) and `volumeVerdict`/`volumeLevel` (Task 1) both take a `ceilingRms`-shaped number — confirmed no mismatched units (both are raw RMS, not dB).

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-15-fndmntl-incall-panel.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
