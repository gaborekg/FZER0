import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppStore, EMPTY_PROFILE, MAX_SESSIONS } from '../src/app-store.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

// A storage that refuses writes over a size, the way a real one does at quota.
function crampedStorage(limitBytes) {
  const inner = fakeStorage();
  return {
    ...inner,
    setItem: (key, value) => {
      if (value.length > limitBytes) throw new Error('QuotaExceededError');
      inner.setItem(key, value);
    },
    getItem: inner.getItem,
  };
}

test('a fresh profile is empty rather than missing', () => {
  assert.deepEqual(createAppStore(fakeStorage()).getProfile(), EMPTY_PROFILE);
});

test('saving a profile patches it, leaving the other fields alone', () => {
  const store = createAppStore(fakeStorage());
  store.saveProfile({ firstName: 'Danny' });
  store.saveProfile({ targetNote: 'A2' });

  const profile = store.getProfile();
  assert.equal(profile.firstName, 'Danny');
  assert.equal(profile.targetNote, 'A2');
});

test('a profile saved by an older version still loads, with new fields blank', () => {
  const storage = fakeStorage({ 'fzer0.profile': JSON.stringify({ firstName: 'Danny' }) });
  const profile = createAppStore(storage).getProfile();

  assert.equal(profile.firstName, 'Danny');
  assert.equal(profile.targetNote, '');
});

test('corrupt stored data falls back to empty instead of throwing', () => {
  const storage = fakeStorage({ 'fzer0.profile': '{not json', 'fzer0.sessions': 'nope' });
  const store = createAppStore(storage);

  assert.deepEqual(store.getProfile(), EMPTY_PROFILE);
  assert.deepEqual(store.listSessions(), []);
});

test('sessions come back in the order they were recorded', () => {
  const store = createAppStore(fakeStorage());
  store.addSession({ startedAtMs: 1 });
  store.addSession({ startedAtMs: 2 });

  assert.deepEqual(store.listSessions().map((s) => s.startedAtMs), [1, 2]);
});

test('the log stops at the cap, dropping the oldest and saying how many', () => {
  const store = createAppStore(fakeStorage());
  for (let i = 0; i < MAX_SESSIONS; i++) store.addSession({ startedAtMs: i });

  const result = store.addSession({ startedAtMs: 999 });

  assert.equal(result.dropped, 1);
  const sessions = store.listSessions();
  assert.equal(sessions.length, MAX_SESSIONS);
  assert.equal(sessions[0].startedAtMs, 1, 'the oldest went');
  assert.equal(sessions.at(-1).startedAtMs, 999, 'the newest stayed');
});

test('running out of space keeps the session that just finished', () => {
  // The point of the retry: the new session is the one the user just sat
  // through, so it is the last thing that should be sacrificed.
  const store = createAppStore(crampedStorage(200));
  for (let i = 0; i < 12; i++) store.addSession({ startedAtMs: i });

  const sessions = store.listSessions();
  assert.ok(sessions.length < 12, 'older ones were shed');
  assert.equal(sessions.at(-1).startedAtMs, 11, 'the newest survived');
});

test('clearing sessions leaves the profile intact', () => {
  const store = createAppStore(fakeStorage());
  store.saveProfile({ firstName: 'Danny' });
  store.addSession({ startedAtMs: 1 });

  store.clearSessions();

  assert.deepEqual(store.listSessions(), []);
  assert.equal(store.getProfile().firstName, 'Danny');
});
