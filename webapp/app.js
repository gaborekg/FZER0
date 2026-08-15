import { createAppStore } from '../src/app-store.js';
import { createMeasureScreen } from './measure.js';
import { createHistoryScreen } from './history.js';
import { createProfileScreen } from './profile.js';

const TITLES = { measure: 'FZER0', history: 'History', profile: 'Profile' };

const store = createAppStore(window.localStorage);

const titleEl = document.querySelector('[data-el="screen-title"]');
const screens = Object.fromEntries(
  ['measure', 'history', 'profile'].map((name) => [
    name,
    document.querySelector(`[data-screen="${name}"]`),
  ])
);

const recordingBadge = document.querySelector('[data-el="recording-badge"]');

const history = createHistoryScreen(screens.history, { store });

const measure = createMeasureScreen(screens.measure, {
  store,
  onSessionSaved: () => history.render(),
  // An open microphone has to stay visible from every screen, not just the one
  // that opened it.
  onRecordingChange: (recording) => {
    recordingBadge.hidden = !recording;
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
  },
});

function show(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.hidden = key !== name;
  });

  // Measure is sized to the viewport and must not scroll; History and Profile
  // are lists and must. The stylesheet keys off this.
  document.body.dataset.screen = name;

  document.querySelectorAll('[data-tab]').forEach((tab) => {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  titleEl.textContent = TITLES[name];
  // Only Measure shows the product name; the other two are screen names, and
  // the accent colouring belongs to the brand, not to a heading.
  if (name === 'measure') delete titleEl.dataset.plain;
  else titleEl.dataset.plain = 'true';

  if (name === 'history') history.render();
  if (name === 'profile') profile.render();

  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => show(tab.dataset.tab));
});

// Closing the tab mid-session would otherwise lose the whole call. This can't
// save the session — there is no time for that — but it can warn.
window.addEventListener('beforeunload', (event) => {
  if (!measure.isRecording()) return;
  event.preventDefault();
  event.returnValue = '';
});

show('measure');
