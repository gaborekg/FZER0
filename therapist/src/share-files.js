// Names for the files handed to the share sheet. Every name starts with the
// date, so a Files folder holding months of visits sorts itself.

const pad = (n) => String(n).padStart(2, '0');

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A hyphen, not a colon: colons are not allowed in file names everywhere.
function localTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

const EXTENSIONS = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
};

// Safari, the target, records audio/mp4. Anything unrecognised is most likely
// that too, under a name this table does not know.
export function audioExtension(mimeType) {
  const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? 'm4a';
}

// With a patient (the therapist version) their label follows the date, so a
// Files folder holding several people never mixes them up.
export function visitFileNames(startedAtMs, otherVisitStarts, { beforeExt, afterExt }, person) {
  const day = localDate(startedAtMs);
  const clash = otherVisitStarts.some((ms) => localDate(ms) === day);
  const when = clash ? `${day} ${localTime(startedAtMs)}` : day;
  const base = person ? `${when} ${person} - visit` : `${when} visit`;
  return {
    before: `${base} - before.${beforeExt}`,
    after: `${base} - after.${afterExt}`,
    results: `${base} - results.txt`,
  };
}

export function sessionFileNames(startedAtMs, ext, person) {
  const when = `${localDate(startedAtMs)} ${localTime(startedAtMs)}`;
  const base = person ? `${when} ${person} - session` : `${when} session`;
  return { audio: `${base}.${ext}`, results: `${base} - results.txt` };
}
