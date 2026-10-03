// The files for "Share day": every recording of the day that still has its
// audio, plus the day's results.txt.
import { getAudio } from './app/audio-store.js';
import { audioExtension } from './src/share-files.js';
import { dayFileNames, buildDayResultsText } from './src/day-files.js';

export async function filesForDay(day, patient) {
  const blobs = await Promise.all(
    day.recordings.map((r) => (r.session.hasAudio ? getAudio(r.session.id).catch(() => null) : null))
  );
  const names = dayFileNames(day, patient?.fileName ?? '', (r) => audioExtension(blobs[r.position - 1]?.type));
  const files = [];
  blobs.forEach((blob, i) => {
    if (blob) files.push(new File([blob], names.recordings[i], { type: blob.type || 'audio/mp4' }));
  });
  files.push(new File([buildDayResultsText(day, patient)], names.results, { type: 'text/plain' }));
  return files;
}
