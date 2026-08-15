import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunningMean,
  createPitchAverage,
  createWindowedMean,
  createWindowedPitchAverage,
  createDecayingHistogram,
} from '../src/stats.js';

test('createRunningMean reports null before any sample', () => {
  assert.equal(createRunningMean().mean(), null);
});

test('createRunningMean averages the samples it was given', () => {
  const mean = createRunningMean();
  [10, 20, 60].forEach((value) => mean.add(value));
  assert.equal(mean.mean(), 30);
});

test('createPitchAverage reports null before any sample', () => {
  assert.equal(createPitchAverage().meanHz(), null);
});

test('createPitchAverage returns the geometric, not arithmetic, midpoint of an octave', () => {
  // The whole reason this module exists: the arithmetic mean of 100 and 200
  // is 150 Hz, which is a musical fifth above the low note. The true midpoint
  // between two notes an octave apart is 100 * sqrt(2) = 141.42 Hz.
  const average = createPitchAverage();
  average.add(100);
  average.add(200);
  assert.ok(Math.abs(average.meanHz() - 141.42) < 0.01);
});

test('createPitchAverage returns the sample itself for a single reading', () => {
  const average = createPitchAverage();
  average.add(110);
  assert.ok(Math.abs(average.meanHz() - 110) < 0.0001);
});

const WINDOW_MS = 60_000;

test('createWindowedMean reports null before any sample', () => {
  assert.equal(createWindowedMean(WINDOW_MS).mean(0), null);
});

test('createWindowedMean averages the samples inside the window', () => {
  const mean = createWindowedMean(WINDOW_MS);
  mean.add(10, 0);
  mean.add(20, 1_000);
  mean.add(60, 2_000);
  assert.equal(mean.mean(2_000), 30);
});

test('createWindowedMean drops samples once they age out of the window', () => {
  const mean = createWindowedMean(WINDOW_MS);
  mean.add(100, 0);
  mean.add(20, 55_000);
  // At 70s the first sample is 70s old — outside the minute — and the second
  // is 15s old, still inside.
  assert.equal(mean.mean(70_000), 20);
});

test('createWindowedMean empties once every sample has aged out', () => {
  // The window keeps sliding during silence, so "the last minute" of a voice
  // that stopped two minutes ago is genuinely nothing, not the last thing said.
  const mean = createWindowedMean(WINDOW_MS);
  mean.add(100, 0);
  assert.equal(mean.mean(120_000), null);
});

test('createWindowedMean survives compaction without drifting', () => {
  // Push well past the 1024-sample compaction threshold.
  const mean = createWindowedMean(1_000);
  for (let i = 0; i < 5_000; i++) mean.add(42, i * 10);
  assert.ok(Math.abs(mean.mean(50_000 - 10) - 42) < 1e-9);
});

test('createWindowedPitchAverage averages geometrically inside the window', () => {
  const average = createWindowedPitchAverage(WINDOW_MS);
  average.add(100, 0);
  average.add(200, 1_000);
  assert.ok(Math.abs(average.meanHz(1_000) - 141.42) < 0.01);
});

const HALF_LIFE_MS = 10_000;

function observeMany(histogram, note, { count, fromMs = 0, stepMs = 50 }) {
  for (let i = 0; i < count; i++) {
    histogram.observe(note, fromMs + i * stepMs);
  }
  return fromMs + count * stepMs;
}

test('createDecayingHistogram starts every bar at zero', () => {
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  const heights = histogram.heights();
  assert.equal(heights.get('F2'), 0);
  assert.equal(heights.get('G2'), 0);
});

test('createDecayingHistogram fills the busiest note and scales the others to it', () => {
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  // Interleaved so both notes decay by the same amount — only their counts
  // differ: two F2 for every one G2.
  for (let i = 0; i < 30; i++) {
    histogram.observe(i % 3 === 2 ? 'G2' : 'F2', i * 10);
  }
  const heights = histogram.heights();
  assert.equal(heights.get('F2'), 1);
  assert.ok(Math.abs(heights.get('G2') - 0.5) < 0.02);
});

test('createDecayingHistogram sinks the whole chart once the voice stops', () => {
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  const afterSpeech = observeMany(histogram, 'F2', { count: 200 });
  const whileTalking = histogram.heights().get('F2');

  // Silence: frames keep arriving, they just carry no pitch.
  observeMany(histogram, null, { count: 800, fromMs: afterSpeech });
  const afterSilence = histogram.heights().get('F2');

  assert.ok(whileTalking > 0.9, `expected a full bar while talking, got ${whileTalking}`);
  assert.ok(afterSilence < 0.2, `expected the bar to sink in silence, got ${afterSilence}`);
});

test('createDecayingHistogram keeps the shape readable, so the tallest bar stays full', () => {
  // The bars must not all collapse to nothing the instant one pause happens —
  // the tallest is still the tallest, it is the whole chart that fades.
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  for (let i = 0; i < 60; i++) {
    histogram.observe(i % 3 === 2 ? null : 'F2', i * 50);
  }
  assert.equal(histogram.heights().get('F2'), 1);
});

test('shareOf is null until something voiced has been heard', () => {
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  assert.equal(histogram.shareOf(['F2']), null);
  observeMany(histogram, null, { count: 20 });
  assert.equal(histogram.shareOf(['F2']), null);
});

test('shareOf reports the fraction of voiced time spent inside the zone', () => {
  const histogram = createDecayingHistogram(['F2', 'G2', 'A2'], HALF_LIFE_MS);
  // Three notes in rotation, two of them inside the zone.
  const cycle = ['F2', 'G2', 'A2'];
  for (let i = 0; i < 30; i++) {
    histogram.observe(cycle[i % 3], i * 10);
  }
  assert.ok(Math.abs(histogram.shareOf(['F2', 'G2']) - 2 / 3) < 0.02);
});

test('shareOf ignores silence but counts pitches that fall off the chart', () => {
  const histogram = createDecayingHistogram(['F2'], HALF_LIFE_MS);
  // Half the voiced frames land above the chart; silence should not dilute
  // the figure, but those off-chart frames must.
  const cycle = ['F2', 'C5', null, null];
  for (let i = 0; i < 40; i++) {
    histogram.observe(cycle[i % 4], i * 10);
  }
  assert.ok(Math.abs(histogram.shareOf(['F2']) - 0.5) < 0.02);
});

test('createDecayingHistogram ignores a note that has no bar instead of throwing', () => {
  const histogram = createDecayingHistogram(['F2', 'G2'], HALF_LIFE_MS);
  assert.doesNotThrow(() => histogram.observe('C5', 0));
  assert.equal(histogram.heights().get('F2'), 0);
});
