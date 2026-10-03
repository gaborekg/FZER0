// The start screen: the therapist's patients, as cards. Adding asks only for
// the name; the patient's Profile opens next for everything else.
import { createPatientList, fullName } from './src/patient-list.js';
import { patientSummary } from './src/patient-summary.js';

const patients = createPatientList(window.localStorage, { namespace: 'fzer0s' });

// Back from a patient restores this page from memory; reload so the list is
// current and an old filled-in sheet cannot add the same patient twice.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

const listEl = document.querySelector('[data-el="patient-list"]');
const emptyEl = document.querySelector('[data-el="empty"]');
const sheet = document.querySelector('[data-el="add-sheet"]');
const firstInput = document.querySelector('[data-field="firstName"]');
const lastInput = document.querySelector('[data-field="lastName"]');
const saveButton = document.querySelector('[data-action="save-patient"]');

function renderList() {
  const all = patients.listPatients();
  listEl.hidden = all.length === 0;
  emptyEl.hidden = all.length > 0;
  listEl.replaceChildren(
    ...all.map(({ id, profile }) => {
      const li = document.createElement('li');
      const card = document.createElement('a');
      card.className = 'card patient-card';
      card.href = `patient.html?id=${encodeURIComponent(id)}`;
      const name = document.createElement('span');
      name.className = 'patient-name';
      name.textContent = fullName(profile) || 'Unnamed patient';
      card.appendChild(name);

      const summary = patientSummary(patients.storeFor(id).listSessions(), profile.targetNote);
      const lines = summary ? [summary.last, summary.overall].filter(Boolean) : [{ text: 'No recordings yet', tone: '' }];
      lines.forEach(({ text, tone }) => {
        const line = document.createElement('span');
        line.className = `summary ${tone}`.trim();
        line.textContent = text;
        card.appendChild(line);
      });
      li.appendChild(card);
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
  window.location.href = `patient.html?id=${encodeURIComponent(id)}&tab=profile`;
});

renderList();
