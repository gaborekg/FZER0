// One patient's Profile: Personal, Voice, Calibration, and the way to delete.
// The target follows the fundamental until it is picked by hand.
import { bandNotesFor } from './src/voice-bands.js';
import { notesInRange, isValidRange } from './src/note-hz.js';
import { applyProfileChange, applySexChange, fundamentalOutsideRange } from './src/patient-setup.js';
import { createTonePlayer } from './src/tone-player.js';
import { toneGainFor } from './src/tone-gain.js';
import { setAudioSession } from './app/audio.js';
import { deleteAudio } from './app/audio-store.js';
import { openCalibration } from './calibration.js';

const SEXES = ['Female', 'Male', 'Intersex', 'Prefer not to say'];

const MARKUP = `
  <p class="lock-note" data-el="busy-note" hidden>Stop the recording to edit the profile.</p>
  <div class="profile-layout">
    <div class="profile-col">
      <h2 class="section-title">Personal</h2>
      <div class="card rows">
        <label class="row"><span>First name</span><input data-field="firstName" maxlength="40" autocomplete="off" /></label>
        <label class="row"><span>Last name</span><input data-field="lastName" maxlength="40" autocomplete="off" /></label>
        <label class="row"><span>Year of birth</span><input data-field="yearOfBirth" type="number" inputmode="numeric" min="1900" step="1" placeholder="Required" /></label>
        <label class="row"><span>Sex</span><select data-field="sex"></select></label>
      </div>
      <h2 class="section-title">Calibration</h2>
      <div class="card cal-row">
        <span class="grow"><span data-el="cal-date"></span><span class="small muted">Same distance every time, about 30 cm</span></span>
        <button type="button" class="ghost" data-action="calibrate">Calibrate</button>
      </div>
    </div>
    <div class="profile-col">
      <h2 class="section-title">Voice</h2>
      <div class="card rows">
        <label class="row"><span>Fundamental tone</span><select data-field="fundamentalNote"></select></label>
        <label class="row"><span>Lowest note</span><select data-field="rangeLowNote"></select></label>
        <label class="row"><span>Highest note</span><select data-field="rangeHighNote"></select></label>
        <label class="row"><span>Target note</span><select data-field="targetNote"></select></label>
        <label class="row"><span>Tone volume</span><input data-field="toneVolume" type="range" min="0.2" max="1.4" step="0.05" aria-label="Tone volume" /></label>
        <div class="row"><span>Target tone</span><button type="button" class="link" data-action="play-tone">Play</button></div>
      </div>
      <p class="row-note" data-el="voice-note"></p>
      <button type="button" class="text-danger" data-action="delete" style="align-self: flex-start; margin-top: 12px">Delete recordings or patient…</button>
    </div>
  </div>

  <dialog class="sheet" data-el="delete-sheet" aria-labelledby="delete-title">
    <span class="sheet-grip" aria-hidden="true"></span>
    <h2 class="sheet-title" id="delete-title">Delete</h2>
    <button type="button" class="ghost" data-action="delete-all">Delete all recordings</button>
    <button type="button" class="ghost" data-action="delete-patient" style="color: var(--danger); border-color: var(--danger)">Delete patient</button>
    <button type="button" class="link" data-action="close-delete">Cancel</button>
  </dialog>
`;

function fill(select, options, selected, placeholder) {
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.replaceChildren(
    blank,
    ...options.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      return option;
    })
  );
  select.value = options.includes(selected) ? selected : '';
}

