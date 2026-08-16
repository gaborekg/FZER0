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

test('a suspended context is resumed before the tone starts', () => {
  // Safari hands back suspended contexts; start() on one is silent.
  const { fakeContext } = createFakeAudioContext();
  fakeContext.state = 'suspended';
  let resumed = false;
  fakeContext.resume = () => {
    resumed = true;
  };

  createTonePlayer(() => fakeContext).play('A2');
  assert.equal(resumed, true);
});

test('onEnd still runs when the oscillator never reports ending', async () => {
  // The failure this guards: a silent tone leaves analysis paused forever.
  const { fakeContext, calls } = createFakeAudioContext();
  let ended = 0;
  createTonePlayer(() => fakeContext).play('A2', { durationMs: 10, onEnd: () => { ended += 1; } });

  assert.equal(ended, 0, 'not before the tone would have finished');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(ended, 1);

  // And the real callback must not double up with the fallback.
  calls.oscillators[0].onended?.();
  assert.equal(ended, 1);
});

test('onEnd runs exactly once when the oscillator does report ending', async () => {
  const { fakeContext, calls } = createFakeAudioContext();
  let ended = 0;
  createTonePlayer(() => fakeContext).play('A2', { durationMs: 10, onEnd: () => { ended += 1; } });

  calls.oscillators[0].onended();
  assert.equal(ended, 1);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(ended, 1, 'the fallback did not fire a second time');
});

test('the tone fades in and out instead of switching on at full amplitude', () => {
  // A sine started and stopped abruptly clicks at both ends, which on a phone
  // speaker is most of what you hear.
  const { fakeContext, calls } = createFakeAudioContext();
  const ramps = [];
  const holds = [];
  fakeContext.createGain = () => {
    const gainNode = {
      connect() {},
      gain: {
        value: 1,
        setValueAtTime: (value, at) => holds.push([value, at]),
        linearRampToValueAtTime: (value, at) => ramps.push([value, at]),
      },
    };
    calls.gains.push(gainNode);
    return gainNode;
  };

  createTonePlayer(() => fakeContext).play('A2', { durationMs: 1000, gain: 0.4 });

  assert.equal(holds[0][0], 0, 'starts from silence');
  assert.equal(ramps[0][0], 0.4, 'rises to the requested gain');
  assert.equal(ramps.at(-1)[0], 0, 'and returns to silence');
  assert.ok(ramps.at(-1)[1] > ramps[0][1], 'the release comes after the attack');
});

test('a gain node without ramp support still plays, just without the fades', () => {
  // The extension and the tests both hand in plainer objects than a real
  // AudioContext; losing the envelope must not mean losing the tone.
  const { fakeContext, calls } = createFakeAudioContext();
  assert.doesNotThrow(() => createTonePlayer(() => fakeContext).play('A2'));
  assert.equal(calls.oscillators[0].started, true);
});
