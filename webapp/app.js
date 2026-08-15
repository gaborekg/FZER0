import { createAppStore } from '../src/app-store.js';
import { createMeasureScreen } from './measure.js';
import { createHistoryScreen } from './history.js';
import { createProfileScreen } from './profile.js';

const TITLES = { measure: 'FZER0', history: 'History', profile: 'Profile' };

const store = createAppStore(window.localStorage);

const navTitleEl = document.querySelector('[data-el="nav-title"]');
const largeTitleEl = document.querySelector('[data-el="large-title"]');
const screens = Object.fromEntries(
  ['measure', 'history', 'profile'].map((name) => [
    name,
    document.querySelector(`[data-screen="${name}"]`),
  ])
);

const history = createHistoryScreen(screens.history, { store });

const measure = createMeasureScreen(screens.measure, {
  store,
  onSessionSaved: () => history.render(),
});

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

  document.querySelectorAll('[data-tab]').forEach((tab) => {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });

  // Only Measure is titled with the product name; the other two are named
  // after themselves, and the tint belongs to the brand rather than to any
  // heading.
  [navTitleEl, largeTitleEl].forEach((element) => {
    element.textContent = TITLES[name];
    if (name === 'measure') element.dataset.brand = 'true';
    else delete element.dataset.brand;
  });

  if (name === 'history') history.render();
  if (name === 'profile') profile.render();

  window.scrollTo(0, 0);
  syncScrollState();
}

// The inline title fades in only once the large one has scrolled away — the
// standard iOS navigation bar behaviour, which is also the only thing keeping
// the two titles from being on screen at the same time.
function syncScrollState() {
  document.body.dataset.scrolled = window.scrollY > 28 ? 'true' : 'false';
}

window.addEventListener('scroll', syncScrollState, { passive: true });

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
