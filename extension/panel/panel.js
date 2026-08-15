import { volumeLevel, volumeVerdict } from '../../src/gauge.js';
import { noteToHz, notesInRange, hzToNote, isValidRange, RANGE_BAND_NOTES } from '../../src/note-hz.js';
import { createNoiseFloor } from '../../src/noise-floor.js';
import { classifyFrame } from '../../src/gate.js';
import { createSession } from '../../src/session.js';
import { createTonePlayer } from '../../src/tone-player.js';
import {
  createRunningMean,
  createPitchAverage,
  createWindowedMean,
  createWindowedPitchAverage,
  createDecayingHistogram,
} from '../../src/stats.js';
import { computeCeilingFromSamples, computeTypicalFromSamples } from '../../src/volume-calibration.js';
import { createPrefsStore } from '../../src/prefs.js';
import { VOLUME_CEILING_RMS, TONE_RESUME_DELAY_MS } from '../../src/config.js';

const PANEL_HTML = `
  <div class="panel" data-el="panel">
  <div class="mini" data-view="mini" hidden>
    <section class="mini-group">
      <h2>Volume</h2>
      <div class="card mini-card">
        <div class="stat">
          <span class="stat-label">Current</span>
          <span class="stat-value" data-el="volume-current">—</span>
        </div>
        <div class="db-meter" data-el="db-meter"></div>
      </div>
    </section>

    <section class="mini-group">
      <h2>Frequency</h2>
      <div class="card mini-card">
        <div class="stat">
          <span class="stat-label">Current</span>
          <span class="stat-value" data-el="pitch-current">—</span>
        </div>
        <div class="stat">
          <span class="stat-label">Average</span>
          <div class="stat-rows">
            <span class="row-label">1 min</span>
            <span class="row-value" data-el="pitch-average-minute">—</span>
            <span class="row-label">call</span>
            <span class="row-value" data-el="pitch-average-call">—</span>
          </div>
        </div>
      </div>
    </section>

    <button class="icon-button mini-expand" data-action="expand" aria-label="Expand">▣</button>
  </div>

  <div class="face" data-view="face">
    <section class="group">
      <div class="group-head">
        <h2>Volume</h2>
        <span class="head-buttons">
          <button class="icon-button" data-action="minimize" aria-label="Minimize">–</button>
          <button class="icon-button" data-action="open-details">⋯</button>
        </span>
      </div>
      <div class="card volume-card">
        <div class="stat-column">
          <div class="stat">
            <span class="stat-label">Current</span>
            <span class="stat-value" data-el="volume-current">—</span>
          </div>
          <div class="stat">
            <span class="stat-label">Average</span>
            <div class="stat-rows">
              <span class="row-label">1 min</span>
              <span class="row-value" data-el="volume-average-minute">—</span>
              <span class="row-label">call</span>
              <span class="row-value" data-el="volume-average-call">—</span>
            </div>
          </div>
          <div class="stat stat-target">
            <span class="stat-label">Target</span>
            <span class="stat-value" data-el="volume-target">—</span>
          </div>
        </div>
        <div class="db-meter" data-el="db-meter"></div>
      </div>
    </section>

    <section class="group">
      <div class="group-head">
        <h2>Frequency</h2>
      </div>
      <div class="card frequency-card">
        <div class="stat-column">
          <div class="stat">
            <span class="stat-label">Current</span>
            <span class="stat-value" data-el="pitch-current">—</span>
          </div>
          <div class="stat">
            <span class="stat-label">Average</span>
            <div class="stat-rows">
              <span class="row-label">1 min</span>
              <span class="row-value" data-el="pitch-average-minute">—</span>
              <span class="row-label">call</span>
              <span class="row-value" data-el="pitch-average-call">—</span>
            </div>
          </div>
          <div class="stat stat-zone">
            <span class="stat-label">In zone</span>
            <span class="stat-value" data-el="zone-share">—</span>
          </div>
        </div>
        <div class="note-bars" data-el="note-bars"></div>
      </div>
    </section>
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
    <button data-action="save-range">Save range/target</button>
    <button data-action="calibrate-volume">Talk normally, then set it</button>
  </div>
  </div>
`;

