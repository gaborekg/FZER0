// One patient's Profile: Voice, Personal, Consent, Calibration, and the way to
// delete. The target follows the fundamental until it is picked by hand.
import { bandNotesFor } from './src/voice-bands.js';
import { notesInRange, isValidRange } from './src/note-hz.js';
import { applyProfileChange, applySexChange, fundamentalOutsideRange } from './src/patient-setup.js';
import { deleteAudio } from './app/audio-store.js';
import { openCalibration } from './calibration.js';
import { t, longDate } from './i18n.js';

// Stored in English (the voice band reads them); shown translated.
const SEXES = ['Female', 'Male', 'Intersex', 'Prefer not to say'];

const MARKUP = () => `
  <p class="lock-note" data-el="busy-note" hidden>${t('p.busy')}</p>
  <h1 class="page-title" data-el="name"></h1>
  <div class="profile-layout">
    <div class="profile-col">
      <h2 class="section-title">${t('p.voice')}</h2>
      <div class="card rows">
        <label class="row"><span>${t('p.fundamental')}</span><select data-field="fundamentalNote"></select></label>
        <label class="row"><span>${t('p.low')}</span><select data-field="rangeLowNote"></select></label>
        <label class="row"><span>${t('p.high')}</span><select data-field="rangeHighNote"></select></label>
        <label class="row"><span>${t('p.target')}</span><select data-field="targetNote"></select></label>
      </div>
      <p class="row-note" data-el="voice-note"></p>
      <h2 class="section-title">${t('p.personal')}</h2>
      <div class="card rows">
        <label class="row"><span>${t('p.first')}</span><input data-field="firstName" maxlength="40" autocomplete="off" /></label>
        <label class="row"><span>${t('p.last')}</span><input data-field="lastName" maxlength="40" autocomplete="off" /></label>
        <label class="row"><span>${t('p.year')}</span><input data-field="yearOfBirth" type="number" inputmode="numeric" min="1900" step="1" placeholder="${t('p.required')}" /></label>
        <label class="row"><span>${t('p.sex')}</span><select data-field="sex"></select></label>
      </div>
    </div>
    <div class="profile-col">
      <h2 class="section-title">${t('p.consent')}</h2>
      <div class="card cal-row">
        <span class="grow"><span data-el="consent-state"></span><span class="small muted" data-el="consent-hint">${t('p.consentHint')}</span></span>
        <button type="button" class="ghost" data-action="consent"></button>
      </div>
      <h2 class="section-title">${t('p.calibration')}</h2>
      <div class="card cal-row">
        <span class="grow"><span data-el="cal-date"></span><span class="small muted">${t('p.distance')}</span></span>
        <button type="button" class="ghost" data-action="calibrate"></button>
      </div>
      <button type="button" class="text-danger" data-action="delete" style="align-self: flex-start; margin-top: 18px">${t('p.deleteLink')}</button>
    </div>
  </div>

  <dialog class="sheet" data-el="delete-sheet" aria-labelledby="delete-title">
    <span class="sheet-grip" aria-hidden="true"></span>
    <h2 class="sheet-title" id="delete-title">${t('p.deleteTitle')}</h2>
    <button type="button" class="ghost" data-action="delete-all">${t('p.deleteAll')}</button>
    <button type="button" class="ghost" data-action="delete-patient" style="color: var(--danger); border-color: var(--danger)">${t('p.deletePatient')}</button>
    <button type="button" class="link" data-action="close-delete">${t('common.cancel')}</button>
  </dialog>
`;

function fill(select, options, selected, placeholder, label = (value) => value) {
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.replaceChildren(
    blank,
    ...options.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label(value);
      return option;
    })
  );
  select.value = options.includes(selected) ? selected : '';
}

