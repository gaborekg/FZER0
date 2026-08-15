import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMeetCallUrl } from '../src/meet-url.js';

test('recognizes a real Meet call code path', () => {
  assert.equal(isMeetCallUrl('/abc-defg-hij'), true);
});

test('rejects the Meet landing page', () => {
  assert.equal(isMeetCallUrl('/'), false);
  assert.equal(isMeetCallUrl('/landing'), false);
});

test('rejects a path missing the third segment', () => {
  assert.equal(isMeetCallUrl('/abc-defg'), false);
});
