// A pure sine tone, encoded as a WAV file.
//
// Why a file rather than an oscillator: on iOS every browser is WKWebView, and
// Web Audio there is the fragile path. A context arrives suspended, needs
// unlocking inside a gesture, gets suspended again on every backgrounding, and
// once a getUserMedia stream is open the audio session is in record mode and
// playback can be routed away or silenced. An <audio> element playing a real
// file sidesteps all of that.
//
// The amplitude is baked into the samples on purpose. iOS ignores the `volume`
// property on media elements — output level is the hardware's business — so
// the only place loudness can be applied is here.

const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const MAX_AMPLITUDE = 32767;

// Ramps, so the tone does not click on at full amplitude and off again.
const ATTACK_SECONDS = 0.015;
const RELEASE_SECONDS = 0.06;

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

// Linear fade in and out, flat in between.
function envelopeAt(second, durationSeconds) {
  if (second < ATTACK_SECONDS) return second / ATTACK_SECONDS;
  const fromEnd = durationSeconds - second;
  if (fromEnd < RELEASE_SECONDS) return Math.max(0, fromEnd / RELEASE_SECONDS);
  return 1;
}

export function buildToneWav({ hz, durationMs = 1200, amplitude = 0.35, sampleRate = 44100 }) {
  if (!(hz > 0)) throw new Error('A tone needs a positive frequency');

  const durationSeconds = durationMs / 1000;
  const frames = Math.max(1, Math.round(sampleRate * durationSeconds));
  const dataBytes = frames * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const level = Math.max(0, Math.min(1, amplitude));
  for (let frame = 0; frame < frames; frame++) {
    const second = frame / sampleRate;
    const sample =
      Math.sin(2 * Math.PI * hz * second) * envelopeAt(second, durationSeconds) * level;
    view.setInt16(44 + frame * 2, Math.round(sample * MAX_AMPLITUDE), true);
  }

  return new Uint8Array(buffer);
}
