import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch } from '../src/f0-core.js';
import { generateSineWave, generateSilence } from './helpers/sine-wave.js';

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 2048;

test('detects a 110 Hz sine wave within 1% accuracy', () => {
  const frame = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(result.hz !== null);
  assert.ok(Math.abs(result.hz - 110) / 110 < 0.01, `got ${result.hz} Hz`);
});

test('detects a 200 Hz sine wave — above the range ceiling, inside the detection band', () => {
  const frame = generateSineWave(200, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(Math.abs(result.hz - 200) / 200 < 0.01, `got ${result.hz} Hz`);
});

test('reports high confidence for a clean sine wave', () => {
  const frame = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(result.confidence > 0.9, `expected high confidence, got ${result.confidence}`);
});

test('confidence is high at both ends of the detection band, not just in the middle', () => {
  const lowResult = detectPitch(generateSineWave(65, SAMPLE_RATE, FRAME_SIZE), SAMPLE_RATE);
  const highResult = detectPitch(generateSineWave(400, SAMPLE_RATE, FRAME_SIZE), SAMPLE_RATE);
  assert.ok(lowResult.confidence > 0.9, `expected high confidence at 65 Hz, got ${lowResult.confidence}`);
  assert.ok(highResult.confidence > 0.9, `expected high confidence at 400 Hz, got ${highResult.confidence}`);
});

test('reports hz null and rms 0 for silence', () => {
  const frame = generateSilence(FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.rms, 0);
  assert.equal(result.hz, null);
});

test('reports rms proportional to amplitude', () => {
  const quiet = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE, 0.1);
  const loud = generateSineWave(110, SAMPLE_RATE, FRAME_SIZE, 0.5);
  const quietResult = detectPitch(quiet, SAMPLE_RATE);
  const loudResult = detectPitch(loud, SAMPLE_RATE);
  assert.ok(loudResult.rms > quietResult.rms);
});

test('a harmonic-rich signal still detects the fundamental, not an overtone', () => {
  const numSamples = FRAME_SIZE;
  const frame = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    frame[i] =
      0.5 * Math.sin(2 * Math.PI * 100 * t) +
      0.25 * Math.sin(2 * Math.PI * 200 * t) +
      0.125 * Math.sin(2 * Math.PI * 300 * t);
  }
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.ok(Math.abs(result.hz - 100) / 100 < 0.03, `got ${result.hz} Hz`);
});

// Regression tests for a real bug caught in whole-branch review: input with
// no genuine periodicity was reported as a confident, high-hz "voiced"
// reading, because the old search picked whatever lag scored highest across
// its range with no check that it was an actual peak rather than the edge
// of the search window non-periodic signals pin against.

test('reports no pitch for a constant DC offset (no periodicity at all)', () => {
  const frame = new Float32Array(FRAME_SIZE).fill(0.02);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for slow sub-audible drift (8 Hz)', () => {
  const frame = generateSineWave(8, SAMPLE_RATE, FRAME_SIZE);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for a decaying transient thump (40 Hz, damped)', () => {
  const frame = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    const t = i / SAMPLE_RATE;
    frame[i] = 0.3 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 40 * t);
  }
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch, got ${result.hz} Hz`);
});

test('reports no pitch for low-frequency rumble (30-50 Hz) below the search range', () => {
  for (const hz of [30, 40, 50]) {
    const frame = generateSineWave(hz, SAMPLE_RATE, FRAME_SIZE);
    const result = detectPitch(frame, SAMPLE_RATE);
    assert.equal(result.hz, null, `expected no pitch for ${hz} Hz rumble, got ${result.hz}`);
  }
});

test('classifies a genuine 399 Hz tone consistently at both 44.1kHz and 48kHz', () => {
  for (const sampleRate of [44100, 48000]) {
    const frame = generateSineWave(399, sampleRate, FRAME_SIZE);
    const result = detectPitch(frame, sampleRate);
    assert.ok(result.hz !== null, `expected a pitch at ${sampleRate}Hz, got null`);
    assert.ok(Math.abs(result.hz - 399) / 399 < 0.01, `got ${result.hz} Hz at ${sampleRate}Hz sample rate`);
  }
});

test('returns no pitch for an undersized frame instead of a truncated-search guess', () => {
  // A 128-sample frame (one AudioWorklet quantum) cannot reliably resolve
  // a 110 Hz tone — MIN_FRAME_LENGTH_MULTIPLIER guards this explicitly
  // rather than silently narrowing the search and misreporting.
  const frame = generateSineWave(110, SAMPLE_RATE, 128);
  const result = detectPitch(frame, SAMPLE_RATE);
  assert.equal(result.hz, null, `expected no pitch from an undersized frame, got ${result.hz} Hz`);
});
