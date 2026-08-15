import { volumeLevel, volumeVerdict } from '../src/gauge.js';
import { notesInRange, hzToNote, isValidRange, RANGE_BAND_NOTES } from '../src/note-hz.js';
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

// How far the last audio frame can fall behind the wall clock before the tab
// is treated as having stopped measuring rather than merely being quiet.
const STALL_GRACE_MS = 4000;

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

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function createMeasureScreen(root, { store, onSessionSaved, onRecordingChange, onNeedsSetup }) {
  const meterEl = root.querySelector('[data-el="db-meter"]');
  meterEl.innerHTML = buildDbMeterSvg();
  const needleEl = meterEl.querySelector('[data-el="needle"]');
  const targetMarkEl = meterEl.querySelector('[data-el="target-mark"]');
  const peakLightEls = meterEl.querySelectorAll('[data-el="peak-light"]');

  const setupPromptEl = root.querySelector('[data-el="setup-prompt"]');
  const bodyEl = root.querySelector('[data-el="measure-body"]');
  const barsEl = root.querySelector('[data-el="note-bars"]');
  const volumeCurrentEl = root.querySelector('[data-el="volume-current"]');
  const volumeAverageEl = root.querySelector('[data-el="volume-average"]');
  const pitchCurrentEl = root.querySelector('[data-el="pitch-current"]');
  const pitchModeEl = root.querySelector('[data-el="pitch-mode"]');
  const recordButton = root.querySelector('[data-action="toggle-recording"]');
  const statusEl = root.querySelector('[data-el="record-status"]');
  const elapsedEl = root.querySelector('[data-el="elapsed"]');
  const playButton = root.querySelector('[data-action="play-tone"]');
  const announcementEl = root.querySelector('[data-el="live-announcement"]');

  const tonePlayer = createTonePlayer();

  const fillByNote = new Map();
  const columnByNote = new Map();

  RANGE_BAND_NOTES.forEach((note) => {
    const column = document.createElement('div');
    column.className = 'note-bar';
    column.innerHTML = `
      <button type="button" class="bar-track" data-play-note="${note}" aria-label="Play ${note}">
        <span class="bar-fill"></span>
      </button>
      <span class="bar-label" data-accidental="${note.includes('#')}">${note}</span>
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
  let wakeLock = null;
  let analysisPaused = false;

  let noiseFloor = createNoiseFloor();
  let histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
  let volumeAverage = createRunningMean();
  let currentDb = null;
  let currentNote = null;
  let announcedNote = null;
  let startedAtMs = null;
  let lastFrameAtMs = null;

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

  const setStatus = (message) => {
    statusEl.textContent = message;
  };

  // --- rendering -----------------------------------------------------------
  function renderReadouts() {
    volumeCurrentEl.textContent = currentDb === null ? '—' : `${Math.round(currentDb)}dB`;
    const average = volumeAverage.mean();
    volumeAverageEl.textContent = average === null ? '—' : `${Math.round(average)}dB`;
    pitchCurrentEl.textContent = currentNote ?? '—';

    meterEl.setAttribute(
      'aria-label',
      currentDb === null ? 'Volume dial, no reading' : `Volume ${Math.round(currentDb)} decibels`
    );

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
    pitchModeEl.textContent = busiest ?? '—';

    columnByNote.forEach((column, note) => {
      column.classList.toggle('is-current', note === currentNote);
    });

    // Announced only when the note actually changes: a live region firing four
    // times a second would make a screen reader unusable.
    if (currentNote !== announcedNote) {
      announcedNote = currentNote;
      announcementEl.textContent = currentNote ? `${currentNote}, ${Math.round(currentDb)} decibels` : '';
    }

    if (startedAtMs !== null && lastFrameAtMs !== null) {
      elapsedEl.textContent = formatElapsed(lastFrameAtMs - startedAtMs);
    }
  }

  // Idle has to look idle. Holding the last frame's needle and figures makes a
  // dead panel indistinguishable from a working one.
  function clearReadouts() {
    currentDb = null;
    currentNote = null;
    announcedNote = null;
    volumeAverage = createRunningMean();
    histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
    needleEl.style.transform = 'rotate(-90deg)';
    peakLightEls.forEach((light) => light.setAttribute('fill', 'none'));
    announcementEl.textContent = '';
    renderReadouts();
  }

  function onFrame(reading) {
    if (analysisPaused) return;

    const nowMs = Date.now();
    lastFrameAtMs = nowMs;
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

  // --- keeping the tab alive ------------------------------------------------
  // The whole point is that the user switches away to their call, and a hidden
  // tab is exactly what the browser suspends first. A screen wake lock does not
  // guarantee anything, but it removes the most common cause.
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }

  async function releaseWakeLock() {
    try {
      await wakeLock?.release();
    } catch {
      // Already gone; nothing to do.
    }
    wakeLock = null;
  }

  // --- recording -----------------------------------------------------------
  function resetLiveState() {
    noiseFloor = createNoiseFloor();
    histogram = createDecayingHistogram(RANGE_BAND_NOTES, NOTE_DECAY_HALF_LIFE_MS);
    volumeAverage = createRunningMean();
    currentDb = null;
    currentNote = null;
    announcedNote = null;
    startedAtMs = Date.now();
    lastFrameAtMs = startedAtMs;
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
    await requestWakeLock();

    recordButton.disabled = false;
    recordButton.textContent = 'Stop and save';
    recordButton.dataset.recording = 'true';
    elapsedEl.hidden = false;
    elapsedEl.textContent = '0:00';
    onRecordingChange(true);
    setStatus('Measuring. You can switch to your call — leave this tab open.');
  }

  async function stop() {
    clearInterval(readoutTimer);
    readoutTimer = null;
    await releaseWakeLock();
    await capture?.stop();
    capture = null;

    const summary = recorder?.finish({
      zoneNotes,
      rangeLowNote: profile.rangeLowNote,
      rangeHighNote: profile.rangeHighNote,
      targetNote: profile.targetNote,
    });
    recorder = null;
    startedAtMs = null;
    lastFrameAtMs = null;

    recordButton.textContent = 'Start measuring';
    delete recordButton.dataset.recording;
    elapsedEl.hidden = true;
    onRecordingChange(false);
    clearReadouts();

    if (!summary) {
      setStatus('Nothing was recorded.');
      return;
    }

    const { dropped } = store.addSession(summary);
    onSessionSaved();
    setStatus(
      dropped > 0
        ? `Saved to History. The ${dropped} oldest session${dropped > 1 ? 's were' : ' was'} removed to make room.`
        : `Saved to History — ${formatElapsed(summary.durationMs)} measured.`
    );
  }

  recordButton.addEventListener('click', () => {
    if (capture) stop();
    else start();
  });

  barsEl.querySelectorAll('[data-play-note]').forEach((button) => {
    button.addEventListener('click', () => playNote(button.dataset.playNote));
  });

  function playNote(note) {
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
  }

  playButton.addEventListener('click', () => {
    const note = profile.targetNote || profile.fundamentalNote;
    if (!note) {
      setStatus('Set your target note in Profile first.');
      return;
    }
    playNote(note);
  });

  // Coming back to the tab is the moment to find out whether it kept working.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !capture) return;

    // A wake lock is dropped whenever the page is hidden, so it has to be
    // taken again every time the tab comes back.
    if (!wakeLock) await requestWakeLock();

    const stalledMs = Date.now() - lastFrameAtMs;
    if (!capture.isRunning()) await capture.resume();

    if (stalledMs > STALL_GRACE_MS) {
      setStatus(
        `The browser paused audio while this tab was hidden — about ${formatElapsed(stalledMs)} was not measured. Everything before that is safe.`
      );
      return;
    }
    if (capture.isRunning()) setStatus('Measuring. You can switch to your call — leave this tab open.');
  });

  function applyProfile() {
    profile = store.getProfile();
    paintZone();

    // Measuring against nothing produces a session with no in-range figure and
    // no target, which is not a result — so the screen asks for a target first.
    const ready = Boolean(profile.targetNote);
    setupPromptEl.hidden = ready;
    bodyEl.hidden = !ready;
    if (!ready) onNeedsSetup?.();
  }

  applyProfile();
  clearReadouts();

  return {
    isRecording: () => capture !== null,
    refreshProfile: applyProfile,
  };
}
