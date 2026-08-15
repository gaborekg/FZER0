import { volumeLevel, volumeVerdict } from '../src/gauge.js';
import { noteToHz, notesInRange, hzToNote, isValidRange, RANGE_BAND_NOTES } from '../src/note-hz.js';
import { createNoiseFloor } from '../src/noise-floor.js';
import { classifyFrame } from '../src/gate.js';
import { createDecayingHistogram, createRunningMean } from '../src/stats.js';
import { createSessionRecorder } from '../src/session-recorder.js';
import { createTonePlayer } from '../src/tone-player.js';
import { buildDbMeterSvg, dbFromLevel } from '../src/db-meter.js';
import { VOLUME_CEILING_RMS, TONE_RESUME_DELAY_MS } from '../src/config.js';
import { startCapture } from './audio.js';

const READOUT_INTERVAL_MS = 250;
const NOTE_DECAY_HALF_LIFE_MS = 10_000;

// Matches the extension: the reference tone plays at the user's own measured
// speaking level, so matching it never means pushing the voice.
const ASSUMED_TYPICAL_RMS = 0.02;
const DEFAULT_TONE_GAIN = 0.2;
const MIN_TONE_GAIN = 0.05;
const MAX_TONE_GAIN = 0.6;

function toneGainFor(typicalRms) {
  if (!typicalRms) return DEFAULT_TONE_GAIN;
  return Math.max(
    MIN_TONE_GAIN,
    Math.min(MAX_TONE_GAIN, DEFAULT_TONE_GAIN * (typicalRms / ASSUMED_TYPICAL_RMS))
  );
}

