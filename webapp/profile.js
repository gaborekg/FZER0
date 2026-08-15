import { RANGE_BAND_NOTES, notesInRange, isValidRange } from '../src/note-hz.js';
import { computeCeilingFromSamples, computeTypicalFromSamples } from '../src/volume-calibration.js';
import { startCapture } from './audio.js';

const CALIBRATION_MS = 5000;

// Full width on the level bar at a comfortably loud voice. Feedback only —
// nothing measured depends on it.
const LEVEL_BAR_FULL_RMS = 0.06;

// A plain Maps search, resolved against wherever the person is. No coordinates
// to ask for, and nothing here is a referral or a recommendation.
const THERAPIST_SEARCH_URL = 'https://www.google.com/maps/search/speech+therapist';

const TEXT_FIELDS = ['firstName', 'lastName', 'yearOfBirth', 'sex'];
const NOTE_FIELDS = ['fundamentalNote', 'rangeLowNote', 'rangeHighNote', 'targetNote'];

function fillSelect(select, notes, selected) {
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '—';
  select.appendChild(blank);

  notes.forEach((note) => {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    select.appendChild(option);
  });

  select.value = notes.includes(selected) ? selected : '';
}

export function createProfileScreen(root, { store, onProfileChanged, isRecording }) {
  const inputs = Object.fromEntries(
    [...TEXT_FIELDS, ...NOTE_FIELDS].map((name) => [name, root.querySelector(`[data-field="${name}"]`)])
  );
  const statusEl = root.querySelector('[data-el="calibration-status"]');
  const levelFill = root.querySelector('[data-el="level-fill"]');
  const calibrateButton = root.querySelector('[data-action="start-calibration"]');
  const clearButton = root.querySelector('[data-action="clear-sessions"]');

  function refreshTargetOptions(profile) {
    const { rangeLowNote, rangeHighNote } = profile;
    const usable = rangeLowNote && rangeHighNote && isValidRange(rangeLowNote, rangeHighNote);
    fillSelect(inputs.targetNote, usable ? notesInRange(rangeLowNote, rangeHighNote) : [], profile.targetNote);
    inputs.targetNote.disabled = !usable;
  }

  function render() {
    const profile = store.getProfile();
    TEXT_FIELDS.forEach((name) => {
      inputs[name].value = profile[name] ?? '';
    });
    fillSelect(inputs.fundamentalNote, RANGE_BAND_NOTES, profile.fundamentalNote);
    fillSelect(inputs.rangeLowNote, RANGE_BAND_NOTES, profile.rangeLowNote);
    fillSelect(inputs.rangeHighNote, RANGE_BAND_NOTES, profile.rangeHighNote);
    refreshTargetOptions(profile);
  }

  function save(name, value) {
    let profile = store.saveProfile({ [name]: value });

    // A target outside the new range is no longer a target. Clearing it beats
    // silently keeping a note the chart can't show.
    if (name === 'rangeLowNote' || name === 'rangeHighNote') {
      const stillValid =
        profile.targetNote &&
        isValidRange(profile.rangeLowNote, profile.rangeHighNote) &&
        notesInRange(profile.rangeLowNote, profile.rangeHighNote).includes(profile.targetNote);
      if (!stillValid) profile = store.saveProfile({ targetNote: '' });
      refreshTargetOptions(profile);
    }

    onProfileChanged();
  }

  [...TEXT_FIELDS, ...NOTE_FIELDS].forEach((name) => {
    inputs[name].addEventListener('change', () => save(name, inputs[name].value));
  });

  root.querySelector('[data-action="find-therapist"]').addEventListener('click', () => {
    window.open(THERAPIST_SEARCH_URL, '_blank', 'noopener');
  });

  clearButton.addEventListener('click', () => {
    const count = store.listSessions().length;
    if (count === 0) return;

    // Naming the number is the difference between a reflex "OK" and a decision.
    // The export lives one screen away and is the only copy that survives this.
    const confirmed = window.confirm(
      `Delete all ${count} session${count === 1 ? '' : 's'}? This cannot be undone — ` +
        'export them from History first if you want to keep them.'
    );
    if (!confirmed) return;

    store.clearSessions();
    onProfileChanged();
  });

  calibrateButton.addEventListener('click', async () => {
    // One microphone at a time: taking a second stream mid-session would
    // interrupt the recording without saying so.
    if (isRecording()) {
      statusEl.textContent = 'Stop the measurement on Measure first.';
      return;
    }

    calibrateButton.disabled = true;
    statusEl.textContent = 'Waiting for the microphone…';

    let capture;
    const samples = [];
    try {
      capture = await startCapture(({ rms }) => {
        samples.push(rms);
        levelFill.style.width = `${Math.min(1, rms / LEVEL_BAR_FULL_RMS) * 100}%`;
      });
    } catch {
      calibrateButton.disabled = false;
      statusEl.textContent = 'The microphone was blocked. Allow it for this page and try again.';
      return;
    }

    statusEl.textContent = 'Listening — keep talking…';
    await new Promise((resolve) => setTimeout(resolve, CALIBRATION_MS));
    await capture.stop();
    levelFill.style.width = '0%';
    calibrateButton.disabled = false;

    if (samples.length === 0) {
      statusEl.textContent = 'Nothing came through the microphone.';
      return;
    }

    store.saveProfile({
      volumeCeilingRms: computeCeilingFromSamples(samples),
      typicalRms: computeTypicalFromSamples(samples),
    });
    statusEl.textContent = 'Saved. Your target and your tone now match your own voice.';
    onProfileChanged();
  });

  render();
  return { render };
}
