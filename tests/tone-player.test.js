import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTonePlayer } from '../src/tone-player.js';

function fakeAudio() {
  const elements = [];
  const factory = (src) => {
    const listeners = {};
    const element = {
      src,
      paused: true,
      played: 0,
      attributes: {},
      setAttribute: (name, value) => {
        element.attributes[name] = value;
      },
      addEventListener: (name, handler) => {
        listeners[name] = handler;
      },
      play: () => {
        element.paused = false;
        element.played += 1;
        return Promise.resolve();
      },
      pause: () => {
        element.paused = true;
      },
      end: () => listeners.ended?.(),
    };
    elements.push(element);
    return element;
  };
  return { factory, elements };
}

test('playing a note starts a WAV of that note, as a data URL', async () => {
  // A blob: URL is what WKWebView refuses, so the source has to be a data URL.
  const { factory, elements } = fakeAudio();

  await createTonePlayer(factory).play('A2');

  assert.equal(elements.length, 1);
  assert.equal(elements[0].played, 1);
  assert.match(elements[0].src, /^data:audio\/wav;base64,/);
});

test('it plays inline, so iOS does not take over the screen', async () => {
  const { factory, elements } = fakeAudio();
  await createTonePlayer(factory).play('A2');
  assert.equal(elements[0].attributes.playsinline, '');
});

test('the same note at the same volume reuses the same encoded audio', async () => {
  const { factory, elements } = fakeAudio();
  const player = createTonePlayer(factory);

  await player.play('A2');
  await player.play('A2');
  assert.equal(elements[1].src, elements[0].src, 'reused');

  await player.play('A2', { gain: 0.9 });
  assert.notEqual(elements[2].src, elements[0].src, 'a different volume is a different file');

  await player.play('C3');
  assert.notEqual(elements[3].src, elements[0].src, 'and so is a different note');
});

test('a second tone replaces the first rather than layering over it', async () => {
  const { factory, elements } = fakeAudio();
  const player = createTonePlayer(factory);

  await player.play('A2');
  await player.play('C3');

  assert.equal(elements[0].paused, true, 'the first was stopped');
  assert.equal(elements[1].paused, false);
});

test('onEnd runs when the tone finishes', async () => {
  const { factory, elements } = fakeAudio();
  let ended = 0;
  await createTonePlayer(factory).play('A2', { durationMs: 50, onEnd: () => { ended += 1; } });

  elements[0].end();
  assert.equal(ended, 1);
});

test('onEnd still runs when the browser refuses to play', async () => {
  // The failure this guards: callers pause their analysis on onStart, so a
  // tone that never reports ending leaves the app measuring nothing.
  const { factory, elements } = fakeAudio();
  elements.length = 0;
  let ended = 0;

  await createTonePlayer((src) => {
    const element = factory(src);
    element.play = () => Promise.reject(new Error('NotAllowedError'));
    return element;
  }).play('A2', { durationMs: 20, onEnd: () => { ended += 1; } });

  assert.equal(ended, 0, 'not immediately');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(ended, 1);
});

test('onEnd never runs twice', async () => {
  const { factory, elements } = fakeAudio();
  let ended = 0;
  await createTonePlayer(factory).play('A2', { durationMs: 20, onEnd: () => { ended += 1; } });

  elements[0].end();
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(ended, 1);
});

test('a rejected play does not throw into the caller', async () => {
  const { factory } = fakeAudio();
  const player = createTonePlayer((src) => {
    const element = factory(src);
    element.play = () => Promise.reject(new Error('NotAllowedError'));
    return element;
  });
  await assert.doesNotReject(() => player.play('A2'));
});

test('state reports what the last attempt managed', async () => {
  const { factory, elements } = fakeAudio();
  const player = createTonePlayer(factory);

  assert.equal(player.state(), 'new');
  await player.play('A2');
  assert.equal(player.state(), 'running');

  elements[0].error = { code: 4 };
  assert.equal(player.state(), 'error');
});
