// The therapist version's patients. Each patient's data lives under their own
// key prefix, through the same store the web app uses; this file only keeps
// the index of who exists, and the rules for adding someone.
import { createAppStore, makeId } from './app-store.js';
import { notesInRange, isValidRange } from './note-hz.js';

// v1 of the therapist app uses the default; v2 keeps its own patients apart.
const DEFAULT_NAMESPACE = 'fzer0t';
const STORE_PARTS = ['profile', 'sessions', 'visits', 'flags'];

export function patientPrefix(id, namespace = DEFAULT_NAMESPACE) {
  return `${namespace}.patient.${id}`;
}

export function fullName(profile) {
  return [profile.firstName, profile.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

const blank = (value) => !String(value ?? '').trim();

function validYear(yearOfBirth, currentYear) {
  const year = Number(yearOfBirth);
  return !blank(yearOfBirth) && Number.isInteger(year) && year >= 1900 && year <= currentYear;
}

// Everything a measurement needs to mean something, entered once.
export function missingSetup(profile, currentYear) {
  const missing = [];
  if (blank(profile.firstName)) missing.push('First name');
  if (blank(profile.lastName)) missing.push('Last name');
  if (!validYear(profile.yearOfBirth, currentYear)) missing.push('Year of birth');
  if (blank(profile.sex)) missing.push('Sex');
  if (blank(profile.fundamentalNote)) missing.push('Fundamental tone');
  if (blank(profile.rangeLowNote)) missing.push('Lowest note');
  if (blank(profile.rangeHighNote)) missing.push('Highest note');

  const bothNotes = !blank(profile.rangeLowNote) && !blank(profile.rangeHighNote);
  const rangeOk = bothNotes && isValidRange(profile.rangeLowNote, profile.rangeHighNote);
  if (bothNotes && !rangeOk) missing.push('A range where the lowest note is below the highest');

  const targetOk =
    !blank(profile.targetNote) &&
    rangeOk &&
    notesInRange(profile.rangeLowNote, profile.rangeHighNote).includes(profile.targetNote);
  if (!targetOk) missing.push('Target note');

  return missing;
}

function initial(lastName) {
  const letter = String(lastName ?? '').replace(/[^\p{L}]/gu, '').charAt(0);
  return letter ? letter.toUpperCase() : '';
}

export function displayName(profile) {
  const first = String(profile.firstName ?? '').trim();
  const last = initial(profile.lastName);
  return last ? `${first} ${last}.` : first;
}

// For file names: the full last name, so two patients who share a first name
// and initial (Ana Berg, Ana Bauer) never get the same files. No dots, and
// none of the characters Files or Windows refuse.
const fileSafe = (text) =>
  String(text ?? '')
    .replace(/[\\/:*?"<>|.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export function fileLabel(profile) {
  return [fileSafe(profile.firstName), fileSafe(profile.lastName)].filter(Boolean).join(' ');
}

export function ageFrom(yearOfBirth, currentYear) {
  const year = Number(yearOfBirth);
  if (blank(yearOfBirth) || !Number.isInteger(year)) return null;
  return currentYear - year;
}

export function patientContext(profile) {
  return {
    displayName: displayName(profile),
    fileName: fileLabel(profile),
    yearOfBirth: String(profile.yearOfBirth ?? ''),
  };
}

export function createPatientList(storage, { namespace = DEFAULT_NAMESPACE } = {}) {
  const INDEX_KEY = `${namespace}.patients`;

  function ids() {
    try {
      const value = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  const writeIds = (list) => storage.setItem(INDEX_KEY, JSON.stringify(list));
  const storeFor = (id) => createAppStore(storage, { prefix: patientPrefix(id, namespace) });

  return {
    listPatients() {
      return ids()
        .map((id) => ({ id, profile: storeFor(id).getProfile() }))
        .sort(
          (a, b) =>
            a.profile.firstName.localeCompare(b.profile.firstName) ||
            a.profile.lastName.localeCompare(b.profile.lastName)
        );
    },

    addPatient(profile) {
      const id = makeId();
      storeFor(id).saveProfile(profile);
      writeIds([...ids(), id]);
      return id;
    },

    hasPatient: (id) => ids().includes(id),

    storeFor,

    // Returns the session ids, so the caller can delete their recordings too.
    deletePatient(id) {
      const sessionIds = storeFor(id)
        .listSessions()
        .map((s) => s.id)
        .filter(Boolean);
      STORE_PARTS.forEach((part) => storage.removeItem(`${patientPrefix(id, namespace)}.${part}`));
      writeIds(ids().filter((other) => other !== id));
      return sessionIds;
    },
  };
}
