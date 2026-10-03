// One patient: Measure, History, Profile. The live-measuring screen is the
// web app's own; everything around it is this app's. Each patient is its own
// page load, so nothing from one patient carries into the next.
import { createPatientList, fullName, patientContext } from './src/patient-list.js';
import { setupStatus } from './src/patient-setup.js';
import { useAudioDatabase, deleteAudio } from './app/audio-store.js';
import { createMeasureScreen } from './app/measure.js';
import { createHistoryScreen } from './history-screen.js';
import { createProfileScreen } from './profile-screen.js';

useAudioDatabase('fzer0-therapist-v2-audio');

const patients = createPatientList(window.localStorage, { namespace: 'fzer0t2' });
const params = new URLSearchParams(window.location.search);
const patientId = params.get('id');

window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

if (!patientId || !patients.hasPatient(patientId)) {
  window.location.replace('./');
} else {
  openPatient(patientId, params.get('tab'));
}

function openPatient(id, firstTab) {
  const base = patients.storeFor(id);
  // Every recording remembers the calibration it was measured with — the one
  // in force when it started — so a comparison across two calibrations can
  // say so.
  let calibrationAtStart = null;
  const store = {
    ...base,
    addSession: (summary) => base.addSession({ ...summary, calibratedAtMs: calibrationAtStart }),
  };
  const currentYear = () => new Date().getFullYear();
  const getPatient = () => {
    const profile = store.getProfile();
    return { ...patientContext(profile), displayName: fullName(profile) };
  };

  const titleEl = document.querySelector('[data-el="title"]');
  const backButton = document.querySelector('[data-action="back"]');
  const badge = document.querySelector('[data-el="recording-badge"]');
  const recordButton = document.querySelector('[data-action="toggle-recording"]');
  const checklistEl = document.querySelector('[data-el="setup-checklist"]');
  const setupTitleEl = document.querySelector('[data-el="setup-title"]');
  const screens = Object.fromEntries(
    ['measure', 'history', 'profile'].map((name) => [name, document.querySelector(`[data-screen="${name}"]`)])
  );

  function showName() {
    const name = fullName(store.getProfile()) || 'Patient';
    titleEl.textContent = name;
    document.title = `${name} · FZER0`;
  }

  function renderChecklist() {
    const status = setupStatus(store.getProfile(), currentYear());
    const first = store.getProfile().firstName || 'this patient';
    setupTitleEl.textContent = `Before ${first}'s first recording`;
    const items = [
      ['Voice notes set', status.notes],
      ['Voice calibrated (5 s)', status.calibrated],
    ];
    checklistEl.replaceChildren(
      ...items.map(([text, done]) => {
        const li = document.createElement('li');
        li.className = done ? 'done' : '';
        li.innerHTML = `<span class="mark" aria-hidden="true">${done ? '✓' : ''}</span><span></span>`;
        li.lastElementChild.textContent = `${text}${done ? '' : ' — missing'}`;
        return li;
      })
    );
  }

  const history = createHistoryScreen(screens.history, { store, getPatient });

  const measure = createMeasureScreen(screens.measure, {
    store,
    getPatient,
    isReady: (profile) => setupStatus(profile, currentYear()).ready,
    onSessionSaved: () => history.render(),
    onRecordingChange: (recording) => {
      if (recording) calibrationAtStart = base.getProfile().calibratedAtMs ?? null;
      badge.hidden = !recording;
      backButton.disabled = recording || measure.isBusy();
      profile.render();
    },
    onBusyChange: () => {
      backButton.disabled = measure.isBusy();
      profile.render();
    },
    onNeedsSetup: renderChecklist,
  });

  const profile = createProfileScreen(screens.profile, {
    store,
    isBusy: () => measure.isBusy(),
    // No recording while a calibration is listening: one microphone, one job.
    onCalibratingChange: (calibrating) => {
      recordButton.disabled = calibrating;
    },
    onChanged: () => {
      measure.refreshProfile();
      renderChecklist();
      history.render();
      showName();
    },
    onDeletePatient: async () => {
      if (measure.isBusy()) return;
      const name = fullName(store.getProfile()) || 'this patient';
      if (!window.confirm(`Delete ${name} and all their recordings? This cannot be undone.`)) return;
      const ids = patients.deletePatient(id);
      await deleteAudio(ids).catch(() => {});
      window.location.replace('./');
    },
  });

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    document.body.dataset.screen = name;
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (name === 'history') history.render();
    if (name === 'profile') profile.render();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.tab)));
  document.querySelector('[data-action="go-to-profile"]').addEventListener('click', () => show('profile'));

  backButton.addEventListener('click', () => {
    if (measure.isBusy()) return;
    window.location.href = './';
  });

  window.addEventListener('beforeunload', (event) => {
    if (!measure.isBusy()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  showName();
  renderChecklist();
  show(['measure', 'history', 'profile'].includes(firstTab) ? firstTab : 'measure');
}
