const DEFAULT_STORAGE =
  typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : undefined;

// Matches the web app's cap. Far below what the storage area holds — it exists
// so the log can't grow without bound over years.
const MAX_SESSIONS = 200;

export function createPrefsStore(storage = DEFAULT_STORAGE) {
  if (!storage) {
    throw new Error('No storage backend available; pass one explicitly for tests.');
  }

  function getSetup() {
    return new Promise((resolve) => {
      storage.get(['rangeLowNote', 'rangeHighNote', 'targetNote', 'referenceToneNote'], (result) => {
        resolve({
          rangeLowNote: result.rangeLowNote ?? null,
          rangeHighNote: result.rangeHighNote ?? null,
          targetNote: result.targetNote ?? null,
          referenceToneNote: result.referenceToneNote ?? null,
        });
      });
    });
  }

  function set(values) {
    return new Promise((resolve, reject) => {
      storage.set(values, () => {
        // Real chrome.storage.local calls never reject the callback itself —
        // failure (quota exceeded, invalidated extension context, etc.)
        // surfaces only via chrome.runtime.lastError inside this callback.
        // Guarded with typeof/&& (not optional chaining on `chrome` itself)
        // so this doesn't throw a ReferenceError under the Node test's fake
        // storage, which runs with no `chrome` global at all.
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  function saveSetup({ rangeLowNote, rangeHighNote, targetNote, referenceToneNote }) {
    return set({
      rangeLowNote,
      rangeHighNote,
      targetNote,
      referenceToneNote: referenceToneNote ?? targetNote,
    });
  }

  // Calibration lives under its own keys rather than inside the setup object.
  // saveSetup writes a fixed set of keys, so folding these in would mean every
  // range/target edit silently overwrote the measurements with whatever the
  // panel happened to be holding.
  function getCalibration() {
    return new Promise((resolve) => {
      storage.get(['volumeCeilingRms', 'typicalRms', 'toneVolume'], (result) => {
        resolve({
          volumeCeilingRms: result.volumeCeilingRms ?? null,
          typicalRms: result.typicalRms ?? null,
          toneVolume: typeof result.toneVolume === 'number' ? result.toneVolume : 1,
        });
      });
    });
  }

  function saveCalibration({ volumeCeilingRms, typicalRms, toneVolume = 1 }) {
    return set({ volumeCeilingRms, typicalRms, toneVolume });
  }

  // The record of finished calls. Same shape and the same cap as the web app's
  // log — the two stores cannot see each other, but there is no reason for the
  // data in them to differ.
  function getSessions() {
    return new Promise((resolve) => {
      storage.get(['sessions'], (result) => {
        resolve(Array.isArray(result.sessions) ? result.sessions : []);
      });
    });
  }

  async function addSession(summary) {
    const sessions = [...(await getSessions()), summary];
    const dropped = Math.max(0, sessions.length - MAX_SESSIONS);
    await set({ sessions: dropped > 0 ? sessions.slice(dropped) : sessions });
    return { dropped };
  }

  // Where the panel sits and whether it was minimised. Its own keys, like the
  // calibration, so saving a range can never move the panel and vice versa.
  function getPlacement() {
    return new Promise((resolve) => {
      storage.get(['panelLeft', 'panelTop', 'panelView'], (result) => {
        resolve({
          left: typeof result.panelLeft === 'number' ? result.panelLeft : null,
          top: typeof result.panelTop === 'number' ? result.panelTop : null,
          view: result.panelView === 'mini' ? 'mini' : 'face',
        });
      });
    });
  }

  function savePlacement({ left, top, view }) {
    return set({ panelLeft: left, panelTop: top, panelView: view });
  }

  return {
    getSetup,
    saveSetup,
    getCalibration,
    saveCalibration,
    getSessions,
    addSession,
    getPlacement,
    savePlacement,
  };
}