const DB_MIN = 20;
const DB_MAX = 130;
const DB_MAJOR_STEP = 10;
const DB_MINORS_PER_MAJOR = 5;

// The Current/Average dB numbers are derived from the very same 0..1 level
// that rotates the needle, so the readout can never disagree with the dial.
function dbFromLevel(level) {
  return DB_MIN + level * (DB_MAX - DB_MIN);
}

// Geometry of the analog VU face. The needle sweeps the top half-circle:
// 180° points at DB_MIN (left), 0° at DB_MAX (right).
const METER = {
  cx: 120,
  cy: 128,
  rArc: 108,
  rMajorInner: 96,
  rMinorInner: 102,
  rLabel: 84,
  rBandArc: 60,
};

function meterAngleRad(db) {
  const fraction = (db - DB_MIN) / (DB_MAX - DB_MIN);
  return ((180 - fraction * 180) * Math.PI) / 180;
}

function meterPoint(db, radius) {
  const angle = meterAngleRad(db);
  return {
    x: METER.cx + radius * Math.cos(angle),
    y: METER.cy - radius * Math.sin(angle),
  };
}

function buildDbMeterSvg() {
  let ticks = '';
  let labels = '';

  const minorStep = DB_MAJOR_STEP / DB_MINORS_PER_MAJOR;
  for (let db = DB_MIN; db <= DB_MAX + 0.001; db += minorStep) {
    const isMajor = Math.abs(db % DB_MAJOR_STEP) < 0.001;
    const inner = meterPoint(db, isMajor ? METER.rMajorInner : METER.rMinorInner);
    const outer = meterPoint(db, METER.rArc);
    ticks +=
      `<line x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" ` +
      `x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" ` +
      `stroke="#1a1a1a" stroke-width="${isMajor ? 1.6 : 0.8}" />`;

    if (isMajor) {
      const at = meterPoint(db, METER.rLabel);
      // Rotate each number so it sits tangent to the arc, as on a real dial.
      const rotation = 90 - (meterAngleRad(db) * 180) / Math.PI;
      labels +=
        `<text x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}" font-size="11" ` +
        `text-anchor="middle" dominant-baseline="middle" fill="#1a1a1a" ` +
        `transform="rotate(${rotation.toFixed(1)} ${at.x.toFixed(1)} ${at.y.toFixed(1)})">${Math.round(db)}</text>`;
    }
  }

  // The comfortable-speaking band drawn inside the dial: a light arc from
  // MIN to MAX with a peak mark at its centre, mirroring the reference face.
  const bandStart = meterPoint(35, METER.rBandArc);
  const bandEnd = meterPoint(80, METER.rBandArc);
  const bandPeak = meterPoint(57, METER.rBandArc + 12);
  const bandPeakLeft = meterPoint(52, METER.rBandArc);
  const bandPeakRight = meterPoint(62, METER.rBandArc);
  const minLabel = meterPoint(31, METER.rBandArc - 10);
  const maxLabel = meterPoint(86, METER.rBandArc - 4);

  const needleTip = METER.cy - (METER.rArc - 6);

  return `
    <svg viewBox="0 0 240 172" class="db-meter-svg">
      <path d="M ${(METER.cx - METER.rArc).toFixed(1)} ${METER.cy}
               A ${METER.rArc} ${METER.rArc} 0 0 1 ${(METER.cx + METER.rArc).toFixed(1)} ${METER.cy}"
            fill="none" stroke="#1a1a1a" stroke-width="1.6" />
      ${ticks}
      ${labels}

      <path d="M ${bandStart.x.toFixed(1)} ${bandStart.y.toFixed(1)}
               A ${METER.rBandArc} ${METER.rBandArc} 0 0 1 ${bandEnd.x.toFixed(1)} ${bandEnd.y.toFixed(1)}"
            fill="none" stroke="#8b8f95" stroke-width="0.9" />
      <polyline points="${bandPeakLeft.x.toFixed(1)},${bandPeakLeft.y.toFixed(1)}
                        ${bandPeak.x.toFixed(1)},${bandPeak.y.toFixed(1)}
                        ${bandPeakRight.x.toFixed(1)},${bandPeakRight.y.toFixed(1)}"
                fill="none" stroke="#8b8f95" stroke-width="0.9" />
      <text x="${minLabel.x.toFixed(1)}" y="${minLabel.y.toFixed(1)}" font-size="7" fill="#8b8f95"
            text-anchor="middle" transform="rotate(-60 ${minLabel.x.toFixed(1)} ${minLabel.y.toFixed(1)})">MIN</text>
      <text x="${maxLabel.x.toFixed(1)}" y="${maxLabel.y.toFixed(1)}" font-size="7" fill="#8b8f95"
            text-anchor="middle">MAX</text>

      <text x="${METER.cx}" y="${METER.cy + 26}" font-size="17" font-weight="700"
            text-anchor="middle" fill="#1a1a1a">dB</text>

      <line data-el="target-mark" x1="${METER.cx}" y1="${METER.cy - 42}" x2="${METER.cx}" y2="${needleTip}"
            stroke="#2b6b4a" stroke-width="2.5" stroke-linecap="round"
            style="transform-origin: ${METER.cx}px ${METER.cy}px;" />

      <line data-el="needle" x1="${METER.cx}" y1="${METER.cy + 14}" x2="${METER.cx}" y2="${needleTip}"
            stroke="#d32f2f" stroke-width="2" style="transform-origin: ${METER.cx}px ${METER.cy}px;" />
      <circle cx="${METER.cx}" cy="${METER.cy}" r="4.5" fill="#d32f2f" />

      <rect data-el="peak-light" x="196" y="152" width="8" height="8" fill="none" stroke="#1a1a1a" stroke-width="0.9" />
      <rect data-el="peak-light" x="208" y="152" width="8" height="8" fill="none" stroke="#1a1a1a" stroke-width="0.9" />
      <rect data-el="peak-light" x="220" y="152" width="8" height="8" fill="none" stroke="#1a1a1a" stroke-width="0.9" />
    </svg>
  `;
}

