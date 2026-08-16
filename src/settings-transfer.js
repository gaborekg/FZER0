// Moving your setup between the extension and the web app.
//
// They cannot share a store: an extension has no access to a page's
// localStorage and a page has none to chrome.storage. Rather than pretend
// otherwise, this makes the handover explicit — a small file you export from
// one and import into the other.

export const FORMAT = 'fzer0.settings';
export const VERSION = 1;

// Only the fields that describe the voice — which includes sex, because it
// decides which notes the chart covers. Names, dates, sessions and anything
// else personal stay where they are; this file is meant to be small enough
// that exporting it is not a decision.
export const TRANSFERABLE = [
  'sex',
  'fundamentalNote',
  'rangeLowNote',
  'rangeHighNote',
  'targetNote',
  'volumeCeilingRms',
  'typicalRms',
];

export function exportSettings(source = {}) {
  const settings = {};
  TRANSFERABLE.forEach((field) => {
    const value = source[field];
    // Undefined and null both mean "never set", and neither is worth carrying.
    if (value !== undefined && value !== null && value !== '') settings[field] = value;
  });

  return JSON.stringify({ format: FORMAT, version: VERSION, settings }, null, 2);
}

export function importSettings(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That is not a settings file.');
  }

  if (parsed?.format !== FORMAT) {
    throw new Error('That is not a FZER0 settings file.');
  }
  if (parsed.version > VERSION) {
    throw new Error('That file was written by a newer version of FZER0.');
  }

  const settings = parsed.settings ?? {};
  const result = {};
  TRANSFERABLE.forEach((field) => {
    // Unknown keys are dropped rather than merged: a settings file is not a
    // way to write arbitrary values into someone's storage.
    if (field in settings) result[field] = settings[field];
  });

  if (Object.keys(result).length === 0) {
    throw new Error('That file has no settings in it.');
  }

  return result;
}
