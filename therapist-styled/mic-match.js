// The Match microphone sheet: a steady sound, measured by the therapist's dB
// meter and by FZero, gives this microphone's offset (see spl.js). Done once
// per microphone; the microphone is on only while listening.
import { startCapture } from './app/audio.js';
import { dbfs, micOf, saveMatch } from './spl.js';
import { t, num } from './i18n.js';

const LISTEN_MS = 5000;
// The first moments after the microphone opens can be a click or silence.
const SETTLE_MS = 400;
const MIN_DB = 20;
const MAX_DB = 130;

export function openMicMatch({ beforeListen = async () => {}, onListeningChange = () => {}, onSaved = () => {}, onClosed = () => {} }) {
  const sheet = document.createElement('dialog');
  sheet.className = 'sheet';
  sheet.setAttribute('aria-labelledby', 'mm-title');
  sheet.innerHTML = `
    <span class="sheet-grip" aria-hidden="true"></span>
    <h2 class="sheet-title" id="mm-title">${t('mm.title')}</h2>
    <ol class="sheet-steps">
      <li>${t('mm.step1')}</li>
      <li>${t('mm.step2')}</li>
      <li>${t('mm.step3')}</li>
    </ol>
    <div class="progress" aria-hidden="true"><span data-el="bar"></span></div>
    <p class="sheet-status" role="status" data-el="status"></p>
    <label class="field" data-el="field" hidden><span>${t('mm.ask')}</span><input data-el="value" type="number" inputmode="decimal" min="${MIN_DB}" max="${MAX_DB}" step="0.1" /></label>
    <div class="sheet-actions">
      <button type="button" class="ghost" data-action="cancel">${t('common.cancel')}</button>
      <button type="button" class="cream" data-action="listen">${t('cal.listen')}</button>
    </div>`;
  const bar = sheet.querySelector('[data-el="bar"]');
  const status = sheet.querySelector('[data-el="status"]');
  const field = sheet.querySelector('[data-el="field"]');
  const input = sheet.querySelector('[data-el="value"]');
  const button = sheet.querySelector('[data-action="listen"]');
  document.body.appendChild(sheet);

  let capture = null;
  let frame = null;
  let cancelled = false;
  // What FZero heard: { mic, dbfs }, once listening is done.
  let heard = null;

  async function stopListening() {
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    const c = capture;
    capture = null;
    if (c) {
      await c.stop();
      onListeningChange(false);
    }
  }
  async function close() {
    cancelled = true;
    await stopListening();
    sheet.close();
  }
  sheet.addEventListener('close', () => {
    sheet.remove();
    onClosed();
  });
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);

  async function listen() {
    button.disabled = true;
    cancelled = false;
    heard = null;
    field.hidden = true;
    status.textContent = t('cal.waiting');
    bar.style.transform = 'scaleX(0)';
    await beforeListen();
    if (cancelled) return;
    let sum = 0;
    let count = 0;
    let openedAt = null;
    try {
      const opened = await startCapture(({ rms }) => {
        if (openedAt === null || performance.now() - openedAt < SETTLE_MS) return;
        sum += rms * rms;
        count += 1;
      });
      if (cancelled) {
        await opened.stop();
        return;
      }
      capture = opened;
      openedAt = performance.now();
    } catch {
      status.textContent = t('cal.blocked');
      button.textContent = t('cal.retry');
      button.disabled = false;
      return;
    }
    const mic = micOf(capture.stream);
    onListeningChange(true);
    status.textContent = t('cal.listening');
    const tick = () => {
      const done = Math.min(1, (performance.now() - openedAt) / LISTEN_MS);
      bar.style.transform = `scaleX(${done})`;
      if (done < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
    if (cancelled) return;
    await stopListening();

    if (count === 0 || sum === 0) {
      status.textContent = t('cal.nothing');
      button.textContent = t('cal.retry');
      button.disabled = false;
      return;
    }
    heard = { mic, dbfs: dbfs(sum / count) };
    status.textContent = t('mm.heard', { mic });
    field.hidden = false;
    button.textContent = t('mm.save');
    button.disabled = false;
    input.focus();
  }

  function save() {
    const typed = Number(String(input.value).replace(',', '.'));
    if (!input.value || !Number.isFinite(typed) || typed < MIN_DB || typed > MAX_DB) {
      status.textContent = t('mm.invalid', { min: MIN_DB, max: MAX_DB });
      return;
    }
    saveMatch(heard.mic, typed - heard.dbfs);
    status.textContent = t('mm.saved', { mic: heard.mic, db: num(Math.round(typed)) });
    button.disabled = true;
    onSaved();
    setTimeout(() => sheet.open && sheet.close(), 900);
  }

  button.addEventListener('click', () => (heard ? save() : listen()));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && heard) save();
  });

  sheet.showModal();
}
