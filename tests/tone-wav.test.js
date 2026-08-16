import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildToneWav, toneWavDataUri } from '../src/tone-wav.js';

const SAMPLE_RATE = 8000;

function parse(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, length) =>
    String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(at + i)));
  const frames = view.getUint32(40, true) / 2;
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    data: ascii(36, 4),
    declaredSize: view.getUint32(4, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bits: view.getUint16(34, true),
    frames,
    sample: (i) => view.getInt16(44 + i * 2, true) / 32767,
  };
}

test('it is a real WAV file, not just bytes', () => {
  const wav = parse(buildToneWav({ hz: 110, durationMs: 100, sampleRate: SAMPLE_RATE }));

  assert.equal(wav.riff, 'RIFF');
  assert.equal(wav.wave, 'WAVE');
  assert.equal(wav.fmt, 'fmt ');
  assert.equal(wav.data, 'data');
  assert.equal(wav.format, 1, 'uncompressed PCM');
  assert.equal(wav.channels, 1);
  assert.equal(wav.bits, 16);
  assert.equal(wav.sampleRate, SAMPLE_RATE);
});

test('the declared size matches the bytes actually present', () => {
  // A wrong RIFF size is the classic way to produce a file that some players
  // accept and others refuse.
  const bytes = buildToneWav({ hz: 110, durationMs: 250, sampleRate: SAMPLE_RATE });
  assert.equal(parse(bytes).declaredSize, bytes.length - 8);
});

test('the file lasts as long as it was asked to', () => {
  const wav = parse(buildToneWav({ hz: 110, durationMs: 500, sampleRate: SAMPLE_RATE }));
  assert.equal(wav.frames, SAMPLE_RATE / 2);
});

test('the tone is at the frequency requested', () => {
  // Count zero crossings over a whole number of cycles: 110 Hz for one second
  // crosses zero 220 times.
  const wav = parse(buildToneWav({ hz: 110, durationMs: 1000, sampleRate: 44100 }));
  let crossings = 0;
  for (let i = 1; i < wav.frames; i++) {
    if (Math.sign(wav.sample(i)) !== Math.sign(wav.sample(i - 1)) && wav.sample(i) !== 0) {
      crossings += 1;
    }
  }
  assert.ok(Math.abs(crossings - 220) <= 2, `expected ~220 zero crossings, got ${crossings}`);
});

test('amplitude is baked into the samples, because iOS ignores volume', () => {
  const loud = parse(buildToneWav({ hz: 110, durationMs: 300, amplitude: 0.8, sampleRate: 44100 }));
  const quiet = parse(buildToneWav({ hz: 110, durationMs: 300, amplitude: 0.2, sampleRate: 44100 }));

  const peak = (wav) => {
    let highest = 0;
    for (let i = 0; i < wav.frames; i++) highest = Math.max(highest, Math.abs(wav.sample(i)));
    return highest;
  };

  assert.ok(Math.abs(peak(loud) - 0.8) < 0.01);
  assert.ok(Math.abs(peak(quiet) - 0.2) < 0.01);
});

test('it fades in and out rather than clicking', () => {
  const wav = parse(buildToneWav({ hz: 110, durationMs: 500, amplitude: 1, sampleRate: 44100 }));
  assert.equal(wav.sample(0), 0, 'starts from silence');
  assert.ok(Math.abs(wav.sample(wav.frames - 1)) < 0.05, 'and ends there');
});

test('amplitude is clamped rather than allowed to wrap round', () => {
  const wav = parse(buildToneWav({ hz: 110, durationMs: 200, amplitude: 5, sampleRate: 44100 }));
  for (let i = 0; i < wav.frames; i++) assert.ok(Math.abs(wav.sample(i)) <= 1.0001);
});

test('a frequency of zero is refused rather than producing silence', () => {
  assert.throws(() => buildToneWav({ hz: 0 }), /positive frequency/);
});

test('the data URL carries the same bytes the encoder produced', () => {
  // The blob: URL it replaced is the thing WKWebView refuses to play, so this
  // path has to be exactly as correct as the raw encoder.
  const options = { hz: 110, durationMs: 120, amplitude: 0.5, sampleRate: 8000 };
  const uri = toneWavDataUri(options);

  assert.match(uri, /^data:audio\/wav;base64,/);

  const decoded = Buffer.from(uri.split(',')[1], 'base64');
  assert.deepEqual(new Uint8Array(decoded), buildToneWav(options));
});

test('a tone long enough to blow the argument limit still encodes', () => {
  // String.fromCharCode(...bytes) throws somewhere above 100k arguments, which
  // a second of audio comfortably exceeds.
  const uri = toneWavDataUri({ hz: 110, durationMs: 3000, sampleRate: 44100 });
  const decoded = Buffer.from(uri.split(',')[1], 'base64');
  assert.equal(decoded.length, 44 + 44100 * 3 * 2);
});