export function createMeasureScreen(root, { store, onSessionSaved }) {
  const meterEl = root.querySelector('[data-el="db-meter"]');
  meterEl.innerHTML = buildDbMeterSvg();
  const needleEl = meterEl.querySelector('[data-el="needle"]');
  const targetMarkEl = meterEl.querySelector('[data-el="target-mark"]');
  const peakLightEls = meterEl.querySelectorAll('[data-el="peak-light"]');

  const barsEl = root.querySelector('[data-el="note-bars"]');
  const volumeCurrentEl = root.querySelector('[data-el="volume-current"]');
  const volumeAverageEl = root.querySelector('[data-el="volume-average"]');
  const pitchCurrentEl = root.querySelector('[data-el="pitch-current"]');
  const pitchAverageEl = root.querySelector('[data-el="pitch-average"]');
  const recordButton = root.querySelector('[data-action="toggle-recording"]');
  const statusEl = root.querySelector('[data-el="record-status"]');
  const playButton = root.querySelector('[data-action="play-tone"]');

  const tonePlayer = createTonePlayer();

  const fillByNote = new Map();
  const columnByNote = new Map();

  RANGE_BAND_NOTES.forEach((note) => {
    const column = document.createElement('div');
    column.className = 'note-bar';
    column.innerHTML = `
      <span class="bar-track"><span class="bar-fill"></span></span>
      <span class="bar-label">${note}</span>
    `;
    barsEl.appendChild(column);
    fillByNote.set(note, column.querySelector('.bar-fill'));
    columnByNote.set(note, column);
  });

  // --- state ---------------------------------------------------------------
  let profile = store.getProfile();
  let zoneNotes = [];
  let capture = null;
  let recorder = null;
  let readoutTimer = null;
  let analysisPaused = false;

  let noiseFloor = createNoiseFloor();
  let histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
  let volumeAverage = createRunningMean();
  let currentDb = null;
  let currentNote = null;

  function currentZone() {
    const { rangeLowNote, rangeHighNote } = profile;
    if (!rangeLowNote || !rangeHighNote || !isValidRange(rangeLowNote, rangeHighNote)) return [];
    return notesInRange(rangeLowNote, rangeHighNote);
  }

  function paintZone() {
    zoneNotes = currentZone();
    const zone = new Set(zoneNotes);
    columnByNote.forEach((column, note) => {
      column.classList.toggle('in-zone', zone.has(note));
      column.classList.toggle('is-target', note === profile.targetNote);
    });
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  // --- rendering -----------------------------------------------------------
  function renderReadouts() {
    volumeCurrentEl.textContent = currentDb === null ? '—' : `${Math.round(currentDb)}dB`;
    const average = volumeAverage.mean();
    volumeAverageEl.textContent = average === null ? '—' : `${Math.round(average)}dB`;
    pitchCurrentEl.textContent = currentNote ?? '—';

    const heights = histogram.heights();
    let busiest = null;
    let busiestHeight = 0;
    fillByNote.forEach((fillEl, note) => {
      const height = heights.get(note);
      fillEl.style.height = `${height * 100}%`;
      if (height > busiestHeight) {
        busiestHeight = height;
        busiest = note;
      }
    });
    pitchAverageEl.textContent = busiest ?? '—';

    columnByNote.forEach((column, note) => {
      column.classList.toggle('is-current', note === currentNote);
    });
  }

  function onFrame(reading) {
    if (analysisPaused) return;

    const nowMs = Date.now();
    noiseFloor.addSample(reading.rms, nowMs);
    const floorRms = noiseFloor.getFloor();
    const classified = classifyFrame(reading, { floorRms });

    const ceilingRms = profile.volumeCeilingRms ?? VOLUME_CEILING_RMS;
    const level = volumeLevel(reading.rms, { floorRms, ceilingRms });
    currentDb = dbFromLevel(level);
    needleEl.style.transform = `rotate(${level * 180 - 90}deg)`;

    const targetLevel = volumeLevel(profile.typicalRms ?? ASSUMED_TYPICAL_RMS, {
      floorRms,
      ceilingRms,
    });
    targetMarkEl.style.transform = `rotate(${targetLevel * 180 - 90}deg)`;

    const peaking = volumeVerdict(reading.rms, ceilingRms) === 'Too loud';
    peakLightEls.forEach((light) => light.setAttribute('fill', peaking ? '#e53935' : 'none'));

    const voicedNote = classified.category === 'voiced' ? hzToNote(classified.hz) : null;
    histogram.observe(voicedNote, nowMs);
    if (voicedNote !== null) {
      currentNote = voicedNote;
      volumeAverage.add(currentDb);
    }

    // The recorder is driven from here, not from the display timer: a
    // backgrounded tab throttles timers to a crawl but keeps delivering
    // worklet messages, so this is the only clock the session can trust.
    recorder?.observe({ note: voicedNote, hz: classified.hz, db: currentDb }, nowMs);
  }

  // --- recording -----------------------------------------------------------
  function resetLiveState() {
    noiseFloor = createNoiseFloor();
    histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
    volumeAverage = createRunningMean();
    currentDb = null;
    currentNote = null;
  }

  async function start() {
    recordButton.disabled = true;
    setStatus('Waiting for the microphone…');

    try {
      capture = await startCapture(onFrame);
    } catch {
      recordButton.disabled = false;
      setStatus('The microphone was blocked. Allow it for this page and try again.');
      return;
    }

    resetLiveState();
    recorder = createSessionRecorder(RANGE_BAND_NOTES);
    readoutTimer = setInterval(renderReadouts, READOUT_INTERVAL_MS);

    recordButton.disabled = false;
    recordButton.textContent = 'Stop and save';
    recordButton.dataset.recording = 'true';
    setStatus('Measuring. You can switch to your call — leave this tab open.');
  }

  async function stop() {
    clearInterval(readoutTimer);
    readoutTimer = null;
    await capture?.stop();
    capture = null;

    const summary = recorder?.finish({
      zoneNotes,
      rangeLowNote: profile.rangeLowNote,
      rangeHighNote: profile.rangeHighNote,
      targetNote: profile.targetNote,
    });
    recorder = null;

    recordButton.textContent = 'Start measuring';
    delete recordButton.dataset.recording;

    if (!summary) {
      setStatus('Nothing was recorded.');
      return;
    }

    const { dropped } = store.addSession(summary);
    onSessionSaved();
    setStatus(
      dropped > 0
        ? `Saved to History. The ${dropped} oldest session${dropped > 1 ? 's were' : ' was'} removed to make room.`
        : 'Saved to History.'
    );
  }

  recordButton.addEventListener('click', () => {
    if (capture) stop();
    else start();
  });

  playButton.addEventListener('click', () => {
    const note = profile.targetNote || profile.fundamentalNote;
    if (!note) {
      setStatus('Set your target note in Profile first.');
      return;
    }
    tonePlayer.play(note, {
      gain: toneGainFor(profile.typicalRms),
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

  // A suspended context is the silent failure of this whole screen, so it is
  // checked whenever the tab comes back to the foreground.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !capture) return;
    if (capture.isRunning()) return;
    await capture.resume();
    setStatus(
      capture.isRunning()
        ? 'Measuring again — the browser had paused audio while the tab was hidden.'
        : 'The browser paused audio while this tab was hidden. Stop and start again.'
    );
  });

  paintZone();
  renderReadouts();

  return {
    isRecording: () => capture !== null,
    refreshProfile() {
      profile = store.getProfile();
      paintZone();
    },
  };
}
