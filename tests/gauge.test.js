import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gaugePosition, gaugeVerdict, volumeLevel, volumeVerdict } from '../src/gauge.js';

const RANGE = { rangeLowHz: 100, rangeHighHz: 150 };

test('gaugePosition maps the low end of the range to 0', () => {
  assert.equal(gaugePosition(100, RANGE), 0);
});

test('gaugePosition maps the ceiling to 1', () => {
  assert.equal(gaugePosition(150, RANGE), 1);
});

test('gaugePosition maps a reading above the ceiling to a value above 1', () => {
  const position = gaugePosition(200, RANGE);
  assert.ok(position > 1, `expected > 1, got ${position}`);
});

test('gaugePosition returns null when there is no reading', () => {
  assert.equal(gaugePosition(null, RANGE), null);
});

test('gaugeVerdict is Good at or below the ceiling', () => {
  assert.equal(gaugeVerdict(0.5), 'Good');
  assert.equal(gaugeVerdict(1), 'Good');
});

test('gaugeVerdict is Too high above the ceiling', () => {
  assert.equal(gaugeVerdict(1.01), 'Too high');
});

test('gaugeVerdict is null when there is no reading', () => {
  assert.equal(gaugeVerdict(null), null);
});

test('volumeLevel clamps to 0 and 1', () => {
  assert.equal(volumeLevel(0, { floorRms: 0.01, ceilingRms: 0.05 }), 0);
  assert.equal(volumeLevel(1, { floorRms: 0.01, ceilingRms: 0.05 }), 1);
});

test('volumeVerdict is Too loud above the ceiling, Good at or below it', () => {
  assert.equal(volumeVerdict(0.06, 0.05), 'Too loud');
  assert.equal(volumeVerdict(0.04, 0.05), 'Good');
});