export function createProfileScreen(root, { store, isBusy, onChanged, onDeletePatient, onListeningChange = () => {}, onRecordingsDeleted = () => {} }) {
  root.innerHTML = MARKUP();
  const $ = (selector) => root.querySelector(selector);
  const field = (name) => $(`[data-field="${name}"]`);
  const deleteSheet = $('[data-el="delete-sheet"]');
  const patientName = () => {
    const p = store.getProfile();
    return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || t('patient.fallback');
  };

  function render() {
    const p = store.getProfile();
    $('[data-el="name"]').textContent = patientName();
    field('firstName').value = p.firstName ?? '';
    field('lastName').value = p.lastName ?? '';
    field('yearOfBirth').value = p.yearOfBirth ?? '';
    field('yearOfBirth').max = String(new Date().getFullYear());
    fill(field('sex'), SEXES, p.sex, t('p.required'), (value) => t(`sex.${value}`));
    // Highest note first, like a staff reads.
    const notes = [...bandNotesFor(p.sex)].reverse();
    fill(field('fundamentalNote'), notes, p.fundamentalNote, t('p.required'));
    fill(field('rangeLowNote'), notes, p.rangeLowNote, t('p.required'));
    fill(field('rangeHighNote'), notes, p.rangeHighNote, t('p.required'));
    const usable = Boolean(p.rangeLowNote && p.rangeHighNote && isValidRange(p.rangeLowNote, p.rangeHighNote));
    fill(
      field('targetNote'),
      usable ? [...notesInRange(p.rangeLowNote, p.rangeHighNote)].reverse() : [],
      p.targetNote,
      t(usable ? 'p.automatic' : 'p.setRange')
    );

    const note = $('[data-el="voice-note"]');
    const outside = fundamentalOutsideRange(p);
    note.classList.toggle('warn', outside);
    if (outside) note.textContent = t('p.outside');
    else if (p.targetIsAutomatic === false) note.textContent = t('p.byHand');
    else note.textContent = t('p.follows');

    $('[data-el="consent-state"]').textContent = p.consentAt ? t('p.consentOn', { d: longDate(p.consentAt) }) : t('p.consentMissing');
    $('[data-el="consent-hint"]').hidden = Boolean(p.consentAt);
    $('[data-action="consent"]').textContent = t(p.consentAt ? 'p.consentWithdraw' : 'p.consentMark');
    $('[data-action="consent"]').classList.toggle('danger-outline', Boolean(p.consentAt));

    $('[data-el="cal-date"]').textContent = p.calibratedAtMs ? t('p.calibrated', { d: longDate(p.calibratedAtMs) }) : t('p.notCalibrated');
    $('[data-action="calibrate"]').textContent = t(p.calibratedAtMs ? 'p.recalibrate' : 'p.calibrate');

    // While a take is recording or saving, the profile it is measured
    // against must not change under it.
    const busy = isBusy();
    $('[data-el="busy-note"]').hidden = !busy;
    root.querySelectorAll('input, select, [data-action="calibrate"], [data-action="delete"], [data-action="consent"]').forEach((control) => {
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

  function deleteRecordings() {
    const sessions = store.listSessions();
    store.clearSessions();
    deleteAudio(sessions.map((s) => s.id).filter(Boolean)).catch(() => {});
    onRecordingsDeleted();
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

  // Consent: the signed form stays with the practice; the app keeps the date
  // it was marked. Withdrawing deletes this patient's recordings and blocks
  // new ones until consent is on file again.
  $('[data-action="consent"]').addEventListener('click', () => {
    if (isBusy()) return;
    if (!store.getProfile().consentAt) {
      store.saveProfile({ consentAt: Date.now() });
    } else {
      const name = patientName();
      if (!window.confirm(t('p.confirmWithdraw', { name }))) return;
      deleteRecordings();
      store.saveProfile({ consentAt: null });
    }
    render();
    onChanged();
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
    const count = store.listSessions().length;
    if (count === 0) {
      deleteSheet.close();
      return;
    }
    if (!window.confirm(t('p.confirmDeleteAll', { n: count, name: patientName() }))) return;
    deleteRecordings();
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