const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function createProfileScreen(root, { store, isBusy, onChanged, onDeletePatient, onListeningChange = () => {} }) {
  root.innerHTML = MARKUP;
  const $ = (selector) => root.querySelector(selector);
  const field = (name) => $(`[data-field="${name}"]`);
  const deleteSheet = $('[data-el="delete-sheet"]');
  const tonePlayer = createTonePlayer();

  function render() {
    const p = store.getProfile();
    field('firstName').value = p.firstName ?? '';
    field('lastName').value = p.lastName ?? '';
    field('yearOfBirth').value = p.yearOfBirth ?? '';
    field('yearOfBirth').max = String(new Date().getFullYear());
    fill(field('sex'), SEXES, p.sex, 'Required');
    const notes = bandNotesFor(p.sex);
    fill(field('fundamentalNote'), notes, p.fundamentalNote, 'Required');
    fill(field('rangeLowNote'), notes, p.rangeLowNote, 'Required');
    fill(field('rangeHighNote'), notes, p.rangeHighNote, 'Required');
    const usable = Boolean(p.rangeLowNote && p.rangeHighNote && isValidRange(p.rangeLowNote, p.rangeHighNote));
    fill(field('targetNote'), usable ? notesInRange(p.rangeLowNote, p.rangeHighNote) : [], p.targetNote, usable ? 'Automatic' : 'Set range');
    field('toneVolume').value = p.toneVolume ?? 1;

    const note = $('[data-el="voice-note"]');
    const outside = fundamentalOutsideRange(p);
    note.classList.toggle('warn', outside);
    if (outside) note.textContent = 'Fundamental tone is outside the range. Pick a target.';
    else if (p.targetIsAutomatic === false) note.textContent = 'Target picked by hand. Choose “Automatic” to follow the fundamental tone again.';
    else note.textContent = 'The target follows the fundamental tone until you pick one.';

    $('[data-el="cal-date"]').textContent = p.calibratedAtMs ? `Calibrated ${formatDate(p.calibratedAtMs)}` : 'Not calibrated yet';
    $('[data-action="calibrate"]').textContent = p.calibratedAtMs ? 'Recalibrate' : 'Calibrate';

    // While a take is recording or saving, the profile it is measured
    // against must not change under it.
    const busy = isBusy();
    $('[data-el="busy-note"]').hidden = !busy;
    root.querySelectorAll('input, select, [data-action="calibrate"], [data-action="delete"]').forEach((control) => {
      control.disabled = busy;
    });
    if (!usable) field('targetNote').disabled = true;
  }

  function save(patch) {
    if (isBusy()) {
      render();
      return;
    }
    const current = store.getProfile();
    store.saveProfile('sex' in patch ? applySexChange(current, patch.sex) : applyProfileChange(current, patch));
    render();
    onChanged();
  }

  ['firstName', 'lastName', 'yearOfBirth'].forEach((name) => {
    field(name).addEventListener('change', () => {
      const value = field(name).value.trim();
      // A patient always keeps a name: it is in every file and on every screen.
      if ((name === 'firstName' || name === 'lastName') && !value) {
        render();
        return;
      }
      save({ [name]: value });
    });
  });
  ['sex', 'fundamentalNote', 'rangeLowNote', 'rangeHighNote', 'targetNote'].forEach((name) => {
    field(name).addEventListener('change', () => save({ [name]: field(name).value }));
  });
  field('toneVolume').addEventListener('change', () => save({ toneVolume: Number(field('toneVolume').value) }));

  $('[data-action="play-tone"]').addEventListener('click', () => {
    const p = store.getProfile();
    const tone = p.targetNote || p.fundamentalNote;
    if (!tone) return;
    setAudioSession('playback');
    tonePlayer.play(tone, { gain: toneGainFor({ ...p, toneVolume: Number(field('toneVolume').value) }) });
  });

  $('[data-action="calibrate"]').addEventListener('click', () => {
    if (isBusy()) return;
    openCalibration({
      store,
      onListeningChange,
      onSaved: () => {
        render();
        onChanged();
      },
    });
  });

  $('[data-action="delete"]').addEventListener('click', () => {
    if (!isBusy()) deleteSheet.showModal();
  });
  $('[data-action="close-delete"]').addEventListener('click', () => deleteSheet.close());
  $('[data-action="delete-all"]').addEventListener('click', () => {
    const sessions = store.listSessions();
    if (sessions.length === 0) {
      deleteSheet.close();
      return;
    }
    const p = store.getProfile();
    const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'this patient';
    const count = sessions.length;
    if (!window.confirm(`Delete all ${count} recording${count === 1 ? '' : 's'} of ${name}? This cannot be undone.`)) return;
    store.clearSessions();
    deleteAudio(sessions.map((s) => s.id).filter(Boolean)).catch(() => {});
    deleteSheet.close();
    onChanged();
  });
  $('[data-action="delete-patient"]').addEventListener('click', () => {
    deleteSheet.close();
    onDeletePatient();
  });

  render();
  return { render };
}
