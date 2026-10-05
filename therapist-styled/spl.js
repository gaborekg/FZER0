// Real decibels. The browser gives the signal's loudness relative to the
// microphone's own maximum (dBFS). Turning that into dB like a sound meter
// shows needs one number per microphone: how sensitive it is. The browser
// doesn't know it, so the therapist matches each microphone once against
// their own dB meter. The matches belong to the device, not to a patient.
const KEY = 'fzer0s.micMatch';
const LAST_KEY = 'fzer0s.micLast';
// Used until a microphone is matched: a typical device, often 5–10 dB off.
export const DEFAULT_OFFSET = 100;
// How a sound meter's "Fast" setting smooths the level: 125 ms.
const FAST_MS = 125;
const QUIETEST = 1e-10;

export const dbfs = (meanSquare) => 10 * Math.log10(Math.max(QUIETEST, meanSquare));

function read(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the match lasts for this page only.
  }
}

// The microphone in use, by its name ("iPad Microphone", "Headset
// Microphone"). The name only appears once the microphone is allowed.
export function micOf(stream) {
  const track = stream?.getAudioTracks?.()[0];
  const label = track?.label?.trim();
  if (label) return label;
  return track?.getSettings?.().deviceId || 'default';
}

export const matchFor = (mic) => read(KEY, {})[mic] ?? null;
export const lastMic = () => read(LAST_KEY, null);
export const rememberMic = (mic) => write(LAST_KEY, mic);

export function saveMatch(mic, offset) {
  const all = read(KEY, {});
  all[mic] = { offset, matchedAtMs: Date.now() };
  write(KEY, all);
  rememberMic(mic);
}

// One take's volume: the average while the patient speaks (an energy
// average, like a sound meter's), and the loudest moment at "Fast".
export function createSplMeter() {
  let sum = 0;
  let count = 0;
  let fast = null;
  let fastAtMs = null;
  let maxFast = null;
  return {
    add(rms, voiced, nowMs) {
      const square = rms * rms;
      if (voiced) {
        sum += square;
        count += 1;
      }
      if (fast === null) fast = square;
      else {
        const dt = Math.max(0, nowMs - fastAtMs);
        fast += (square - fast) * (1 - Math.exp(-dt / FAST_MS));
      }
      fastAtMs = nowMs;
      if (maxFast === null || fast > maxFast) maxFast = fast;
    },
    // In dBFS; add the microphone's offset for dB.
    result() {
      return {
        meanDbfs: count > 0 ? dbfs(sum / count) : null,
        maxDbfs: maxFast === null ? null : dbfs(maxFast),
      };
    },
  };
}

// The volume fields a take saves. Older takes, from before real dB, have
// no dbScale and their volume is not shown.
export function volumeFields({ meanDbfs, maxDbfs }, mic) {
  const match = matchFor(mic);
  const offset = match ? match.offset : DEFAULT_OFFSET;
  const add = (v) => (v === null ? null : v + offset);
  return { meanDb: add(meanDbfs), maxDb: add(maxDbfs), meanDbfs, maxDbfs, mic, dbOffset: offset, dbMatched: Boolean(match), dbScale: 'spl' };
}