// The needle may twitch every frame — that's what analog meters do. A NUMBER
// flipping twenty times a second is just unreadable, so the four readouts and
// the bars refresh on a slow timer instead of on every audio frame.
const READOUT_INTERVAL_MS = 250;

// How fast the bars forget. Each note's weight halves every 10 seconds, so a
// pause of a few seconds visibly softens the chart and half a minute of
// silence empties it — the bars show where the voice IS, not where it has
// been all call.
const NOTE_DECAY_HALF_LIFE_MS = 10_000;

// "The last minute" for the recent averages, alongside the call-long ones.
const RECENT_WINDOW_MS = 60_000;

// A default reference-tone loudness, personalized once the user calibrates
// via "Talk normally, then set it" — browsers can't read the system/
// headphone volume directly, so this scales relative to the user's own
// measured typical speaking level instead of a fixed preset.
//
// It doubles as the volume TARGET. Speech therapy's standing recommendation
// for everyday speaking is comfortable habitual loudness — loud enough to
// carry, never pushed — and there is no way to check that against an absolute
// dB SPL figure here: the browser exposes no sound-pressure reading, and this
// dial's scale runs from the room's noise floor to the user's own ceiling, not
// from silence to 130 dB SPL. Printing a textbook "60 dB" on it would be a
// number with nothing behind it. Anchoring the target to the user's measured
// comfortable level is the same clinical advice, on a scale that is real here.
const ASSUMED_TYPICAL_RMS = 0.02;
const DEFAULT_TONE_GAIN = 0.2;
const MIN_TONE_GAIN = 0.05;
const MAX_TONE_GAIN = 0.6;

