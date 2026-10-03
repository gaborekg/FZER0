// The Practice page: language, the safety checklist, and the documents.
import { t, applyStatic, setLang, LANG } from './i18n.js';
import { getPractice, savePractice, isHomeScreen } from './practice.js';

applyStatic();
document.title = t('pr.pageTitle');

document.querySelectorAll('[data-lang]').forEach((button) => {
  if (button.dataset.lang === LANG) button.setAttribute('aria-current', 'true');
  button.addEventListener('click', () => {
    if (button.dataset.lang !== LANG) setLang(button.dataset.lang);
  });
});

function mark(li, done) {
  li.classList.toggle('done', done);
  li.querySelector('.check').textContent = done ? '✓' : '';
}

function render() {
  const passcode = document.querySelector('[data-el="passcode"]');
  const confirmed = Boolean(getPractice().passcodeConfirmedAt);
  mark(passcode, confirmed);
  const button = passcode.querySelector('[data-action="confirm-passcode"]');
  button.hidden = confirmed;

  const signed = document.querySelector('[data-el="signed"]');
  const signedDone = Boolean(getPractice().documentsConfirmedAt);
  mark(signed, signedDone);
  signed.querySelector('[data-action="confirm-signed"]').hidden = signedDone;

  const home = isHomeScreen();
  mark(document.querySelector('[data-el="homescreen"]'), home);
  document.querySelector('[data-el="homescreen-hint"]').textContent = t(home ? 'pr.homescreenOk' : 'pr.homescreenHint');
}

document.querySelector('[data-action="confirm-passcode"]').addEventListener('click', () => {
  savePractice({ passcodeConfirmedAt: Date.now() });
  render();
});

document.querySelector('[data-action="confirm-signed"]').addEventListener('click', () => {
  savePractice({ documentsConfirmedAt: Date.now() });
  render();
});

render();
