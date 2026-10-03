// Shows one legal document in the chosen language. The German text is the one
// that counts; English is a translation for reference.
import { LANG } from './i18n.js';

const DOCS = ['privacy', 'imprint', 'consent', 'info', 'paragraph'];
const PRINTABLE = ['consent', 'info'];
const params = new URLSearchParams(window.location.search);
const doc = DOCS.includes(params.get('doc')) ? params.get('doc') : 'privacy';

const article = document.querySelector(`article[data-doc="${doc}"][data-lang="${LANG}"]`);
article.hidden = false;
document.documentElement.lang = LANG;
document.title = `${article.querySelector('h1').textContent} · FZero`;

const de = LANG === 'de';
const back = document.querySelector('[data-el="back"]');
back.textContent = de ? '‹ Zurück' : '‹ Back';
back.addEventListener('click', (event) => {
  if (window.history.length > 1) {
    event.preventDefault();
    window.history.back();
  }
});

// Practice documents have empty lines the practice fills in by hand; the
// website's own texts still carry [placeholders] for the provider.
const practiceDoc = ['consent', 'info', 'paragraph'].includes(doc);
document.querySelector('[data-el="draft"]').textContent = practiceDoc
  ? de
    ? 'Entwurf: vor der Nutzung von einer/einem Datenschutzbeauftragten prüfen lassen.'
    : 'Draft: have it checked by a data protection officer before use.'
  : de
    ? 'Entwurf: Text in [eckigen Klammern] ergänzen und vor der Nutzung von einer/einem Datenschutzbeauftragten prüfen lassen.'
    : 'Draft: fill in the text in [square brackets] and have it checked by a data protection officer before use.';
if (!de) {
  const note = document.querySelector('[data-el="translation"]');
  note.hidden = false;
  note.textContent = 'English translation for reference. The German version applies.';
}

const print = document.querySelector('[data-action="print"]');
if (PRINTABLE.includes(doc)) {
  print.hidden = false;
  print.textContent = de ? 'Drucken' : 'Print';
  print.addEventListener('click', () => window.print());
}

// The paragraph is meant to be pasted into the practice's own privacy
// information. The copy keeps it as plain text.
const copy = article.querySelector('[data-action="copy"]');
if (copy) {
  copy.addEventListener('click', async () => {
    const text = article.querySelector('[data-el="copy-source"]').innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard access: select the text so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(article.querySelector('[data-el="copy-source"]'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
    article.querySelector('[data-el="copied"]').hidden = false;
  });
}