export function mountPanel(hostElement, setup) {
  const shadow = hostElement.attachShadow({ mode: 'open' });

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('./panel.css', import.meta.url).href;
  shadow.appendChild(style);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = PANEL_HTML;
  shadow.appendChild(wrapper);

  let rangeLowHz = noteToHz(setup.rangeLowNote);
  let rangeHighHz = noteToHz(setup.rangeHighNote);

  const noiseFloor = createNoiseFloor();
  const session = createSession();
  const tonePlayer = createTonePlayer();

  let analysisPaused = false;

  // The face and the minimized strip both show some of the same figures, so a
  // readout is addressed by name and every copy of it updates together —
  // rather than each view keeping its own element and its own chance to drift.
  const all = (name) => shadow.querySelectorAll(`[data-el="${name}"]`);
  const setAll = (nodes, text) => nodes.forEach((node) => { node.textContent = text; });

  // Both views carry their own dial: one SVG can't be in two places.
  all('db-meter').forEach((meter) => { meter.innerHTML = buildDbMeterSvg(); });
  const needleEls = all('needle');
  const targetMarkEls = all('target-mark');
  const peakLightEls = all('peak-light');

  const noteBarsEl = shadow.querySelector('[data-el="note-bars"]');
  const volumeCurrentEls = all('volume-current');
  const volumeTargetEls = all('volume-target');
  const volumeAverageMinuteEls = all('volume-average-minute');
  const volumeAverageCallEls = all('volume-average-call');
  const pitchCurrentEls = all('pitch-current');
  const pitchAverageMinuteEls = all('pitch-average-minute');
  const pitchAverageCallEls = all('pitch-average-call');
  const zoneShareEls = all('zone-share');
  const liveHzEl = shadow.querySelector('[data-el="live-hz"]');
  const countEls = {
    voiced: shadow.querySelector('[data-el="count-voiced"]'),
    'too-quiet': shadow.querySelector('[data-el="count-too-quiet"]'),
    'no-pitch': shadow.querySelector('[data-el="count-no-pitch"]'),
    'out-of-range': shadow.querySelector('[data-el="count-out-of-range"]'),
  };

  let volumeCeilingRms = VOLUME_CEILING_RMS;
  let typicalRms = ASSUMED_TYPICAL_RMS;
  let toneGain = DEFAULT_TONE_GAIN;
  let calibrating = false;
  let calibrationSamples = [];

  const historyCanvas = shadow.querySelector('[data-el="history-chart"]');
  const rangeLowSelect = shadow.querySelector('[data-field="rangeLowNote"]');
  const rangeHighSelect = shadow.querySelector('[data-field="rangeHighNote"]');
  const targetSelect = shadow.querySelector('[data-field="targetNote"]');
  let prefs = null;
  try {
    prefs = createPrefsStore();
  } catch {
    // No chrome.storage available — e.g. the offline mock page. Saving
    // range/target edits from the details view is a no-op there.
  }

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

  // Averages cover the SPOKEN part of the call only. Folding silence into the
  // volume average would drag it down to the noise floor and pin it there.
  const volumeDbCallAverage = createRunningMean();
  const pitchCallAverage = createPitchAverage();
  const volumeDbMinuteAverage = createWindowedMean(RECENT_WINDOW_MS);
  const pitchMinuteAverage = createWindowedPitchAverage(RECENT_WINDOW_MS);

  let currentDb = null;
  let targetDb = null;
  // Held, not cleared: pausing between sentences shouldn't blank the readout.
  let currentNote = null;

  function playTone(note) {
    tonePlayer.play(note, {
      gain: toneGain,
      onStart: () => {
        analysisPaused = true;
      },
      onEnd: () => {
        setTimeout(() => {
          analysisPaused = false;
        }, TONE_RESUME_DELAY_MS);
      },
    });
  }

  // One bar per note, lowest pitch on the left.
  //
  // The chart covers the WHOLE band, not the user's saved range. A range of
  // F2–A2 would draw five bars, and a voice at D#2 or D#3 — perfectly normal
  // speech — would have no bar to land on and simply vanish from the chart.
  // The saved range still drives the details-view history plot; here, showing
  // everything the detector can hear is the point.
  const histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
  const fillByNote = new Map();
  const columnByNote = new Map();

  function buildBars() {
    noteBarsEl.innerHTML = '';
    fillByNote.clear();
    columnByNote.clear();

    RANGE_BAND_NOTES.forEach((note) => {
      const column = document.createElement('div');
      column.className = 'note-bar';
      column.innerHTML = `
        <button type="button" class="bar-track" data-play-note="${note}" aria-label="Play ${note}">
          <span class="bar-fill"></span>
        </button>
        <span class="bar-label" data-accidental="${note.includes('#')}">${note}</span>
      `;
      noteBarsEl.appendChild(column);
      fillByNote.set(note, column.querySelector('.bar-fill'));
      columnByNote.set(note, column);
    });

    noteBarsEl.querySelectorAll('[data-play-note]').forEach((button) => {
      button.addEventListener('click', () => playTone(button.dataset.playNote));
    });
  }

  // The chart spans the whole band; this tints the slice of it the user is
  // actually aiming for, with the single target note outlined inside it. The
  // bars themselves are untouched — the zone is a backdrop, so a bar can be
  // read as inside or outside it at a glance.
  let zoneNotes = new Set();
  function markTargetZone(lowNote, highNote, targetNote) {
    zoneNotes = new Set(isValidRange(lowNote, highNote) ? notesInRange(lowNote, highNote) : []);
    columnByNote.forEach((column, note) => {
      column.classList.toggle('in-zone', zoneNotes.has(note));
      column.classList.toggle('is-target', note === targetNote);
    });
  }

  buildBars();
  markTargetZone(setup.rangeLowNote, setup.rangeHighNote, setup.targetNote);

  function renderReadouts() {
    const nowMs = Date.now();
    const dbText = currentDb === null ? '—' : `${Math.round(currentDb)}dB`;
    const asDb = (db) => (db === null ? '—' : `${Math.round(db)}dB`);
    const asNote = (hz) => (hz === null ? '—' : hzToNote(hz));

    // Short text nodes — cheap enough to keep in sync even when hidden, so
    // switching views never shows a stale value for a quarter-second.
    setAll(volumeCurrentEls, dbText);
    setAll(volumeAverageMinuteEls, asDb(volumeDbMinuteAverage.mean(nowMs)));
    setAll(volumeAverageCallEls, asDb(volumeDbCallAverage.mean()));
    setAll(volumeTargetEls, asDb(targetDb));
    setAll(pitchCurrentEls, currentNote ?? '—');
    setAll(pitchAverageMinuteEls, asNote(pitchMinuteAverage.meanHz(nowMs)));
    setAll(pitchAverageCallEls, asNote(pitchCallAverage.meanHz()));

    const zoneShare = histogram.shareOf(zoneNotes);
    setAll(zoneShareEls, zoneShare === null ? '—' : `${Math.round(zoneShare * 100)}%`);

    // The bars are the expensive part — 18 style writes. Skip them whenever
    // the face isn't the visible view.
    if (shadow.querySelector('[data-view="face"]').hidden) return;

    const heights = histogram.heights();
    fillByNote.forEach((fillEl, note) => {
      fillEl.style.height = `${heights.get(note) * 100}%`;
    });
  }

  const readoutTimer = setInterval(renderReadouts, READOUT_INTERVAL_MS);

  shadow.querySelector('[data-action="save-range"]').addEventListener('click', async () => {
    const lowNote = rangeLowSelect.value;
    const highNote = rangeHighSelect.value;
    // A zero-width or inverted range would divide by zero in the gauge math
    // and throw out of notesInRange — refuse it rather than break the panel.
    if (!isValidRange(lowNote, highNote)) return;

    // The bar chart is fixed to the whole band, so it needs no rebuild — only
    // the details-view history plot follows the saved range.
    rangeLowHz = noteToHz(lowNote);
    rangeHighHz = noteToHz(highNote);
    populateSelect(targetSelect, notesInRange(lowNote, highNote), targetSelect.value);
    markTargetZone(lowNote, highNote, targetSelect.value);

    if (!prefs) return;
    await prefs.saveSetup({
      rangeLowNote: lowNote,
      rangeHighNote: highNote,
      targetNote: targetSelect.value,
    });
  });

  // toneGain is derived, never stored: keeping only the two measurements means
  // there is one source of truth, and a later change to this formula applies
  // to calibrations already saved.
  function applyCalibration(ceilingRms, measuredTypicalRms) {
    volumeCeilingRms = ceilingRms;
    typicalRms = measuredTypicalRms;
    toneGain = Math.max(
      MIN_TONE_GAIN,
      Math.min(MAX_TONE_GAIN, DEFAULT_TONE_GAIN * (typicalRms / ASSUMED_TYPICAL_RMS))
    );
  }

  // Sitting through the five-second calibration once per call is the kind of
  // chore that gets skipped, and skipping it leaves the target and the
  // reference tone on generic defaults.
  if (prefs) {
    prefs.getCalibration().then(({ volumeCeilingRms: savedCeiling, typicalRms: savedTypical }) => {
      if (savedCeiling === null || savedTypical === null) return;
      applyCalibration(savedCeiling, savedTypical);
    });
  }

  const calibrateButton = shadow.querySelector('[data-action="calibrate-volume"]');
  calibrateButton.addEventListener('click', () => {
    calibrating = true;
    calibrationSamples = [];
    // Five seconds of nothing happening reads as a dead button, and a user who
    // stops talking halfway through calibrates against their own silence.
    calibrateButton.disabled = true;
    calibrateButton.textContent = 'Listening — keep talking…';

    setTimeout(async () => {
      calibrating = false;
      calibrateButton.disabled = false;

      if (calibrationSamples.length === 0) {
        calibrateButton.textContent = 'Talk normally, then set it';
        return;
      }

      applyCalibration(
        computeCeilingFromSamples(calibrationSamples),
        computeTypicalFromSamples(calibrationSamples)
      );
      calibrateButton.textContent = 'Saved — set it again';
      if (prefs) await prefs.saveCalibration({ volumeCeilingRms, typicalRms });
    }, 5000);
  });

  function renderHistoryChart() {
    // The chart lives in the details view. Redrawing it on every audio frame
    // while that view is hidden copied and re-plotted an ever-growing history
    // ~20x a second, which is what made the panel lag over time.
    if (shadow.querySelector('[data-view="details"]').hidden) return;

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

  function renderReading(reading) {
    if (analysisPaused) return;

    if (calibrating) {
      calibrationSamples.push(reading.rms);
    }

    // One clock reading for the whole frame. Calling Date.now() separately
    // per accumulator lets them straddle a millisecond boundary and evict on
    // slightly different clocks, which shows up as the bars and the "1 min"
    // average disagreeing for no visible reason.
    const nowMs = Date.now();

    noiseFloor.addSample(reading.rms, nowMs);
    const floorRms = noiseFloor.getFloor();
    const classified = classifyFrame(reading, { floorRms });
    session.record(classified, nowMs);
    countEls[classified.category].textContent = session.getCounts()[classified.category];

    // The dB needle and peak lights track raw volume every frame, regardless
    // of whether a pitch was detected this frame.
    const level = volumeLevel(reading.rms, { floorRms, ceilingRms: volumeCeilingRms });
    const needleAngle = `rotate(${level * 180 - 90}deg)`;
    needleEls.forEach((needle) => { needle.style.transform = needleAngle; });
    currentDb = dbFromLevel(level);
    // The target sits on the same scale as the needle, and moves with the
    // room: it is a level, so a noisier room lifts it just as it lifts the
    // reading. The green mark shows the same value on the dial.
    const targetLevel = volumeLevel(typicalRms, { floorRms, ceilingRms: volumeCeilingRms });
    targetDb = dbFromLevel(targetLevel);
    const targetAngle = `rotate(${targetLevel * 180 - 90}deg)`;
    targetMarkEls.forEach((mark) => { mark.style.transform = targetAngle; });

    const isPeaking = volumeVerdict(reading.rms, volumeCeilingRms) === 'Too loud';
    peakLightEls.forEach((light) => {
      light.setAttribute('fill', isPeaking ? '#e53935' : 'none');
    });

    // The histogram sees every frame, silence included — that is how it knows
    // to fade the bars out when nobody is talking.
    const voicedNote = classified.category === 'voiced' ? hzToNote(classified.hz) : null;
    histogram.observe(voicedNote, nowMs);
    if (voicedNote === null) return;

    volumeDbCallAverage.add(currentDb);
    pitchCallAverage.add(classified.hz);
    volumeDbMinuteAverage.add(currentDb, nowMs);
    pitchMinuteAverage.add(classified.hz, nowMs);
    currentNote = voicedNote;

    liveHzEl.textContent = `${classified.hz.toFixed(1)} Hz (${currentNote})`;
    renderHistoryChart();
  }

  // Exactly one of face / mini / details is ever visible.
  function showView(name) {
    ['face', 'mini', 'details'].forEach((view) => {
      shadow.querySelector(`[data-view="${view}"]`).hidden = view !== name;
    });
  }

  const VIEW_BUTTONS = {
    'open-details': 'details',
    'close-details': 'face',
    minimize: 'mini',
    expand: 'face',
  };
  Object.entries(VIEW_BUTTONS).forEach(([action, view]) => {
    shadow
      .querySelector(`[data-action="${action}"]`)
      .addEventListener('click', () => showView(view));
  });

  // --- Dragging ----------------------------------------------------------
  //
  // Grab the panel anywhere that isn't itself interactive. The bars are
  // buttons and the details view is full of selects, so excluding those keeps
  // a click on a bar a click, not the start of a one-pixel drag.
  const panelEl = shadow.querySelector('[data-el="panel"]');
  const NON_DRAGGABLE = 'button, select, input, option, label';
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function clampToViewport(left, top) {
    const { width, height } = panelEl.getBoundingClientRect();
    return {
      // Always leave a strip on screen, so the panel can't be dragged
      // somewhere it can no longer be grabbed back from.
      left: Math.max(8 - width + 40, Math.min(window.innerWidth - 40, left)),
      top: Math.max(0, Math.min(window.innerHeight - 32, top)),
    };
  }

  function onPointerMove(event) {
    const { left, top } = clampToViewport(event.clientX - dragOffsetX, event.clientY - dragOffsetY);
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
  }

  function endDrag(event) {
    panelEl.releasePointerCapture(event.pointerId);
    panelEl.removeEventListener('pointermove', onPointerMove);
    panelEl.classList.remove('dragging');
  }

  // Shrinking the window can strand a dragged panel off-screen. While it is
  // still right-anchored, CSS handles this on its own — only an explicit
  // left offset needs pulling back.
  function keepOnScreen() {
    if (!panelEl.style.left) return;
    const rect = panelEl.getBoundingClientRect();
    const { left, top } = clampToViewport(rect.left, rect.top);
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
  }
  window.addEventListener('resize', keepOnScreen);

  panelEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(NON_DRAGGABLE)) return;

    // The panel starts anchored to the right edge. Dragging positions it from
    // the left instead, so both properties would fight — pin the current
    // on-screen position as a left offset and drop the right anchor.
    const rect = panelEl.getBoundingClientRect();
    panelEl.style.right = 'auto';
    panelEl.style.left = `${rect.left}px`;
    panelEl.style.top = `${rect.top}px`;
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;

    panelEl.classList.add('dragging');
    panelEl.setPointerCapture(event.pointerId);
    panelEl.addEventListener('pointermove', onPointerMove);
    panelEl.addEventListener('pointerup', endDrag, { once: true });
    panelEl.addEventListener('pointercancel', endDrag, { once: true });
  });

  // The caller removes the host element on Meet navigation. Without stopping
  // the readout timer first it would keep firing against detached nodes for
  // the rest of the tab's life.
  function unmount() {
    clearInterval(readoutTimer);
    window.removeEventListener('resize', keepOnScreen);
  }

  return { renderReading, unmount };
}
