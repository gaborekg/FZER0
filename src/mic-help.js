// What to tell someone whose microphone is blocked.
//
// A web page cannot open browser settings — that is deliberate, and no amount
// of wanting it changes it. So the page gives exact steps for the browser it
// is actually running in, and only the extension, which is allowed to open a
// chrome:// page, offers a button that lands you on the right screen.
//
// Steps are worth getting right per browser: "check your settings" is what
// every site says and it helps nobody.

const CHROME_DESKTOP = [
  'Click the icon just left of the web address — a slider, a padlock or a camera.',
  'Choose "Site settings".',
  'Set Microphone to "Allow".',
  'Come back here and reload the page.',
];

const EDGE_DESKTOP = [
  'Click the icon just left of the web address.',
  'Choose "Permissions for this site".',
  'Set Microphone to "Allow".',
  'Come back here and reload the page.',
];

const FIREFOX_DESKTOP = [
  'Click the padlock just left of the web address.',
  'Find "Use the Microphone" and click the ✕ next to "Blocked".',
  'Reload the page and allow the microphone when asked.',
];

const SAFARI_DESKTOP = [
  'In the menu bar, open Safari → "Settings for This Website".',
  'Set Microphone to "Allow".',
  'Reload the page.',
];

const SAFARI_IOS = [
  'Tap "AA" at the left of the address bar.',
  'Tap "Website Settings", then set Microphone to "Allow".',
  'If it is not listed, open the iOS Settings app → Safari → Microphone.',
  'Reload the page.',
];

const CHROME_IOS = [
  'Open the iOS Settings app.',
  'Scroll down to Chrome and tap it.',
  'Turn Microphone on.',
  'Come back to Chrome and reload the page.',
];

const GENERIC = [
  'Open your browser settings and find site permissions.',
  'Allow the microphone for this site.',
  'Reload the page.',
];

// Chrome's own page for one site's permissions. Only reachable from an
// extension — a web page navigating here is blocked.
export function chromeSiteSettingsUrl(origin) {
  return `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`;
}

export function micHelpFor(userAgent = '', { origin = '' } = {}) {
  const ua = String(userAgent);
  const iOS = /iPhone|iPad|iPod/.test(ua);

  // Order matters: every iOS browser claims Safari, and Edge claims Chrome.
  if (iOS && /CriOS/.test(ua)) {
    return { name: 'Chrome on iPhone', steps: CHROME_IOS, settingsUrl: null };
  }
  if (iOS) {
    return { name: 'Safari on iPhone', steps: SAFARI_IOS, settingsUrl: null };
  }
  if (/Edg\//.test(ua)) {
    return { name: 'Edge', steps: EDGE_DESKTOP, settingsUrl: chromeSiteSettingsUrl(origin) };
  }
  if (/Firefox\//.test(ua)) {
    return { name: 'Firefox', steps: FIREFOX_DESKTOP, settingsUrl: null };
  }
  if (/Chrome\//.test(ua)) {
    return { name: 'Chrome', steps: CHROME_DESKTOP, settingsUrl: chromeSiteSettingsUrl(origin) };
  }
  if (/Safari\//.test(ua)) {
    return { name: 'Safari', steps: SAFARI_DESKTOP, settingsUrl: null };
  }
  return { name: 'your browser', steps: GENERIC, settingsUrl: null };
}

// `denied` is the state worth acting on: it means a previous refusal is being
// remembered, so asking again does nothing and the user has to go and change
// it. 'prompt' means the next attempt will ask, which is fine.
export async function microphoneIsBlocked(permissions = globalThis.navigator?.permissions) {
  try {
    const status = await permissions.query({ name: 'microphone' });
    return status.state === 'denied';
  } catch {
    // Firefox does not support querying this, and Safari only recently did.
    // Unknown is not the same as blocked.
    return false;
  }
}
