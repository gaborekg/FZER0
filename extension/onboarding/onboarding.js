import { notesInRange, isValidRange } from '../../src/note-hz.js';
import { bandNotesFor } from '../../src/voice-bands.js';
import { createPrefsStore } from '../../src/prefs.js';
import {
  computeCeilingFromSamples,
  computeTypicalFromSamples,
} from '../../src/volume-calibration.js';

function showScreen(name) {
  document.querySelectorAll('[data-screen]').forEach((section) => {
    section.hidden = section.dataset.screen !== name;
  });
  // Move focus into the newly-shown screen so screen-reader/keyboard users
  // aren't left on a hidden, removed-from-view element. Toggle hidden first
  // (above), then focus — a hidden element can't take focus. Every screen's
  // first child is an <h1> (with tabindex="-1" in the HTML so it's
  // focusable), so this reliably lands on the heading; the button fallback
  // covers any screen shape that doesn't start with a heading.
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

// Both refusals used to be dead ends with no button on them at all — change
// your mind and the only way forward was reinstalling the extension. Going to
// find your fundamental tone and coming back is the entire point of sending
// someone to a pathologist, so that road has to run both ways.
document.querySelector('[data-action="reconsider-mic"]').addEventListener('click', () => {
  showScreen('disclaimer');
});

document.querySelector('[data-action="reconsider-tone"]').addEventListener('click', () => {
  showScreen('instructions');
});

document.querySelector('[data-action="tone-found"]').addEventListener('click', () => {
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

// The widest band: nobody has said which voice this is yet, and a chart that
// excludes someone before they have answered is the wrong first impression.
const SETUP_NOTES = bandNotesFor('');
populateSelect(lowSelect, SETUP_NOTES);
populateSelect(highSelect, SETUP_NOTES);
// Default the high end to the LAST band note (not the first, which is what
// populateSelect leaves selected by default) so an untouched submit already
// has a valid, non-zero-width range. Without this, an untouched form saves
// rangeLowNote === rangeHighNote === the band's first note, which passes
// notesInRange (it returns a valid single-element array, no throw) and
// breaks the in-call panel's gaugePosition math (divides by
// rangeHighHz - rangeLowHz, which is zero). Set before the initial
// refreshTargetOptions() call below, since that call reads highSelect.value.
highSelect.value = SETUP_NOTES[SETUP_NOTES.length - 1];

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

  // isValidRange catches BOTH an inverted range (already reflected in
  // targetSelect.disabled/empty via refreshTargetOptions' catch) AND a
  // valid-but-zero-width range (low === high), which throws nothing and
  // leaves targetSelect enabled with a legitimate single-note value — the
  // gap the disabled-check alone couldn't cover. !targetSelect.value is
  // kept alongside it as independent protection against saving an empty
  // targetNote.
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

  showScreen('calibration');
});

// --- Calibration ----------------------------------------------------------
//
// Five seconds of normal speech gives two numbers: the median (the user's
// comfortable level, which becomes the Target on the dial and the loudness of
// the reference tone) and a ceiling just above their loudest normal speech
// (where the needle tops out and the peak lights come on). Without them the
// panel falls back to generic constants, which are a guess about somebody
// else's microphone, distance and room.
const CALIBRATION_MS = 5000;

// Full width on the level bar at a comfortably loud voice. Only feedback —
// nothing measured depends on it.
const LEVEL_BAR_FULL_RMS = 0.06;

const calibrationStatus = document.querySelector('[data-el="calibration-status"]');
const levelFill = document.querySelector('[data-el="level-fill"]');
const startCalibrationButton = document.querySelector('[data-action="start-calibration"]');
const skipCalibrationButton = document.querySelector('[data-action="skip-calibration"]');

skipCalibrationButton.addEventListener('click', () => showScreen('done'));

function endCalibration(message) {
  levelFill.style.width = '0%';
  calibrationStatus.textContent = message;
  startCalibrationButton.disabled = false;
  startCalibrationButton.textContent = 'Try again';
  skipCalibrationButton.disabled = false;
}

startCalibrationButton.addEventListener('click', async () => {
  startCalibrationButton.disabled = true;
  skipCalibrationButton.disabled = true;
  calibrationStatus.textContent = 'Waiting for the microphone…';

  let stream;
  try {
    // Same capture settings the in-call panel uses. Chrome's own processing
    // would fight the measurement: auto gain control in particular exists to
    // erase exactly the loudness differences being measured here.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
  } catch {
    endCalibration("Chrome blocked the microphone. You can set this later from the ⋯ button during a call.");
    return;
  }

  const audioContext = new AudioContext();
  const samples = [];

  try {
    await audioContext.audioWorklet.addModule('../worklet/f0-processor.js');
    const workletNode = new AudioWorkletNode(audioContext, 'fzer0-f0-processor');
    workletNode.port.onmessage = (event) => {
      samples.push(event.data.rms);
      const level = Math.min(1, event.data.rms / LEVEL_BAR_FULL_RMS);
      levelFill.style.width = `${level * 100}%`;
    };
    audioContext.createMediaStreamSource(stream).connect(workletNode);

    calibrationStatus.textContent = 'Listening — keep talking…';
    await new Promise((resolve) => setTimeout(resolve, CALIBRATION_MS));
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    audioContext.close();
  }

  if (samples.length === 0) {
    endCalibration('Nothing came through the microphone.');
    return;
  }

  try {
    await prefs.saveCalibration({
      volumeCeilingRms: computeCeilingFromSamples(samples),
      typicalRms: computeTypicalFromSamples(samples),
    });
  } catch {
    endCalibration('Something went wrong saving it — please try again.');
    return;
  }

  levelFill.style.width = '0%';
  showScreen('done');
});
