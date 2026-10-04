// The start screen: the therapist's patients, as cards. Adding asks only for
// the name; the patient's Profile opens next for everything else.
import { createPatientList, fullName } from './src/patient-list.js';
import { groupDays } from './src/day-groups.js';
import { shortWords, shapeColour, textColour } from './zone.js';
import { takeOff, sinceFirstDay } from './take-stats.js';
import { t, applyStatic, setLang, LANG, shortDate as shortDay } from './i18n.js';

applyStatic();
document.title = t('patients.pageTitle');

// The language of the app on this device.
document.querySelectorAll('[data-lang]').forEach((button) => {
  // Exactly one button is marked: the language the app is showing.
  if (button.dataset.lang === LANG) button.setAttribute('aria-current', 'true');
  else button.removeAttribute('aria-current');
  button.addEventListener('click', () => {
    if (button.dataset.lang !== LANG) setLang(button.dataset.lang);
  });
});
const span = (className, text) => {
  const node = document.createElement('span');
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Where the last session ended, against the target; and how that compares
// with where the first day ended.
function cardLines(sessions, target) {
  const days = groupDays(sessions);
  if (days.length === 0 || !target) return [span('summary', t('card.noRecordings'))];
  const latest = days[0];
  const endOff = takeOff(latest.last, target);
  const zone = span('zone-line summary-zone');
  const dot = span('zone-dot');
  dot.setAttribute('aria-hidden', 'true');
  if (endOff !== null) {
    dot.style.background = shapeColour(endOff);
    zone.style.color = textColour(endOff);
  }
  zone.append(dot, document.createTextNode(shortWords(endOff)));
  const lines = [span('summary', t('card.lastSession', { d: shortDay(latest.key) })), zone];
  if (days.length === 1) {
    lines.push(span('summary', t('card.firstDay', { t: target })));
  } else {
    const since = sinceFirstDay(takeOff(days[days.length - 1].last, target), endOff, target);
    if (since) lines.push(span('summary', since));
  }
  return lines;
}

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
      const top = span('patient-top');
      const chevron = span('muted patient-chevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      top.append(span('patient-name', fullName(profile) || t('card.unnamed')), chevron);
      card.append(top, ...cardLines(patients.storeFor(id).listSessions(), profile.targetNote));
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
  document.querySelector('[data-field="consent"]').checked = false;
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
  const consentAt = document.querySelector('[data-field="consent"]').checked ? Date.now() : null;
  const id = patients.addPatient({ firstName: firstInput.value.trim(), lastName: lastInput.value.trim(), consentAt });
  window.location.href = `patient.html?id=${encodeURIComponent(id)}&tab=profile`;
});

renderList();
