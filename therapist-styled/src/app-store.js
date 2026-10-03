// Everything the web app remembers: the profile, and the log of finished
// sessions. Storage is injected rather than reaching for localStorage, so this
// is testable in Node and swappable later for something that syncs.

import { visitStage } from './visit.js';

// The personal web app uses the default prefix and so keeps its original keys.
// The therapist version gives each patient their own prefix.
const DEFAULT_PREFIX = 'fzer0';

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
  toneVolume: 1,
};

// Not crypto.randomUUID: that only exists on HTTPS, and the app is also opened
// over plain HTTP on the local network while testing on a phone.
export function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAppStore(storage, { prefix = DEFAULT_PREFIX } = {}) {
  const PROFILE_KEY = `${prefix}.profile`;
  const SESSIONS_KEY = `${prefix}.sessions`;
  const VISITS_KEY = `${prefix}.visits`;
  const FLAGS_KEY = `${prefix}.flags`;

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

  // Returns what had to go, so the caller can say so — and delete any audio
  // that belonged to it.
  function addSession(summary) {
    const sessions = [...listSessions(), summary];
    const dropped = Math.max(0, sessions.length - MAX_SESSIONS);
    let kept = dropped > 0 ? sessions.slice(dropped) : sessions;
    let gone = sessions.slice(0, dropped);

    try {
      write(SESSIONS_KEY, kept);
    } catch {
      // Out of quota despite the cap — something else on this origin is using
      // the space. Halve the log and try once more; losing the older half
      // beats losing the session that just finished.
      const cut = Math.floor(kept.length / 2);
      gone = [...gone, ...kept.slice(0, cut)];
      kept = kept.slice(cut);
      write(SESSIONS_KEY, kept);
    }

    return { dropped: gone.length, droppedIds: gone.map((s) => s.id).filter(Boolean) };
  }

  function updateSession(id, patch) {
    let updated = null;
    const sessions = listSessions().map((session) => {
      if (session.id !== id) return session;
      updated = { ...session, ...patch };
      return updated;
    });
    if (updated) write(SESSIONS_KEY, sessions);
    return updated;
  }

  function deleteSessions(ids) {
    const doomed = new Set(ids);
    write(
      SESSIONS_KEY,
      listSessions().filter((session) => !doomed.has(session.id))
    );
  }

  function clearSessions() {
    write(SESSIONS_KEY, []);
    write(VISITS_KEY, []);
  }

  function listVisits() {
    const visits = read(VISITS_KEY, []);
    return Array.isArray(visits) ? visits : [];
  }

  function saveVisit(visit) {
    const others = listVisits().filter((v) => v.id !== visit.id);
    write(VISITS_KEY, [...others, visit]);
  }

  function deleteVisit(id) {
    write(
      VISITS_KEY,
      listVisits().filter((v) => v.id !== id)
    );
  }

  function getOpenVisit() {
    return listVisits().find((v) => visitStage(v) !== 'complete') ?? null;
  }

  function readFlags() {
    const flags = read(FLAGS_KEY, {});
    return flags && typeof flags === 'object' && !Array.isArray(flags) ? flags : {};
  }

  function getFlag(name) {
    return readFlags()[name] === true;
  }

  function setFlag(name, value) {
    write(FLAGS_KEY, { ...readFlags(), [name]: Boolean(value) });
  }

  return {
    getProfile,
    saveProfile,
    listSessions,
    addSession,
    updateSession,
    deleteSessions,
    clearSessions,
    listVisits,
    saveVisit,
    deleteVisit,
    getOpenVisit,
    getFlag,
    setFlag,
  };
}
