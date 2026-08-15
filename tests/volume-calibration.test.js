import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCeilingFromSamples, computeTypicalFromSamples } from '../src/volume-calibration.js';

test('computes a ceiling above the 90th percentile of normal talking volume', () => {
  const samples = Array.from({ length: 100 }, (_, i) => 0.01 + i * 0.0002); // 0.01 to ~0.03
  const ceiling = computeCeilingFromSamples(samples);
  const p90 = samples[Math.floor(0.9 * (samples.length - 1))];
  assert.ok(ceiling > p90, `expected ceiling above p90 (${p90}), got ${ceiling}`);
});

test('throws on an empty sample list', () => {
  assert.throws(() => computeCeilingFromSamples([]));
});

test('computeTypicalFromSamples returns the median for an odd-length list', () => {
  assert.equal(computeTypicalFromSamples([0.01, 0.03, 0.02]), 0.02);
});

test('computeTypicalFromSamples averages the two middle values for an even-length list', () => {
  assert.equal(computeTypicalFromSamples([0.01, 0.02, 0.03, 0.04]), 0.025);
});

test('computeTypicalFromSamples throws on an empty sample list', () => {
  assert.throws(() => computeTypicalFromSamples([]));
});
