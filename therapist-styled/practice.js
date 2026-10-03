// Practice-wide settings on this device: the safety checklist. Patient data
// lives per patient; this is only what the practice confirmed about the iPad.
const KEY = 'fzer0s.practice';

export function getPractice() {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

export function savePractice(patch) {
  window.localStorage.setItem(KEY, JSON.stringify({ ...getPractice(), ...patch }));
}

// Opened from the Home Screen: Safari then keeps the data instead of
// clearing it after 7 days without use.
export const isHomeScreen = () =>
  window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;

export const safetyDone = () => Boolean(getPractice().passcodeConfirmedAt) && isHomeScreen();
