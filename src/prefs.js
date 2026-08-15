const DEFAULT_STORAGE =
  typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : undefined;

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
      storage.get(['volumeCeilingRms', 'typicalRms'], (result) => {
        resolve({
          volumeCeilingRms: result.volumeCeilingRms ?? null,
          typicalRms: result.typicalRms ?? null,
        });
      });
    });
  }

  function saveCalibration({ volumeCeilingRms, typicalRms }) {
    return set({ volumeCeilingRms, typicalRms });
  }

  return { getSetup, saveSetup, getCalibration, saveCalibration };
}
