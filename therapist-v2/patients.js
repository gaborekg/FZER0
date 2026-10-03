// The start screen: the therapist's patients, by name. Adding asks only for
// the name; the patient's Profile opens next for everything else.
import { createPatientList, fullName } from './src/patient-list.js';
import { patientSummary } from './src/patient-summary.js';

const NAMESPACE = 'fzer0t2';
const patients = createPatientList(window.localStorage, { namespace: NAMESPACE });

// Back from a patient restores this page from memory; reload so the list is
// current and an old filled-in sheet cannot add the same patient twice.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

const listEl = document.querySelector('[data-el="patient-list"]');
const listGroup = document.querySelector('[data-el="list-group"]');
const emptyEl = document.querySelector('[data-el="empty"]');
const sheet = document.querySelector('[data-el="add-sheet"]');
const firstInput = document.querySelector('[data-field="firstName"]');
const lastInput = document.querySelector('[data-field="lastName"]');
const saveButton = document.querySelector('[data-action="save-patient"]');

const CHEVRON = '<svg class="chevron" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" /></svg>';

function renderList() {
  const all = patients.listPatients();
  listGroup.hidden = all.length === 0;
  emptyEl.hidden = all.length > 0;
  listEl.replaceChildren(
    ...all.map(({ id, profile }) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'cell';
      link.href = `patient.html?id=${encodeURIComponent(id)}`;
      link.innerHTML = `<span class="cell-title"><span class="patient-name"></span></span>${CHEVRON}`;
      const title = link.querySelector('.cell-title');
      // textContent: names are typed by a person.
      title.firstElementChild.textContent = fullName(profile) || 'Unnamed patient';

      // Where things stood: the last session day, and its start against the
      // first day's start. The same figures History shows.
      const summary = patientSummary(patients.storeFor(id).listSessions(), profile.targetNote);
      const lines = summary ? [summary.last, summary.overall].filter(Boolean) : [{ text: 'No recordings yet', tone: '' }];
      lines.forEach(({ text, tone }) => {
        const line = document.createElement('small');
        line.className = `summary ${tone}`.trim();
        line.textContent = text;
        title.appendChild(line);
      });
      li.appendChild(link);
      return li;
    })
  );
}

const nameOk = () => firstInput.value.trim() !== '' && lastInput.value.trim() !== '';
const refreshSave = () => {
  saveButton.disabled = !nameOk();
};

document.querySelector('[data-action="add-patient"]').addEventListener('click', () => {
  firstInput.value = '';
  lastInput.value = '';
  refreshSave();
  sheet.showModal();
  firstInput.focus();
});
document.querySelector('[data-action="cancel-add"]').addEventListener('click', () => sheet.close());
[firstInput, lastInput].forEach((input) => input.addEventListener('input', refreshSave));
lastInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && nameOk()) saveButton.click();
});

saveButton.addEventListener('click', () => {
  if (saveButton.disabled || !nameOk()) return;
  saveButton.disabled = true;
  const id = patients.addPatient({ firstName: firstInput.value.trim(), lastName: lastInput.value.trim() });
  // Audio on by default for every new patient.
  patients.storeFor(id).setFlag('recordAudio', true);
  window.location.href = `patient.html?id=${encodeURIComponent(id)}&tab=profile`;
});

renderList();
