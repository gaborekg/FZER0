import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTonePlayer } from '../src/tone-player.js';

function createFakeAudioContext() {
  const calls = { oscillators: [], gains: [] };
  const fakeContext = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const oscillator = {
        connect() {},
        start() {
          oscillator.started = true;
        },
        stop(when) {
          oscillator.stoppedAt = when;
        },
        frequency: { value: null },
      };
      calls.oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      const gainNode = {
        connect() {},
        gain: { value: 1 },
      };
      calls.gains.push(gainNode);
      return gainNode;
    },
  };
  return { fakeContext, calls };
}

test("play sets the oscillator frequency to the note's Hz value", () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  player.play('A2');
  assert.ok(Math.abs(calls.oscillators[0].frequency.value - 110) < 0.5);
});

test('play calls onStart before starting the oscillator', () => {
  const { fakeContext } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  let startedCalled = false;
  player.play('A2', { onStart: () => { startedCalled = true; } });
  assert.equal(startedCalled, true);
});

test('play calls onEnd when the oscillator fires onended', () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  let endedCalled = false;
  player.play('A2', { onEnd: () => { endedCalled = true; } });
  calls.oscillators[0].onended();
  assert.equal(endedCalled, true);
});

test('play defaults the gain to a moderate level when none is given', () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  player.play('A2');
  assert.ok(calls.gains[0].gain.value > 0 && calls.gains[0].gain.value <= 1);
});

test('play uses the provided gain', () => {
  const { fakeContext, calls } = createFakeAudioContext();
  const player = createTonePlayer(() => fakeContext);
  player.play('A2', { gain: 0.35 });
  assert.equal(calls.gains[0].gain.value, 0.35);
});

test('reuses the same AudioContext across multiple play calls', () => {
  let factoryCalls = 0;
  const { fakeContext } = createFakeAudioContext();
  const player = createTonePlayer(() => {
    factoryCalls += 1;
    return fakeContext;
  });
  player.play('A2');
  player.play('C3');
  assert.equal(factoryCalls, 1);
});
