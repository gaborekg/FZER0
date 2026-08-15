import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoiseFloor } from '../src/noise-floor.js';

test('getFloor returns minRms when no samples have been added', () => {
  const floor = createNoiseFloor({ minRms: 0.001, maxRms: 0.05 });
  assert.equal(floor.getFloor(), 0.001);
});

test('getFloor rises above the raw noise level once quiet-room samples accumulate', () => {
  const floor = createNoiseFloor({ minRms: 0.0005, maxRms: 0.05, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.01, i * 100);
  }
  const result = floor.getFloor();
  assert.ok(result > 0.01, `expected floor above 0.01, got ${result}`);
});

test('getFloor is bounded by maxRms even with very loud samples', () => {
  const floor = createNoiseFloor({ minRms: 0.0005, maxRms: 0.02, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.5, i * 100);
  }
  assert.equal(floor.getFloor(), 0.02);
});

test('addSample drops samples older than the rolling window', () => {
  const floor = createNoiseFloor({ windowSeconds: 1, minRms: 0.0005, maxRms: 0.05, marginDb: 9 });
  for (let i = 0; i < 50; i++) {
    floor.addSample(0.02, i * 10);
  }
  floor.addSample(0.001, 3000); // 3s later; window is 1s, so only this sample survives
  const result = floor.getFloor();
  assert.ok(result < 0.005, `expected floor to reflect only the recent quiet sample, got ${result}`);
});

test('getFloor tracks the 10th percentile, not the minimum — a single silent frame must not drag it down', () => {
  // If getFloor used Math.min instead of a true percentile, this test
  // would fail: the one 0.0001 sample would pull the floor far below the
  // room's actual typical quiet level (0.01), making the gate treat one
  // silent frame as if it defined the ambient noise floor.
  const floor = createNoiseFloor({ minRms: 0.00001, maxRms: 0.05, marginDb: 9 });
  floor.addSample(0.0001, 0); // one atypically silent frame
  for (let i = 1; i < 90; i++) {
    floor.addSample(0.01, i * 100); // the room's typical quiet level
  }
  for (let i = 90; i < 100; i++) {
    floor.addSample(0.5, i * 100); // loud outliers, ~10% of samples
  }
  const result = floor.getFloor();
  assert.ok(result > 0.005, `expected floor near the typical 0.01 level, not near the single silent sample, got ${result}`);
  assert.ok(result < 0.05, `expected floor unaffected by the loud outliers, got ${result}`);
});
