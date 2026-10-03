// The therapist's start screen: who the patients are, and adding a new one.
// Opening a patient is a page load, so nothing from one patient's session can
// carry over into the next.
import { createPatientList, missingSetup, displayName, ageFrom } from './src/patient-list.js';
import { bandNotesFor } from './src/voice-bands.js';
import { notesInRange, isValidRange } from './src/note-hz.js';

const patients = createPatientList(window.localStorage);

// Back from a patient restores this page from the browser's memory, with
// whatever it showed then — an old list, or a filled-in form whose Save would
// add the same patient again. Reload instead.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
const currentYear = () => new Date().getFullYear();

const listView = document.querySelector('[data-el="list-view"]');
const addView = document.querySelector('[data-el="add-view"]');
const listEl = document.querySelector('[data-el="patient-list"]');
const titleEl = document.querySelector('[data-el="title"]');
const missingEl = document.querySelector('[data-el="missing"]');
const saveButton = document.querySelector('[data-action="save-patient"]');

const FIELDS = [
  'firstName',
  'lastName',
  'yearOfBirth',
  'sex',
  'fundamentalNote',
  'rangeLowNote',
  'rangeHighNote',
  'targetNote',
];
const inputs = Object.fromEntries(FIELDS.map((name) => [name, document.querySelector(`[data-field="${name}"]`)]));

const openPatient = (id) => {
  window.location.href = `patient.html?id=${encodeURIComponent(id)}`;
};

function renderList() {
  listEl.replaceChildren();
  const all = patients.listPatients();
  if (all.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No patients yet. Add your first one.';
    listEl.appendChild(empty);
    return;
  }

  all.forEach(({ id, profile }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'patient-row';
    const age = ageFrom(profile.yearOfBirth, currentYear());
    const meta = [age === null ? null : String(age), profile.sex || null, profile.targetNote || null]
      .filter(Boolean)
      .join(' · ');
    row.innerHTML = `
      <span>
        <span class="patient-name"></span><br />
        <span class="patient-meta"></span>
      </span>
      <span class="session-chevron" aria-hidden="true">›</span>
    `;
    // textContent, not innerHTML: names are typed by a person.
    row.querySelector('.patient-name').textContent = displayName(profile);
    row.querySelector('.patient-meta').textContent = meta;
    row.addEventListener('click', () => openPatient(id));
    listEl.appendChild(row);
  });
}

function fillSelect(select, notes, selected) {
  select.replaceChildren();
  const blankOption = document.createElement('option');
  blankOption.value = '';
  blankOption.textContent = '—';
  select.appendChild(blankOption);
  notes.forEach((note) => {
    const option = document.createElement('option');
    option.value = note;
    option.textContent = note;
    select.appendChild(option);
  });
  select.value = notes.includes(selected) ? selected : '';
}

function draft() {
  return Object.fromEntries(FIELDS.map((name) => [name, inputs[name].value.trim()]));
}

// The note pickers follow the voice band for the chosen sex, and the target
// follows the chosen range — the same rules as Profile.
function refreshNotes() {
  const current = draft();
  const notes = bandNotesFor(current.sex);
  fillSelect(inputs.fundamentalNote, notes, current.fundamentalNote);
  fillSelect(inputs.rangeLowNote, notes, current.rangeLowNote);
  fillSelect(inputs.rangeHighNote, notes, current.rangeHighNote);

  const low = inputs.rangeLowNote.value;
  const high = inputs.rangeHighNote.value;
  const usable = low && high && isValidRange(low, high);
  fillSelect(inputs.targetNote, usable ? notesInRange(low, high) : [], current.targetNote);
  inputs.targetNote.disabled = !usable;
}

function refreshValidity() {
  const missing = missingSetup(draft(), currentYear());
  saveButton.disabled = missing.length > 0;
  missingEl.textContent = missing.length > 0 ? `Still needed: ${missing.join(', ')}.` : '';
}

function showAdd() {
  FIELDS.forEach((name) => {
    inputs[name].value = '';
  });
  inputs.yearOfBirth.max = String(currentYear());
  refreshNotes();
  refreshValidity();
  listView.hidden = true;
  addView.hidden = false;
  titleEl.textContent = 'Add patient';
  inputs.firstName.focus();
}

function showList() {
  addView.hidden = true;
  listView.hidden = false;
  titleEl.textContent = 'Patients';
  renderList();
}

FIELDS.forEach((name) => {
  const event = inputs[name].tagName === 'SELECT' ? 'change' : 'input';
  inputs[name].addEventListener(event, () => {
    if (['sex', 'rangeLowNote', 'rangeHighNote'].includes(name)) refreshNotes();
    refreshValidity();
  });
});

document.querySelector('[data-action="add-patient"]').addEventListener('click', showAdd);
document.querySelector('[data-action="cancel-add"]').addEventListener('click', showList);

saveButton.addEventListener('click', () => {
  // A second tap must not add the same patient twice.
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  const profile = draft();
  if (missingSetup(profile, currentYear()).length > 0) return;
  openPatient(patients.addPatient(profile));
});

showList();
