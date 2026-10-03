// German by default (the app is for practices in Germany), English on the
// Practice page. The choice is per device, like the rest of the data.
import { STRINGS } from './strings.js';

const KEY = 'fzer0s.lang';
export const LANGS = ['de', 'en'];

function readLang() {
  try {
    const value = window.localStorage.getItem(KEY);
    return LANGS.includes(value) ? value : 'de';
  } catch {
    return 'de';
  }
}

export const LANG = readLang();
export const LOCALE = LANG === 'de' ? 'de-DE' : 'en-GB';

export function setLang(lang) {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // Private mode: the switch lasts for this page only.
  }
  window.location.reload();
}

// t('key') or t('key', { n: 3 }). An entry is a string with {placeholders}
// or a function of the values (for plurals and word order).
export function t(key, vars = {}) {
  const entry = STRINGS[LANG][key] ?? STRINGS.en[key];
  if (entry === undefined) return key;
  if (typeof entry === 'function') return entry(vars);
  return entry.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? '').toString());
}

// 1.5 → "1,5" in German.
export const num = (n) => (LANG === 'de' ? String(n).replace('.', ',') : String(n));

// "3 Oct" / "3. Okt."
export function shortDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}
export const longDate = (ms) => new Date(ms).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
export const clockTime = (ms) => new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });

// A recording's name in this language: the therapist's own name if they gave
// one, otherwise its place in the day.
export function recordingName(rec) {
  const custom = String(rec.session.customName ?? '').trim();
  if (custom) return custom;
  if (rec.autoName === 'Before session') return t('name.before');
  if (rec.autoName === 'After session') return t('name.after');
  return t('name.recording', { n: rec.position });
}

// Fills every [data-i18n] in static markup, and [data-i18n-aria] labels.
export function applyStatic(root = document) {
  document.documentElement.lang = LANG;
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
}
