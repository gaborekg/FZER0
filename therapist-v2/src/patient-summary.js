// The two short lines under a patient's name on the Patients list: what the
// last session day did, and where that day started compared with the first.
// Enough to remember where things stood last week.
import { groupDays, describeSemitones } from './day-groups.js';
import { summariseProgress, towardsTarget } from './progress.js';
import { hzToNote, noteToHz } from './note-hz.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (key) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};

export function patientSummary(sessions, targetNote) {
  const days = groupDays(sessions);
  if (days.length === 0) return null;

  const targetHz = targetNote ? noteToHz(targetNote) : null;
  const progress = summariseProgress(days);
  const day = progress.today.day;
  const when = shortDay(day.key);

  let last;
  if (progress.today.single) {
    last = { text: `${when} · ${day.first.meanHz ? hzToNote(day.first.meanHz) : '—'} · one recording`, tone: '' };
  } else if (day.first.meanHz && day.last.meanHz) {
    last = {
      text: `${when} · ${hzToNote(day.first.meanHz)} → ${hzToNote(day.last.meanHz)}  ${describeSemitones(progress.today.semitones)}`,
      tone: towardsTarget(day.first.meanHz, day.last.meanHz, targetHz),
    };
  } else {
    last = { text: `${when} · ${day.recordings.length} recordings`, tone: '' };
  }

  const first = progress.first ?? (progress.previousIsFirst ? progress.previous : null);
  const overall =
    first && first.startSemitones !== null
      ? {
          text: `Since first day (${shortDay(first.day.key)}): ${describeSemitones(first.startSemitones)}`,
          tone: towardsTarget(first.day.first.meanHz, day.first.meanHz, targetHz),
        }
      : null;

  return { last, overall };
}
