// Everything the web app remembers: the profile, and the log of finished
// sessions. Storage is injected rather than reaching for localStorage, so this
// is testable in Node and swappable later for something that syncs.

const PROFILE_KEY = 'fzer0.profile';
const SESSIONS_KEY = 'fzer0.sessions';

// localStorage gives roughly 5 MB. A summary is well under 1 KB, so 200 is
// nowhere near the limit — the cap exists so the list can't grow without
// bound over years, not because space is tight. Oldest go first, and callers
// are told when that happens rather than losing records quietly.
export const MAX_SESSIONS = 200;

export const EMPTY_PROFILE = {
  firstName: '',
  lastName: '',
  yearOfBirth: '',
  sex: '',
  fundamentalNote: '',
  rangeLowNote: '',
  rangeHighNote: '',
  targetNote: '',
  volumeCeilingRms: null,
  typicalRms: null,
};

export function createAppStore(storage) {
  function read(key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      // Corrupt or hand-edited JSON shouldn't take the whole app down with it.
      return fallback;
    }
  }

  function write(key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function getProfile() {
    return { ...EMPTY_PROFILE, ...read(PROFILE_KEY, {}) };
  }

  function saveProfile(patch) {
    const next = { ...getProfile(), ...patch };
    write(PROFILE_KEY, next);
    return next;
  }

  function listSessions() {
    const sessions = read(SESSIONS_KEY, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  // Returns how many old sessions had to go, so the caller can say so.
  function addSession(summary) {
    const sessions = [...listSessions(), summary];
    const dropped = Math.max(0, sessions.length - MAX_SESSIONS);
    const kept = dropped > 0 ? sessions.slice(dropped) : sessions;

    try {
      write(SESSIONS_KEY, kept);
    } catch {
      // Out of quota despite the cap — something else on this origin is using
      // the space. Halve the log and try once more; losing the older half
      // beats losing the session that just finished.
      const halved = kept.slice(Math.floor(kept.length / 2));
      write(SESSIONS_KEY, halved);
      return { dropped: kept.length - halved.length + dropped };
    }

    return { dropped };
  }

  function clearSessions() {
    write(SESSIONS_KEY, []);
  }

  return { getProfile, saveProfile, listSessions, addSession, clearSessions };
}
