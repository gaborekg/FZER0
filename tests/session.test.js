// tests/session.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/session.js';

test('getCounts starts all categories at zero', () => {
  const session = createSession();
  assert.deepEqual(session.getCounts(), {
    voiced: 0,
    'too-quiet': 0,
    'no-pitch': 0,
    'out-of-range': 0,
  });
});

test('record increments the matching category count', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.record({ category: 'voiced', hz: 115 }, 1100);
  session.record({ category: 'too-quiet', hz: null }, 1200);
  const counts = session.getCounts();
  assert.equal(counts.voiced, 2);
  assert.equal(counts['too-quiet'], 1);
  assert.equal(counts['no-pitch'], 0);
  assert.equal(counts['out-of-range'], 0);
});

test('getHistory returns entries in the order they were recorded', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.record({ category: 'voiced', hz: 200 }, 2000);
  const history = session.getHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].hz, 110);
  assert.equal(history[1].hz, 200);
});

test('getHistory returns a copy, not a live reference', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  const history = session.getHistory();
  history.push({ category: 'voiced', hz: 999, timestampMs: 9999 });
  assert.equal(session.getHistory().length, 1);
});

test('reset clears counts and history', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  session.reset();
  assert.deepEqual(session.getCounts(), {
    voiced: 0,
    'too-quiet': 0,
    'no-pitch': 0,
    'out-of-range': 0,
  });
  assert.equal(session.getHistory().length, 0);
});

test('getCounts returns a copy, not a live reference', () => {
  const session = createSession();
  session.record({ category: 'voiced', hz: 110 }, 1000);
  const counts = session.getCounts();
  counts.voiced = 999;
  assert.equal(session.getCounts().voiced, 1);
});

test('record throws on an unrecognized category rather than silently corrupting counts', () => {
  const session = createSession();
  assert.throws(() => session.record({ category: 'bogus', hz: 110 }, 1000));
});
