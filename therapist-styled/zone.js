// Colour and words for "how far is the voice from the target note".
// Distance is counted in semitones. The colour runs from green on the target
// to red at 10 semitones, and gets darker as it goes, so the distance still
// reads without colour vision.
import { noteToHz } from './src/note-hz.js';

export const SPAN = 10;
const STOPS = [
  [0, 150],
  [2, 95],
  [4, 52],
  [7, 30],
  [10, 6],
];

const capped = (d) => Math.min(Math.abs(d), SPAN);

export function hueFor(d) {
  const n = capped(d);
  for (let i = 0; i < STOPS.length - 1; i += 1) {
    const [d0, h0] = STOPS[i];
    const [d1, h1] = STOPS[i + 1];
    if (n <= d1) return h0 + ((h1 - h0) * (n - d0)) / (d1 - d0);
  }
  return STOPS[STOPS.length - 1][1];
}

export const shapeColour = (d) => `hsl(${Math.round(hueFor(d))} 45% ${(64 - 1.7 * capped(d)).toFixed(1)}%)`;
// Light enough for 4.5:1 on the dark background in every zone.
export const textColour = (d) => `hsl(${Math.round(hueFor(d))} 55% 76%)`;

// Whole semitones from the target; null without a pitch or a target.
export function offFrom(hz, targetNote) {
  if (!hz || !targetNote) return null;
  return Math.round(12 * Math.log2(hz / noteToHz(targetNote)));
}

export const tones = (n) => (n === 2 ? '1 tone' : `${n / 2} tones`);
export const semitonesAndTones = (n) => `${n} semitone${n === 1 ? '' : 's'} (${tones(n)})`;

// "3 semitones (1.5 tones) above G2"
export function distanceWords(off, target) {
  if (off === null) return 'No pitch heard';
  if (off === 0) return `On target ${target}`;
  const side = off > 0 ? 'above' : 'below';
  if (Math.abs(off) > SPAN) return `More than ${SPAN} semitones ${side} ${target}`;
  return `${semitonesAndTones(Math.abs(off))} ${side} ${target}`;
}

// "2 semitones (1 tone) above", for rows that already name the target.
export function shortWords(off) {
  if (off === null) return 'No pitch heard';
  if (off === 0) return 'On target';
  const side = off > 0 ? 'above' : 'below';
  if (Math.abs(off) > SPAN) return `More than ${SPAN} semitones ${side}`;
  return `${semitonesAndTones(Math.abs(off))} ${side}`;
}

// "2 above", for the compact progress lines.
export function sideWords(off) {
  if (off === null) return 'no pitch';
  if (off === 0) return 'on target';
  return `${Math.abs(off)} ${off > 0 ? 'above' : 'below'}`;
}

// The live reading inside the circle: the big line and the line under it.
export function liveWords(off, target) {
  if (off === 0) return { big: 'On target', sub: target };
  const n = Math.abs(off);
  const side = off > 0 ? 'above' : 'below';
  if (n > SPAN) return { big: `More than ${SPAN}`, sub: `semitones ${side} ${target}` };
  return { big: `${off > 0 ? '+' : '−'}${n} semitone${n === 1 ? '' : 's'}`, sub: `(${tones(n)}) ${side} ${target}` };
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
