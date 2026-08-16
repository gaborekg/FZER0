import { volumeLevel, volumeVerdict } from '../../src/gauge.js';
import { noteToHz, notesInRange, hzToNote, isValidRange, RANGE_BAND_NOTES } from '../../src/note-hz.js';
import { createNoiseFloor } from '../../src/noise-floor.js';
import { classifyFrame } from '../../src/gate.js';
import { createSessionRecorder } from '../../src/session-recorder.js';
import { createTonePlayer } from '../../src/tone-player.js';
import {
  createRunningMean,
  createPitchAverage,
  createWindowedMean,
  createWindowedPitchAverage,
  createDecayingHistogram,
} from '../../src/stats.js';
import { dbFromLevel, buildDbMeterSvg } from '../../src/db-meter.js';
import { computeCeilingFromSamples, computeTypicalFromSamples } from '../../src/volume-calibration.js';
import { toneGainFor, DEFAULT_TONE_VOLUME } from '../../src/tone-gain.js';
import { createPrefsStore } from '../../src/prefs.js';
import { exportSettings } from '../../src/settings-transfer.js';
import { VOLUME_CEILING_RMS, TONE_RESUME_DELAY_MS, ASSUMED_TYPICAL_RMS } from '../../src/config.js';

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
        <div class="db-meter" data-el="db-meter" role="img" aria-label="Volume dial"></div>
      </div>
    </section>

    <section class="group">
      <div class="group-head">
        <h2>Frequency <span class="range-note" data-el="range-note"></span></h2>
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
    <p class="visually-hidden" data-el="live-announcement" aria-live="polite"></p>
  </div>

  <div class="details" data-view="details" hidden>
    <div class="group-head">
      <h2 tabindex="-1" data-el="details-heading">Settings</h2>
      <button class="icon-button" data-action="close-details" aria-label="Back">←</button>
    </div>

    <div class="card">
      <h3 class="sub-title">This call</h3>
      <dl class="summary">
        <dt>Talking</dt><dd data-el="sum-talking">—</dd>
        <dt>Average pitch</dt><dd data-el="sum-pitch">—</dd>
        <dt>In range</dt><dd data-el="sum-zone">—</dd>
        <dt>Average volume</dt><dd data-el="sum-volume">—</dd>
      </dl>
      <p class="hint" data-el="sum-note">Saved when you leave the call.</p>
    </div>

    <div class="card">
      <h3 class="sub-title">Your range</h3>
      <label class="field">
        <span>Lowest note</span>
        <select data-field="rangeLowNote"></select>
      </label>
      <label class="field">
        <span>Highest note</span>
        <select data-field="rangeHighNote"></select>
      </label>
      <label class="field">
        <span>Target note</span>
        <select data-field="targetNote"></select>
      </label>
      <button class="wide-button primary" data-action="save-range">Save</button>
    </div>

    <div class="card">
      <h3 class="sub-title">Speaking level</h3>
      <p class="hint">Talk normally for five seconds. Sets your target and how loud your tone plays.</p>
      <div class="level" aria-hidden="true"><span data-el="level-fill"></span></div>
      <button class="wide-button" data-action="calibrate-volume">Talk normally, then set it</button>
    </div>

    <div class="card">
      <h3 class="sub-title">Tone volume</h3>
      <p class="hint">No browser can tell how loud your headphones are, so this part is yours.</p>
      <div class="slider-row">
        <input class="slider" type="range" min="0.2" max="1.4" step="0.05"
               data-field="toneVolume" aria-label="Tone volume" />
        <span class="slider-value" data-el="tone-volume-value">100%</span>
      </div>
    </div>

    <div class="card">
      <h3 class="sub-title">Move your setup</h3>
      <p class="hint">
        The extension and the web app keep separate storage, so your notes and
        calibration do not travel on their own.
      </p>
      <button class="wide-button" data-action="export-settings">Download settings file</button>
    </div>
  </div>
  </div>
