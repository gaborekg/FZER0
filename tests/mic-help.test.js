import { test } from 'node:test';
import assert from 'node:assert/strict';
import { micHelpFor, chromeSiteSettingsUrl, microphoneIsBlocked } from '../src/mic-help.js';

const UA = {
  chromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  edge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:129.0) Gecko/20100101 Firefox/129.0',
  safariDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1',
};

test('every browser gets steps that name what it actually shows', () => {
  assert.match(micHelpFor(UA.chromeDesktop).steps.join(' '), /Site settings/);
  assert.match(micHelpFor(UA.edge).steps.join(' '), /Permissions for this site/);
  assert.match(micHelpFor(UA.firefox).steps.join(' '), /padlock/);
  assert.match(micHelpFor(UA.safariDesktop).steps.join(' '), /Settings for This Website/);
});

test('an iPhone is told about the Settings app, not the address bar', () => {
  // On iOS the permission belongs to the app, so pointing at a page control
  // would send people looking for something that is not there.
  assert.match(micHelpFor(UA.chromeIos).steps.join(' '), /iOS Settings app/);
  assert.match(micHelpFor(UA.chromeIos).name, /Chrome on iPhone/);
});

test('Chrome on iPhone is not mistaken for Safari', () => {
  // Every iOS browser has "Safari" in its user agent, so order of checks is
  // the whole game here.
  assert.notEqual(micHelpFor(UA.chromeIos).name, micHelpFor(UA.safariIos).name);
  assert.match(micHelpFor(UA.safariIos).steps.join(' '), /AA/);
});

test('Edge is not mistaken for Chrome', () => {
  // Edge's user agent contains "Chrome/" too.
  assert.equal(micHelpFor(UA.edge).name, 'Edge');
});

test('only the browsers that have a reachable settings page offer a link', () => {
  const origin = 'https://meet.google.com';
  assert.ok(micHelpFor(UA.chromeDesktop, { origin }).settingsUrl);
  assert.ok(micHelpFor(UA.edge, { origin }).settingsUrl);

  // No deep link exists for these, and pretending otherwise would send the
  // user to a dead end.
  assert.equal(micHelpFor(UA.firefox, { origin }).settingsUrl, null);
  assert.equal(micHelpFor(UA.safariDesktop, { origin }).settingsUrl, null);
  assert.equal(micHelpFor(UA.chromeIos, { origin }).settingsUrl, null);
});

test('the settings link points at this site, not the whole browser', () => {
  const url = chromeSiteSettingsUrl('https://meet.google.com');
  assert.equal(url, 'chrome://settings/content/siteDetails?site=https%3A%2F%2Fmeet.google.com');
});

test('an unrecognised browser still gets something to do', () => {
  const help = micHelpFor('SomeBrowser/1.0');
  assert.ok(help.steps.length > 0);
  assert.equal(help.name, 'your browser');
});

test('only a remembered refusal counts as blocked', async () => {
  const query = (state) => ({ query: async () => ({ state }) });

  assert.equal(await microphoneIsBlocked(query('denied')), true);
  // 'prompt' means the next attempt will ask, which is not a problem to solve.
  assert.equal(await microphoneIsBlocked(query('prompt')), false);
  assert.equal(await microphoneIsBlocked(query('granted')), false);
});

test('a browser that cannot answer is not treated as blocked', async () => {
  // Firefox does not support querying microphone permission. Unknown is not
  // the same as denied, and guessing wrong sends people to fix nothing.
  const throwing = { query: async () => { throw new Error('TypeError'); } };
  assert.equal(await microphoneIsBlocked(throwing), false);
  assert.equal(await microphoneIsBlocked(undefined), false);
});
