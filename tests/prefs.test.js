import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrefsStore } from '../src/prefs.js';

function createFakeStorage() {
  const data = {};
  return {
    get(keys, callback) {
      const result = {};
      for (const key of keys) {
        if (key in data) result[key] = data[key];
      }
      callback(result);
    },
    set(values, callback) {
      Object.assign(data, values);
      callback();
    },
  };
}

test('getSetup returns nulls when nothing has been saved', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  const setup = await prefs.getSetup();
  assert.deepEqual(setup, {
    rangeLowNote: null,
    rangeHighNote: null,
    targetNote: null,
    referenceToneNote: null,
  });
});

test('saveSetup then getSetup round-trips the saved values', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveSetup({
    rangeLowNote: 'F2',
    rangeHighNote: 'C3',
    targetNote: 'A2',
    referenceToneNote: 'A2',
  });
  const setup = await prefs.getSetup();
  assert.deepEqual(setup, {
    rangeLowNote: 'F2',
    rangeHighNote: 'C3',
    targetNote: 'A2',
    referenceToneNote: 'A2',
  });
});

test('saveSetup without referenceToneNote falls back to targetNote', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' });
  const setup = await prefs.getSetup();
  assert.equal(setup.referenceToneNote, 'A2');
});

test('getCalibration returns nulls when nothing has been measured', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  assert.deepEqual(await prefs.getCalibration(), {
    volumeCeilingRms: null,
    typicalRms: null,
  });
});

test('saveCalibration then getCalibration round-trips the measurements', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveCalibration({ volumeCeilingRms: 0.061, typicalRms: 0.023 });
  assert.deepEqual(await prefs.getCalibration(), {
    volumeCeilingRms: 0.061,
    typicalRms: 0.023,
  });
});

test('saveSetup does not clobber a saved calibration', async () => {
  // The two live under separate keys precisely so that editing the range in
  // the details view cannot wipe out a calibration the user sat through.
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveCalibration({ volumeCeilingRms: 0.061, typicalRms: 0.023 });
  await prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' });

  assert.deepEqual(await prefs.getCalibration(), {
    volumeCeilingRms: 0.061,
    typicalRms: 0.023,
  });
});

test('saveCalibration does not clobber a saved setup', async () => {
  const prefs = createPrefsStore(createFakeStorage());
  await prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' });
  await prefs.saveCalibration({ volumeCeilingRms: 0.061, typicalRms: 0.023 });

  const setup = await prefs.getSetup();
  assert.equal(setup.rangeLowNote, 'F2');
  assert.equal(setup.targetNote, 'A2');
});

test('createPrefsStore throws when no storage backend is available', () => {
  assert.throws(() => createPrefsStore(null));
});

test('saveSetup rejects when chrome.runtime.lastError is set inside the storage.set callback', async () => {
  // Real chrome.storage.local never rejects its callback directly — a
  // quota-exceeded or invalidated-context failure surfaces only via
  // chrome.runtime.lastError, read inside the callback. Simulate that here
  // with a fake storage whose set() succeeds at the callback level but a
  // global chrome.runtime.lastError is present, exactly as the real API
  // would leave it.
  const storage = {
    get(keys, callback) {
      callback({});
    },
    set(values, callback) {
      callback();
    },
  };
  globalThis.chrome = { runtime: { lastError: { message: 'QUOTA_BYTES_PER_ITEM exceeded' } } };
  try {
    const prefs = createPrefsStore(storage);
    await assert.rejects(
      () => prefs.saveSetup({ rangeLowNote: 'F2', rangeHighNote: 'C3', targetNote: 'A2' }),
      /QUOTA_BYTES_PER_ITEM exceeded/
    );
  } finally {
    delete globalThis.chrome;
  }
});
