import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toneGainFor,
  ASSUMED_TYPICAL_RMS,
  DEFAULT_TONE_GAIN,
  MIN_TONE_GAIN,
  MAX_TONE_GAIN,
} from '../src/tone-gain.js';

test('an uncalibrated tone plays at the default level', () => {
  assert.equal(toneGainFor(), DEFAULT_TONE_GAIN);
  assert.equal(toneGainFor({ typicalRms: null }), DEFAULT_TONE_GAIN);
});

test('a voice at the assumed level lands exactly on the default', () => {
  assert.ok(Math.abs(toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS }) - DEFAULT_TONE_GAIN) < 1e-9);
});

test('an insensitive microphone lowers the tone gently, not proportionally', () => {
  // The bug this exists to prevent: a quarter of the input level used to mean
  // a quarter of the output, which pinned the tone at the floor and made it
  // inaudible on a phone.
  const quarter = toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS / 4 });

  assert.ok(quarter > DEFAULT_TONE_GAIN / 4, 'not scaled straight down');
  assert.ok(Math.abs(quarter - DEFAULT_TONE_GAIN / 2) < 1e-9, 'square root of the ratio');
  assert.ok(quarter >= MIN_TONE_GAIN);
});

test('calibration alone can never take the tone below the floor or over the ceiling', () => {
  assert.equal(toneGainFor({ typicalRms: 0.00001 }), MIN_TONE_GAIN);
  assert.equal(toneGainFor({ typicalRms: 5 }), MAX_TONE_GAIN);
});

test('the volume control multiplies what calibration decided', () => {
  const base = toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS });
  assert.ok(Math.abs(toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS, toneVolume: 2 }) - base * 2) < 1e-9);
});

test('turning the volume right down goes below the calibration floor', () => {
  // The floor protects against a bad calibration, not against the user
  // deciding they want the tone barely there.
  const quiet = toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS, toneVolume: 0.2 });
  assert.ok(quiet < MIN_TONE_GAIN, `expected below ${MIN_TONE_GAIN}, got ${quiet}`);
  assert.ok(quiet > 0);
});

test('the volume control is bounded, and nonsense falls back to normal', () => {
  const loudest = toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS, toneVolume: 99 });
  assert.ok(loudest <= 1, 'never clips');

  const base = toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS });
  assert.equal(toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS, toneVolume: undefined }), base);
  assert.equal(toneGainFor({ typicalRms: ASSUMED_TYPICAL_RMS, toneVolume: 'loud' }), base);
});

test('the tone is louder than it used to be at every calibration', () => {
  // The old mapping: 0.2 * ratio, floored at 0.05.
  const oldGain = (rms) => Math.max(0.05, Math.min(0.6, 0.2 * (rms / ASSUMED_TYPICAL_RMS)));
  for (const rms of [0.002, 0.005, 0.01, 0.02, 0.04]) {
    assert.ok(
      toneGainFor({ typicalRms: rms }) > oldGain(rms),
      `at rms ${rms}: ${toneGainFor({ typicalRms: rms })} should beat ${oldGain(rms)}`
    );
  }
});
