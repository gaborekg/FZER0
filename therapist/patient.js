// One patient's Measure, History and Profile — the web app's own screens,
// pointed at this patient's storage. Mirrors webapp/app.js; the differences
// are the store, the title (always the patient's name), the back button and
// Delete patient.
import { createPatientList, patientContext, displayName } from './src/patient-list.js';
import { useAudioDatabase, deleteAudio } from './app/audio-store.js';
import { createMeasureScreen } from './app/measure.js';
import { createHistoryScreen } from './app/history.js';
import { createProfileScreen } from './app/profile.js';

// Before anything touches audio: every patient's recordings live here, never
// in Gabor's own database.
useAudioDatabase('fzer0-therapist-audio');

const patients = createPatientList(window.localStorage);
const patientId = new URLSearchParams(window.location.search).get('id');

// A page brought back by the browser's Back button is not reloaded, so the
// check below would not run again — and the patient may have been deleted
// since. Reloading makes it run.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

if (!patientId || !patients.hasPatient(patientId)) {
  window.location.replace('./');
} else {
  openPatient(patientId);
}

function openPatient(id) {
  const store = patients.storeFor(id);
  const getPatient = () => patientContext(store.getProfile());

  const titleEl = document.querySelector('[data-el="screen-title"]');
  const backButton = document.querySelector('[data-action="back"]');
  const recordingBadge = document.querySelector('[data-el="recording-badge"]');
  const screens = Object.fromEntries(
    ['measure', 'history', 'profile'].map((name) => [name, document.querySelector(`[data-screen="${name}"]`)])
  );

  // The name stays in the bar on every screen: the one thing that prevents
  // measuring the wrong person.
  const showName = () => {
    const name = displayName(store.getProfile());
    titleEl.textContent = name;
    document.title = `${name} · FZER0`;
  };

  const history = createHistoryScreen(screens.history, { store, getPatient });

  const measure = createMeasureScreen(screens.measure, {
    store,
    getPatient,
    onSessionSaved: () => history.render(),
    onRecordingChange: (recording) => {
      recordingBadge.hidden = !recording;
      backButton.disabled = recording || measure.isBusy();
    },
    // Stays disabled until the take is saved, not just until Stop.
    onBusyChange: () => {
      backButton.disabled = measure.isBusy();
    },
    onNeedsSetup: () => {},
  });

  screens.measure
    .querySelector('[data-action="go-to-profile"]')
    .addEventListener('click', () => show('profile'));

  const profile = createProfileScreen(screens.profile, {
    store,
    isRecording: () => measure.isRecording(),
    onProfileChanged: () => {
      measure.refreshProfile();
      history.render();
      showName();
    },
  });

  function show(name) {
    Object.entries(screens).forEach(([key, element]) => {
      element.hidden = key !== name;
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

  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => show(tab.dataset.tab));
  });

  backButton.addEventListener('click', () => {
    if (measure.isBusy()) return;
    window.location.href = './';
  });

  document.querySelector('[data-action="delete-patient"]').addEventListener('click', async () => {
    if (measure.isBusy()) return;
    const name = displayName(store.getProfile());
    const confirmed = window.confirm(
      `Delete ${name} and all their sessions and recordings? This cannot be undone.`
    );
    if (!confirmed) return;
    const sessionIds = patients.deletePatient(id);
    await deleteAudio(sessionIds).catch(() => {});
    window.location.replace('./');
  });

  window.addEventListener('beforeunload', (event) => {
    if (!measure.isBusy()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  showName();
  show('measure');
}
