// tests/gate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFrame } from '../src/gate.js';

test('classifies as too-quiet when rms is below the floor', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.001 }, { floorRms: 0.01 });
  assert.equal(result.category, 'too-quiet');
  assert.equal(result.hz, null);
});

test('classifies as no-pitch when confidence is below the minimum', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.2, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'no-pitch');
  assert.equal(result.hz, null);
});

test('classifies as no-pitch when hz is null', () => {
  const result = classifyFrame({ hz: null, confidence: 0, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'no-pitch');
});

test('classifies as out-of-range when hz is above the 65-400 Hz detection band', () => {
  const result = classifyFrame({ hz: 500, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'out-of-range');
  assert.equal(result.hz, null);
});

test('classifies as out-of-range when hz is below the 65-400 Hz detection band', () => {
  const result = classifyFrame({ hz: 50, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'out-of-range');
  assert.equal(result.hz, null);
});

test('the detection band boundaries (65 Hz and 400 Hz) are themselves voiced, inclusive', () => {
  const low = classifyFrame({ hz: 65, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  const high = classifyFrame({ hz: 400, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(low.category, 'voiced');
  assert.equal(high.category, 'voiced');
});

test('rms exactly at the floor counts as loud enough (floor is inclusive)', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.01 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
});

test('classifies as voiced when loud enough, confident enough, and inside the detection band', () => {
  const result = classifyFrame({ hz: 110, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
  assert.equal(result.hz, 110);
});

test('classifies a reading above the F2-C3 ceiling but inside the detection band as voiced, not rejected', () => {
  // Regression test: this is the exact bug the design review caught — a
  // scream at 200 Hz must be measured and reported, not dropped.
  const result = classifyFrame({ hz: 200, confidence: 0.9, rms: 0.05 }, { floorRms: 0.01 });
  assert.equal(result.category, 'voiced');
  assert.equal(result.hz, 200);
});
