import { RANGE_BAND_NOTES, notesInRange, isValidRange } from '../src/note-hz.js';
import { computeCeilingFromSamples, computeTypicalFromSamples } from '../src/volume-calibration.js';
import { importSettings } from '../src/settings-transfer.js';
import { createTonePlayer } from '../src/tone-player.js';
import { toneGainFor } from '../src/tone-gain.js';
import { startCapture } from './audio.js';

const CALIBRATION_MS = 5000;

// Full width on the level bar at a comfortably loud voice. Feedback only —
// nothing measured depends on it.
const LEVEL_BAR_FULL_RMS = 0.06;

// A plain Maps search, resolved against wherever the person is. No coordinates
// to ask for, and nothing here is a referral or a recommendation.
const THERAPIST_SEARCH_URL = 'https://www.google.com/maps/search/speech+therapist';

const TEXT_FIELDS = ['firstName', 'lastName', 'yearOfBirth', 'sex'];
const SLIDER_FIELDS = ['toneVolume'];
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
    [...TEXT_FIELDS, ...NOTE_FIELDS, ...SLIDER_FIELDS].map((name) => [
      name,
      root.querySelector(`[data-field="${name}"]`),
    ])
  );
  const toneVolumeValueEl = root.querySelector('[data-el="tone-volume-value"]');
  const tonePlayer = createTonePlayer();
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
    inputs.toneVolume.value = profile.toneVolume ?? 1;
    showToneVolume(profile.toneVolume ?? 1);
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

  function showToneVolume(volume) {
    toneVolumeValueEl.textContent = `${Math.round(Number(volume) * 100)}%`;
  }

  [...TEXT_FIELDS, ...NOTE_FIELDS].forEach((name) => {
    inputs[name].addEventListener('change', () => save(name, inputs[name].value));
  });

  // Updates as it moves so the number tracks the thumb, but only writes on
  // release — a slider fires continuously and every input would be a save.
  inputs.toneVolume.addEventListener('input', () => showToneVolume(inputs.toneVolume.value));
  inputs.toneVolume.addEventListener('change', () =>
    save('toneVolume', Number(inputs.toneVolume.value))
  );

  root.querySelector('[data-action="preview-tone"]').addEventListener('click', () => {
    const profile = store.getProfile();
    const note = profile.targetNote || profile.fundamentalNote;
    if (!note) {
      statusEl.textContent = 'Set your target note first.';
      return;
    }
    // Straight from the slider, so you hear the change before it is saved.
    const gain = toneGainFor({ ...profile, toneVolume: Number(inputs.toneVolume.value) });
    tonePlayer.play(note, { gain });

    // Says what it actually did. "No sound" has three different causes —
    // blocked audio, a gain near zero, and the phone's silent switch — and
    // they are indistinguishable from the outside without this.
    statusEl.textContent = `Playing ${note} at ${Math.round(gain * 100)}%…`;
    setTimeout(() => {
      const state = tonePlayer.state();
      statusEl.textContent =
        state === 'error'
          ? 'The browser refused to play the tone.'
          : `Played ${note} at ${Math.round(gain * 100)}%. If you heard nothing, turn the phone's volume up — the tone follows the system volume, not this slider alone.`;
    }, 500);
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

  const importInput = root.querySelector('[data-field="settingsFile"]');
  const importStatus = root.querySelector('[data-el="import-status"]');

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    try {
      store.saveProfile(importSettings(await file.text()));
      importStatus.textContent = 'Loaded. Your notes and calibration now match the extension.';
      render();
      onProfileChanged();
    } catch (error) {
      importStatus.textContent = error.message;
    } finally {
      // Clearing it means picking the same file twice in a row still fires.
      importInput.value = '';
    }
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
