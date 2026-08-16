import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSettings, importSettings, FORMAT, VERSION } from '../src/settings-transfer.js';

const SETUP = {
  fundamentalNote: 'B2',
  rangeLowNote: 'G2',
  rangeHighNote: 'D3',
  targetNote: 'A2',
  volumeCeilingRms: 0.061,
  typicalRms: 0.023,
};

test('a setup survives the round trip intact', () => {
  assert.deepEqual(importSettings(exportSettings(SETUP)), SETUP);
});

test('only the voice settings travel — nothing personal', () => {
  const exported = JSON.parse(
    exportSettings({ ...SETUP, firstName: 'Danny', yearOfBirth: '1987', sessions: [1, 2, 3] })
  );

  assert.deepEqual(Object.keys(exported.settings).sort(), Object.keys(SETUP).sort());
  assert.equal(exported.format, FORMAT);
  assert.equal(exported.version, VERSION);
});

test('fields that were never set are left out rather than exported as blanks', () => {
  const exported = JSON.parse(exportSettings({ targetNote: 'A2', rangeLowNote: '', typicalRms: null }));
  assert.deepEqual(exported.settings, { targetNote: 'A2' });
});

test('importing something that is not JSON says so plainly', () => {
  assert.throws(() => importSettings('not json at all'), /not a settings file/);
});

test('importing another app\'s JSON is refused', () => {
  assert.throws(() => importSettings(JSON.stringify({ hello: 'world' })), /not a FZER0 settings file/);
});

test('a file from a newer version is refused rather than half-read', () => {
  const future = JSON.stringify({ format: FORMAT, version: VERSION + 1, settings: SETUP });
  assert.throws(() => importSettings(future), /newer version/);
});

test('unknown keys are dropped, so a settings file cannot write anything it likes', () => {
  const meddling = JSON.stringify({
    format: FORMAT,
    version: VERSION,
    settings: { targetNote: 'A2', sessions: 'wiped', __proto__: { polluted: true } },
  });

  const imported = importSettings(meddling);
  assert.deepEqual(imported, { targetNote: 'A2' });
  assert.equal({}.polluted, undefined, 'the prototype was not touched');
});

test('a file with nothing usable in it is refused, not silently applied', () => {
  const empty = JSON.stringify({ format: FORMAT, version: VERSION, settings: {} });
  assert.throws(() => importSettings(empty), /no settings in it/);
});