`;


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

// Full width on the calibration level bar at a comfortably loud voice.
// Feedback only — nothing measured depends on it.
const LEVEL_BAR_FULL_RMS = 0.06;

// How far the panel moves per arrow-key press.
const NUDGE_PX = 16;

function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

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
  let recorder = createSessionRecorder(RANGE_BAND_NOTES);
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

  let volumeCeilingRms = VOLUME_CEILING_RMS;
  let typicalRms = ASSUMED_TYPICAL_RMS;
  let toneVolume = DEFAULT_TONE_VOLUME;
  let toneGain = toneGainFor({});
  let calibrating = false;
  let calibrationSamples = [];

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
  let announcedNote = null;

  function playTone(note) {
    tonePlayer.play(note, {
      gain: toneGain,
      onStart: () => {
        analysisPaused = true;
        // The pause is necessary — otherwise the panel measures its own tone.
        // Showing it is what stops a frozen needle reading as a bug.
        panelEl.classList.add('is-muted');
      },
      onEnd: () => {
        setTimeout(() => {
          analysisPaused = false;
          panelEl.classList.remove('is-muted');
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
  const levelFillEl = shadow.querySelector('[data-el="level-fill"]');
  const toneVolumeInput = shadow.querySelector('[data-field="toneVolume"]');
  const toneVolumeValueEl = shadow.querySelector('[data-el="tone-volume-value"]');

  // Enough to say how long the voice has actually been going, without keeping
  // a second copy of everything the recorder already holds.
  const talkingTime = (() => {
    let firstAtMs = null;
    let lastAtMs = null;
    let voiced = 0;
    let total = 0;
    return {
      observe(isVoiced, nowMs) {
        if (firstAtMs === null) firstAtMs = nowMs;
        lastAtMs = nowMs;
        total += 1;
        if (isVoiced) voiced += 1;
      },
      spokenMs() {
        if (total === 0) return 0;
        return (lastAtMs - firstAtMs) * (voiced / total);
      },
    };
  })();

  let zoneNotes = new Set();
  function markTargetZone(lowNote, highNote, targetNote) {
    zoneNotes = new Set(isValidRange(lowNote, highNote) ? notesInRange(lowNote, highNote) : []);
    setAll(all('range-note'), zoneNotes.size > 0 ? `· ${lowNote}–${highNote}` : '');
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

    all('db-meter').forEach((meter) =>
      meter.setAttribute('aria-label', currentDb === null ? 'Volume dial, no reading' : `Volume ${Math.round(currentDb)} decibels`)
    );

    // Only when the note changes: a live region firing four times a second
    // makes a screen reader unusable.
    if (currentNote !== announcedNote) {
      announcedNote = currentNote;
      setAll(all('live-announcement'), currentNote ? `${currentNote}, ${Math.round(currentDb)} decibels` : '');
    }

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
    toneGain = toneGainFor({ toneVolume });
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
      if (prefs) await prefs.saveCalibration({ volumeCeilingRms, typicalRms, toneVolume });
    }, 5000);
  });

  function renderReading(reading) {
    if (analysisPaused) return;

    if (calibrating) {
      calibrationSamples.push(reading.rms);
      // Five seconds of an unchanging bar is how you find out the microphone
      // is dead, instead of calibrating against silence and being told it
      // worked.
      levelFillEl.style.width = `${Math.min(1, reading.rms / LEVEL_BAR_FULL_RMS) * 100}%`;
    }

    // One clock reading for the whole frame. Calling Date.now() separately
    // per accumulator lets them straddle a millisecond boundary and evict on
    // slightly different clocks, which shows up as the bars and the "1 min"
    // average disagreeing for no visible reason.
    const nowMs = Date.now();

    noiseFloor.addSample(reading.rms, nowMs);
    const floorRms = noiseFloor.getFloor();
    const classified = classifyFrame(reading, { floorRms });

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
    recorder.observe({ note: voicedNote, hz: classified.hz, db: currentDb }, nowMs);
    talkingTime.observe(voicedNote !== null, nowMs);
    if (voicedNote === null) return;

    volumeDbCallAverage.add(currentDb);
    pitchCallAverage.add(classified.hz);
    volumeDbMinuteAverage.add(currentDb, nowMs);
    pitchMinuteAverage.add(classified.hz, nowMs);
    currentNote = voicedNote;

  }

  // Exactly one of face / mini / details is ever visible.
  let currentView = 'face';
  function showView(name) {
    ['face', 'mini', 'details'].forEach((view) => {
      shadow.querySelector(`[data-view="${view}"]`).hidden = view !== name;
    });
    currentView = name;

    if (name === 'details') {
      renderSummary();
      // Focus was on a button that has just been hidden, so it would fall back
      // to the Meet page — and the next Tab press would wander into Meet's own
      // controls rather than the settings just opened.
      shadow.querySelector('[data-el="details-heading"]').focus();
    } else {
      panelEl.focus();
    }
    savePlacement();
  }

  // What the call has come to so far, in the words a person would use. The
  // four frame counters this replaced were written for whoever was debugging
  // the detector.
  function renderSummary() {
    const nowMs = Date.now();
    const spokenMs = talkingTime.spokenMs(nowMs);
    const averageHz = pitchCallAverage.meanHz();
    const averageDb = volumeDbCallAverage.mean();
    const zoneShare = histogram.shareOf(zoneNotes);

    setAll(all('sum-talking'), formatDuration(spokenMs));
    setAll(all('sum-pitch'), averageHz === null ? '—' : `${hzToNote(averageHz)} · ${Math.round(averageHz)} Hz`);
    setAll(all('sum-zone'), zoneShare === null ? '—' : `${Math.round(zoneShare * 100)}%`);
    setAll(all('sum-volume'), averageDb === null ? '—' : `${Math.round(averageDb)} dB`);
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

  function showToneVolume() {
    toneVolumeValueEl.textContent = `${Math.round(Number(toneVolumeInput.value) * 100)}%`;
  }

  toneVolumeInput.value = toneVolume;
  showToneVolume();
  toneVolumeInput.addEventListener('input', showToneVolume);
  toneVolumeInput.addEventListener('change', async () => {
    toneVolume = Number(toneVolumeInput.value);
    toneGain = toneGainFor({ toneVolume });
    if (prefs) await prefs.saveCalibration({ volumeCeilingRms, typicalRms, toneVolume });
  });

  shadow.querySelector('[data-action="export-settings"]').addEventListener('click', async () => {
    const [setup, calibration] = await Promise.all([
      prefs?.getSetup() ?? {},
      prefs?.getCalibration() ?? {},
    ]);
    const json = exportSettings({ ...setup, ...calibration });
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fzer0-settings.json';
    link.click();
    URL.revokeObjectURL(url);
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

  // Where you put the panel, and whether you had it minimised, survive the
  // call. Otherwise it returns to the top-right corner — over Meet's own
  // controls — every single time, and you move it again.
  function savePlacement() {
    if (!prefs) return;
    const rect = panelEl.getBoundingClientRect();
    prefs.savePlacement({
      left: panelEl.style.left ? Math.round(rect.left) : null,
      top: panelEl.style.left ? Math.round(rect.top) : null,
      view: currentView === 'details' ? 'face' : currentView,
    });
  }

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
    savePlacement();
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

  // Dragging is pointer-only, which leaves anyone working by keyboard unable
  // to move a panel that is covering something they need.
  panelEl.setAttribute('tabindex', '0');
  panelEl.addEventListener('keydown', (event) => {
    const step = {
      ArrowLeft: [-NUDGE_PX, 0],
      ArrowRight: [NUDGE_PX, 0],
      ArrowUp: [0, -NUDGE_PX],
      ArrowDown: [0, NUDGE_PX],
    }[event.key];
    if (!step || event.target !== panelEl) return;

    event.preventDefault();
    const rect = panelEl.getBoundingClientRect();
    const { left, top } = clampToViewport(rect.left + step[0], rect.top + step[1]);
    panelEl.style.right = 'auto';
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    savePlacement();
  });

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
  if (prefs) {
    prefs.getPlacement().then(({ left, top, view }) => {
      if (left !== null && top !== null) {
        const placed = clampToViewport(left, top);
        panelEl.style.right = 'auto';
        panelEl.style.left = `${placed.left}px`;
        panelEl.style.top = `${placed.top}px`;
      }
      if (view === 'mini') showView('mini');
    });
  }

  // The call is the thing being measured, so leaving it is when the record
  // gets written. Nothing else in the extension was keeping anything.
  async function saveSession() {
    const summary = recorder.finish({
      zoneNotes: [...zoneNotes],
      rangeLowNote: rangeLowSelect.value,
      rangeHighNote: rangeHighSelect.value,
      targetNote: targetSelect.value,
    });
    recorder = createSessionRecorder(RANGE_BAND_NOTES);
    if (summary && prefs) await prefs.addSession(summary);
  }

  function unmount() {
    saveSession();
    clearInterval(readoutTimer);
    window.removeEventListener('resize', keepOnScreen);
  }

  return { renderReading, unmount };
}
