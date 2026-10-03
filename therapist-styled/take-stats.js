// The 7 values every take shows, and the words comparing two takes. Each take
// is read against the target it was recorded with, so it stays true after the
// target changes.
import { hzToNote } from './src/note-hz.js';
import { clock, offFrom, semitonesAndTones } from './zone.js';

const known = (v) => v !== null && v !== undefined;

export function takeValues(s) {
  const target = s.targetNote || 'target';
  return [
    { key: 'pitch', label: 'Average pitch', value: s.meanHz ? `${hzToNote(s.meanHz)} · ${Math.round(s.meanHz)} Hz` : '—' },
    { key: 'spread', label: 'Pitch spread', value: known(s.semitoneSd) ? `${s.semitoneSd.toFixed(1)} semitones` : '—' },
    { key: 'range', label: 'Range (5–95%)', value: s.p5Hz && s.p95Hz ? `${hzToNote(s.p5Hz)} – ${hzToNote(s.p95Hz)}` : '—' },
    { key: 'speaking', label: 'Time speaking', value: `${clock(s.voicedMs ?? 0)} of ${clock(s.durationMs ?? 0)}` },
    { key: 'volume', label: 'Average volume', value: known(s.meanDb) ? `${Math.round(s.meanDb)} dB` : '—' },
    { key: 'loudest', label: 'Loudest', value: known(s.maxDb) ? `${Math.round(s.maxDb)} dB` : '—' },
    // Recorded with zoneNotes = [target], so inZoneShare is the share of
    // speaking time on the target note (within half a semitone).
    { key: 'onTarget', label: `Time on ${target}`, value: known(s.inZoneShare) ? `${Math.round(s.inZoneShare * 100)}% of speaking time` : '—' },
  ];
}

// The three values the After summary shows before "Show all 7 values".
export const SHORT_KEYS = ['onTarget', 'pitch', 'volume'];

export const takeOff = (s, targetNote = s.targetNote) => offFrom(s.meanHz, targetNote);

// "1 semitone (0.5 tones) closer to G2 than the Before session."
export function changeSentence(before, after) {
  const t = after.targetNote;
  const b = takeOff(before, t);
  const a = takeOff(after, t);
  if (b === null || a === null) return '';
  const diff = Math.abs(b) - Math.abs(a);
  if (diff === 0) return `Same distance to ${t} as the Before session.`;
  return `${semitonesAndTones(Math.abs(diff))} ${diff > 0 ? 'closer to' : 'further from'} ${t} than the Before session.`;
}

// "2 closer" / "1 further" / "same distance", in semitones.
export function closerWords(fromOff, toOff) {
  if (fromOff === null || toOff === null) return '—';
  const diff = Math.abs(fromOff) - Math.abs(toOff);
  if (diff === 0) return 'same distance';
  return `${Math.abs(diff)} ${diff > 0 ? 'closer' : 'further'}`;
}
