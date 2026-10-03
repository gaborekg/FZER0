// One patient's Profile, as iOS grouped lists: Personal, Voice, Calibration,
// Delete. The target follows the fundamental until it is picked by hand.
import { bandNotesFor } from './src/voice-bands.js';
import { notesInRange, isValidRange } from './src/note-hz.js';
import { applyProfileChange, applySexChange, fundamentalOutsideRange } from './src/patient-setup.js';
import { dayKey } from './src/day-groups.js';
import { computeCeilingFromSamples, computeTypicalFromSamples } from './src/volume-calibration.js';
import { createTonePlayer } from './src/tone-player.js';
import { toneGainFor } from './src/tone-gain.js';
import { startCapture, setAudioSession } from './app/audio.js';
import { deleteAudio } from './app/audio-store.js';

const CALIBRATION_MS = 5000;
const LEVEL_FULL_RMS = 0.06;
const SEXES = ['Female', 'Male', 'Intersex', 'Prefer not to say'];

const MARKUP = `
  <p class="list-footer warn" data-el="busy-note" hidden style="margin-top: 18px">Stop the measurement to edit the profile.</p>
  <section class="group">
    <div class="list-header">Personal</div>
    <ul class="list">
      <li><label class="cell"><span class="cell-title">First Name</span><input id="p-first" data-field="firstName" maxlength="40" autocomplete="off" /></label></li>
      <li><label class="cell"><span class="cell-title">Last Name</span><input id="p-last" data-field="lastName" maxlength="40" autocomplete="off" /></label></li>
      <li><label class="cell"><span class="cell-title">Year of Birth</span><input id="p-year" data-field="yearOfBirth" type="number" inputmode="numeric" min="1900" step="1" placeholder="Required" /></label></li>
      <li><label class="cell"><span class="cell-title">Sex</span><select id="p-sex" data-field="sex"></select></label></li>
    </ul>
  </section>
  <section class="group">
    <div class="list-header">Voice</div>
    <ul class="list">
      <li><label class="cell"><span class="cell-title">Fundamental Tone</span><select id="p-fund" data-field="fundamentalNote"></select></label></li>
      <li><label class="cell"><span class="cell-title">Lowest Note</span><select id="p-low" data-field="rangeLowNote"></select></label></li>
      <li><label class="cell"><span class="cell-title">Highest Note</span><select id="p-high" data-field="rangeHighNote"></select></label></li>
      <li><label class="cell"><span class="cell-title">Target Note</span><select id="p-target" data-field="targetNote"></select></label></li>
    </ul>
    <p class="list-footer" data-el="voice-footer"></p>
  </section>
  <section class="group">
    <div class="list-header">Calibration</div>
    <ul class="list">
      <li><div class="cell"><span class="cell-title">Calibrated</span><span class="cell-detail" data-el="cal-date"></span></div></li>
      <li><button type="button" class="cell cell-action" data-action="calibrate"><span class="cell-title" data-el="cal-label">Calibrate Voice</span><span class="cell-detail" data-el="cal-status"></span></button></li>
      <li data-el="level-row" hidden><div class="cell"><div class="level-track" aria-hidden="true"><span data-el="level-fill"></span></div></div></li>
      <li><label class="cell"><span class="cell-title">Tone Volume</span><input id="p-tone" type="range" min="0.2" max="1.4" step="0.05" data-field="toneVolume" aria-label="Tone volume" /><span class="cell-detail" data-el="tone-value"></span></label></li>
      <li><button type="button" class="cell cell-action" data-action="play-tone"><span class="cell-title">Play Target Tone</span></button></li>
    </ul>
    <p class="list-footer">Talk normally for 5 seconds. Keep the phone at the same distance every time — about 30 cm, ideally on a stand. Recalibrate only when that changes.</p>
  </section>
  <section class="group">
    <ul class="list">
      <li><button type="button" class="cell cell-destructive" data-action="delete-all"><span class="cell-title">Delete All Recordings</span></button></li>
      <li><button type="button" class="cell cell-destructive" data-action="delete-patient"><span class="cell-title">Delete Patient</span></button></li>
    </ul>
  </section>
`;

function fill(select, options, selected, placeholder) {
  select.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.appendChild(blank);
  options.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = options.includes(selected) ? selected : '';
}

function formatDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function createProfileScreen(root, { store, isBusy, onChanged, onDeletePatient, onCalibratingChange = () => {} }) {
  root.innerHTML = MARKUP;
  const $ = (selector) => root.querySelector(selector);
  const field = (name) => $(`[data-field="${name}"]`);
  const tonePlayer = createTonePlayer();
  const calButton = $('[data-action="calibrate"]');
  const calStatus = $('[data-el="cal-status"]');
  const levelFill = $('[data-el="level-fill"]');
  const levelRow = $('[data-el="level-row"]');
  let calibrating = false;

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
    const usable = p.rangeLowNote && p.rangeHighNote && isValidRange(p.rangeLowNote, p.rangeHighNote);
    fill(field('targetNote'), usable ? notesInRange(p.rangeLowNote, p.rangeHighNote) : [], p.targetNote, usable ? 'Automatic' : 'Set range');
    field('targetNote').disabled = !usable;

    const footer = $('[data-el="voice-footer"]');
    const outside = fundamentalOutsideRange(p);
    footer.classList.toggle('warn', outside);
    if (outside) footer.textContent = 'Fundamental tone is outside the range — pick a target.';
    else if (p.targetIsAutomatic === false) footer.textContent = 'Target picked by hand. Choose “Automatic” to follow the fundamental tone again.';
    else footer.textContent = 'The target follows the fundamental tone until you pick one.';

    $('[data-el="cal-date"]').textContent = p.calibratedAtMs ? formatDate(p.calibratedAtMs) : 'Not yet';
    $('[data-el="cal-label"]').textContent = p.calibratedAtMs ? 'Recalibrate Voice' : 'Calibrate Voice';
    // While a take is recording or saving, the profile it is measured against
    // must not change under it: editing could hide Stop or mix two setups.
    const busy = isBusy();
    $('[data-el="busy-note"]').hidden = !busy;
    root.querySelectorAll('input, select').forEach((control) => {
      if (busy) control.disabled = true;
      else if (control !== field('targetNote')) control.disabled = false;
    });
    if (busy) field('targetNote').disabled = true;
    field('toneVolume').value = p.toneVolume ?? 1;
    $('[data-el="tone-value"]').textContent = `${Math.round(Number(p.toneVolume ?? 1) * 100)}%`;
  }

  function save(patch) {
    if (isBusy()) {
      render();
      return;
    }
    const current = store.getProfile();
    const next = 'sex' in patch ? applySexChange(current, patch.sex) : applyProfileChange(current, patch);
    store.saveProfile(next);
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
  field('toneVolume').addEventListener('input', () => {
    $('[data-el="tone-value"]').textContent = `${Math.round(Number(field('toneVolume').value) * 100)}%`;
  });
  field('toneVolume').addEventListener('change', () => save({ toneVolume: Number(field('toneVolume').value) }));

  $('[data-action="play-tone"]').addEventListener('click', () => {
    const p = store.getProfile();
    const note = p.targetNote || p.fundamentalNote;
    if (!note) return;
    setAudioSession('playback');
    tonePlayer.play(note, { gain: toneGainFor({ ...p, toneVolume: Number(field('toneVolume').value) }) });
  });

  calButton.addEventListener('click', async () => {
    if (calibrating) return;
    if (isBusy()) {
      calStatus.textContent = 'Stop the measurement first';
      return;
    }
    const today = dayKey(Date.now());
    const recordedToday = store.listSessions().some((s) => dayKey(s.startedAtMs) === today);
    if (
      recordedToday &&
      !window.confirm(
        "Recalibrating now changes how volume is measured. Today's volume before and after won't compare directly. Pitch is not affected.\n\nCalibrate anyway?"
      )
    ) {
      return;
    }

    calibrating = true;
    onCalibratingChange(true);
    calButton.disabled = true;
    calStatus.textContent = 'Waiting for microphone…';
    const samples = [];
    let capture;
    try {
      capture = await startCapture(({ rms }) => {
        samples.push(rms);
        levelFill.style.width = `${Math.min(1, rms / LEVEL_FULL_RMS) * 100}%`;
      });
    } catch {
      calStatus.textContent = 'Microphone blocked';
      calButton.disabled = false;
      calibrating = false;
      onCalibratingChange(false);
      return;
    }
    calStatus.textContent = 'Listening…';
    levelRow.hidden = false;
    await new Promise((resolve) => setTimeout(resolve, CALIBRATION_MS));
    await capture.stop();
    levelFill.style.width = '0%';
    levelRow.hidden = true;
    calButton.disabled = false;
    calibrating = false;
    onCalibratingChange(false);

    if (samples.length === 0) {
      calStatus.textContent = 'Nothing came through';
      return;
    }
    calStatus.textContent = 'Saved';
    save({
      volumeCeilingRms: computeCeilingFromSamples(samples),
      typicalRms: computeTypicalFromSamples(samples),
      calibratedAtMs: Date.now(),
    });
  });

  $('[data-action="delete-all"]').addEventListener('click', () => {
    if (isBusy()) return;
    const sessions = store.listSessions();
    if (sessions.length === 0) return;
    const name = `${store.getProfile().firstName ?? ''} ${store.getProfile().lastName ?? ''}`.trim() || 'this patient';
    const count = sessions.length;
    if (!window.confirm(`Delete all ${count} recording${count === 1 ? '' : 's'} of ${name}? This cannot be undone.`)) return;
    const ids = sessions.map((s) => s.id).filter(Boolean);
    store.clearSessions();
    deleteAudio(ids).catch(() => {});
    onChanged();
  });

  $('[data-action="delete-patient"]').addEventListener('click', () => onDeletePatient());

  render();
  return { render, isCalibrating: () => calibrating };
}
