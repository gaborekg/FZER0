import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toneGainFor,
  BASE_TONE_GAIN,
  MIN_TONE_VOLUME,
  MAX_TONE_VOLUME,
} from '../src/tone-gain.js';

test('the tone plays loud by default', () => {
  // It was quiet on a phone twice. The default has to be audible before any
  // adjustment, not after one.
  assert.equal(toneGainFor(), BASE_TONE_GAIN);
  assert.ok(BASE_TONE_GAIN >= 0.5, 'at least as loud as the level proven audible on device');
});

test('the microphone no longer has any say in it', () => {
  // The old mapping scaled gain off measured speaking level, which is a
  // different scale entirely and made the tone inaudible on quiet mics.
  assert.equal(toneGainFor({ typicalRms: 0.0001 }), BASE_TONE_GAIN);
  assert.equal(toneGainFor({ typicalRms: 5 }), BASE_TONE_GAIN);
});

test('the volume control scales the default', () => {
  assert.ok(Math.abs(toneGainFor({ toneVolume: 0.5 }) - BASE_TONE_GAIN * 0.5) < 1e-9);
  assert.ok(toneGainFor({ toneVolume: MAX_TONE_VOLUME }) > BASE_TONE_GAIN);
});

test('it never goes past full scale, where samples would clip', () => {
  assert.ok(toneGainFor({ toneVolume: 99 }) <= 1);
  assert.ok(toneGainFor({ toneVolume: MAX_TONE_VOLUME }) <= 1);
});

test('the quietest setting is quiet but not silent', () => {
  const quietest = toneGainFor({ toneVolume: MIN_TONE_VOLUME });
  assert.ok(quietest > 0);
  assert.ok(quietest < BASE_TONE_GAIN);
});

test('a nonsense volume falls back to normal rather than to silence', () => {
  assert.equal(toneGainFor({ toneVolume: undefined }), BASE_TONE_GAIN);
  assert.equal(toneGainFor({ toneVolume: null }), BASE_TONE_GAIN);
  assert.equal(toneGainFor({ toneVolume: 'loud' }), BASE_TONE_GAIN);
  assert.equal(toneGainFor({ toneVolume: 0 }), BASE_TONE_GAIN);
});

test('the default beats every level the old mapping could produce', () => {
  // That mapping topped out at 0.35 and fell to 0.15 on a quiet microphone,
  // which is how the tone ended up inaudible on a phone.
  const OLD_BEST = 0.35;
  assert.ok(toneGainFor() > OLD_BEST, `${toneGainFor()} should beat ${OLD_BEST}`);

  // Turning it down below that is fine — it is a choice, not a miscalculation.
  assert.ok(toneGainFor({ toneVolume: MIN_TONE_VOLUME }) < OLD_BEST);
});
