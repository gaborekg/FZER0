// The 7 values every take shows, and the words comparing two takes. Each take
// is read against the target it was recorded with, so it stays true after the
// target changes.
import { hzToNote } from './src/note-hz.js';
import { clock, offFrom, semitonesAndTones } from './zone.js';
import { t, num } from './i18n.js';

const known = (v) => v !== null && v !== undefined;

export function takeValues(s) {
  const target = s.targetNote || t('v.target');
  const share = known(s.inZoneShare) ? Math.round(s.inZoneShare * 100) : null;
  return [
    { key: 'pitch', label: t('v.pitch'), value: s.meanHz ? `${hzToNote(s.meanHz)} · ${Math.round(s.meanHz)} Hz` : '—' },
    { key: 'spread', label: t('v.spread'), value: known(s.semitoneSd) ? t('v.spreadValue', { x: num(s.semitoneSd.toFixed(1)) }) : '—' },
    { key: 'range', label: t('v.range'), value: s.p5Hz && s.p95Hz ? `${hzToNote(s.p5Hz)} – ${hzToNote(s.p95Hz)}` : '—' },
    { key: 'speaking', label: t('v.speaking'), value: t('v.of', { a: clock(s.voicedMs ?? 0), b: clock(s.durationMs ?? 0) }) },
    { key: 'volume', label: t('v.volume'), value: known(s.meanDb) ? `${Math.round(s.meanDb)} dB` : '—' },
    { key: 'loudest', label: t('v.loudest'), value: known(s.maxDb) ? `${Math.round(s.maxDb)} dB` : '—' },
    // Recorded with zoneNotes = [target], so inZoneShare is the share of
    // speaking time on the target note (within half a semitone).
    {
      key: 'onTarget',
      label: t('v.onTarget', { t: target }),
      value: share === null ? '—' : t('v.onTargetValue', { p: share }),
      short: share === null ? '—' : t('v.onTargetShort', { p: share }),
    },
  ];
}

// The three values the After summary shows before "Show all 7 values".
export const SHORT_KEYS = ['onTarget', 'pitch', 'volume'];

export const takeOff = (s, targetNote = s.targetNote) => offFrom(s.meanHz, targetNote);

// "1 semitone (0.5 tones) closer to G2 than the Before session."
export function changeSentence(before, after) {
  const target = after.targetNote;
  const b = takeOff(before, target);
  const a = takeOff(after, target);
  if (b === null || a === null) return '';
  const diff = Math.abs(b) - Math.abs(a);
  if (diff === 0) return t('change.same', { t: target });
  return t(diff > 0 ? 'change.closer' : 'change.further', { d: semitonesAndTones(Math.abs(diff)), t: target });
}

// "2 closer" / "1 further" / "same distance", in semitones.
export function closerWords(fromOff, toOff) {
  if (fromOff === null || toOff === null) return '—';
  const diff = Math.abs(fromOff) - Math.abs(toOff);
  if (diff === 0) return t('cmp.same');
  return t(diff > 0 ? 'cmp.closer' : 'cmp.further', { d: Math.abs(diff) });
}

// "1 semitone (0.5 tones) closer" / "2 semitones (1 tone) further" / "same distance".
export function closerPhrase(fromOff, toOff) {
  if (fromOff === null || toOff === null) return '';
  const diff = Math.abs(fromOff) - Math.abs(toOff);
  if (diff === 0) return t('cmp.same');
  return t(diff > 0 ? 'cmp.closer' : 'cmp.further', { d: semitonesAndTones(Math.abs(diff)) });
}

// "Since first day: 3 semitones (1.5 tones) closer to G2"
export function sinceFirstDay(fromOff, toOff, target) {
  if (fromOff === null || toOff === null) return '';
  const diff = Math.abs(fromOff) - Math.abs(toOff);
  if (diff === 0) return t('since.same', { t: target });
  return t(diff > 0 ? 'since.closer' : 'since.further', { d: semitonesAndTones(Math.abs(diff)), t: target });
}

// "3 dB louder" / "2 dB quieter" / "same volume".
export function louderPhrase(db) {
  if (db === null || db === undefined) return '';
  const n = Math.round(db);
  if (n === 0) return t('vol.same');
  return t(n > 0 ? 'vol.louder' : 'vol.quieter', { n: Math.abs(n) });
}
