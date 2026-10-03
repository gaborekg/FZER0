// One patient: Measure, History, Profile. Each patient is its own page load,
// so nothing from one patient carries into the next.
import { createPatientList, fullName, patientContext } from './src/patient-list.js';
import { useAudioDatabase, deleteAudio } from './app/audio-store.js';
import { createMeasureScreen } from './measure-screen.js';
import { createHistoryScreen } from './history-screen.js';
import { createProfileScreen } from './profile-screen.js';
import { t, applyStatic } from './i18n.js';

applyStatic();

useAudioDatabase('fzer0-styled-audio');

const patients = createPatientList(window.localStorage, { namespace: 'fzer0s' });
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
  const store = patients.storeFor(id);
  const getPatient = () => {
    const profile = store.getProfile();
    return { ...patientContext(profile), displayName: fullName(profile) || t('patient.fallback') };
  };
  const back = document.querySelector('[data-el="back"]');
  const titleEl = document.querySelector('[data-el="title"]');
  const screens = Object.fromEntries(
    ['measure', 'history', 'profile'].map((name) => [name, document.querySelector(`[data-screen="${name}"]`)])
  );
  let current = null;

  // Top bar, as on the canvas: the name on Measure, "Name · History", "Profile".
  function showName() {
    const name = getPatient().displayName;
    titleEl.textContent = current === 'history' ? t('title.history', { name }) : current === 'profile' ? t('title.profile') : name;
    document.title = `${name} · FZero`;
  }

  const history = createHistoryScreen(screens.history, { store, getPatient });

  // The back link is hidden while a take is recording or saving: leaving
  // then would lose it.
  const syncBusy = () => {
    back.style.visibility = measure.isBusy() ? 'hidden' : '';
    profile.render();
  };

  const measure = createMeasureScreen(screens.measure, {
    store,
    getPatient,
    onSessionSaved: () => history.render(),
    onRecordingChange: syncBusy,
    onBusyChange: syncBusy,
    onOpenProfile: () => show('profile'),
    onOpenHistory: () => show('history'),
  });

  const profile = createProfileScreen(screens.profile, {
    store,
    isBusy: () => measure.isBusy(),
    onListeningChange: (on) => measure.setListening(on),
    onRecordingsDeleted: () => measure.forgetUndo(),
    onChanged: () => {
      measure.refreshProfile();
      history.render();
      showName();
    },
    onDeletePatient: async () => {
      if (measure.isBusy()) return;
      const name = fullName(store.getProfile()) || t('patient.fallback');
      if (!window.confirm(t('confirm.deletePatient', { name }))) return;
      const ids = patients.deletePatient(id);
      await deleteAudio(ids).catch(() => {});
      window.location.replace('./');
    },
  });

  async function show(name) {
    if (current === name) return;
    if (current === 'measure') await measure.hide();
    current = name;
    Object.entries(screens).forEach(([key, node]) => {
      node.hidden = key !== name;
    });
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    showName();
    if (name === 'history') history.render();
    if (name === 'profile') profile.render();
    window.scrollTo(0, 0);
    if (name === 'measure') await measure.show();
  }

  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => show(tab.dataset.tab)));

  window.addEventListener('beforeunload', (event) => {
    if (!measure.isBusy()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  showName();
  show(['measure', 'history', 'profile'].includes(firstTab) ? firstTab : 'measure');
}
