// The Practice page: the language of the app on this device.
import { t, applyStatic, setLang, LANG } from './i18n.js';

applyStatic();
document.title = t('pr.pageTitle');

document.querySelectorAll('[data-lang]').forEach((button) => {
  if (button.dataset.lang === LANG) button.setAttribute('aria-current', 'true');
  button.addEventListener('click', () => {
    if (button.dataset.lang !== LANG) setLang(button.dataset.lang);
  });
});
