// The calibration sheet: 5 seconds of normal talk sets how loud this
// patient's normal voice is. Opens from Measure (in place) and from Profile.
import { computeCeilingFromSamples, computeTypicalFromSamples } from './src/volume-calibration.js';
import { dayKey } from './src/day-groups.js';
import { startCapture } from './app/audio.js';
import { t } from './i18n.js';

const LISTEN_MS = 5000;

export function openCalibration({ store, beforeListen = async () => {}, onListeningChange = () => {}, onSaved = () => {}, onClosed = () => {} }) {
  const profile = store.getProfile();
  const today = dayKey(Date.now());
  const recordedToday = store.listSessions().some((s) => dayKey(s.startedAtMs) === today);
  if (profile.calibratedAtMs && recordedToday && !window.confirm(t('cal.warning'))) return;

  const first = profile.firstName || t('cal.thePatient');
  const sheet = document.createElement('dialog');
  sheet.className = 'sheet';
  sheet.setAttribute('aria-labelledby', 'cal-title');
  sheet.innerHTML = `
    <span class="sheet-grip" aria-hidden="true"></span>
    <h2 class="sheet-title" id="cal-title"></h2>
    <p class="sheet-text" data-el="text"></p>
    <div class="progress" aria-hidden="true"><span data-el="bar"></span></div>
    <p class="sheet-status" role="status" data-el="status"></p>
    <div class="sheet-actions">
      <button type="button" class="ghost" data-action="cancel">${t('common.cancel')}</button>
      <button type="button" class="cream" data-action="listen">${t('cal.listen')}</button>
    </div>`;
  sheet.querySelector('#cal-title').textContent = t('cal.title', { name: first });
  sheet.querySelector('[data-el="text"]').textContent =
    t('cal.text', { name: first });
  const bar = sheet.querySelector('[data-el="bar"]');
  const status = sheet.querySelector('[data-el="status"]');
  const listenButton = sheet.querySelector('[data-action="listen"]');
  document.body.appendChild(sheet);

  let capture = null;
  let frame = null;
  let cancelled = false;

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

  listenButton.addEventListener('click', async () => {
    listenButton.disabled = true;
    cancelled = false;
    status.textContent = t('cal.waiting');
    bar.style.transform = 'scaleX(0)';
    await beforeListen();
    if (cancelled) return;
    const samples = [];
    try {
      const opened = await startCapture(({ rms }) => samples.push(rms));
      // Cancelled while the mic was still opening: close it straight away.
      if (cancelled) {
        await opened.stop();
        return;
      }
      capture = opened;
    } catch {
      status.textContent = t('cal.blocked');
      listenButton.textContent = t('cal.retry');
      listenButton.disabled = false;
      return;
    }
    onListeningChange(true);
    status.textContent = t('cal.listening');
    const startedAt = performance.now();
    const tick = () => {
      const done = Math.min(1, (performance.now() - startedAt) / LISTEN_MS);
      bar.style.transform = `scaleX(${done})`;
      if (done < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    await new Promise((resolve) => setTimeout(resolve, LISTEN_MS));
    if (cancelled) return;
    await stopListening();

    if (samples.length === 0) {
      status.textContent = t('cal.nothing');
      listenButton.textContent = t('cal.retry');
      listenButton.disabled = false;
      return;
    }
    store.saveProfile({
      volumeCeilingRms: computeCeilingFromSamples(samples),
      typicalRms: computeTypicalFromSamples(samples),
      calibratedAtMs: Date.now(),
    });
    status.textContent = t('cal.saved');
    onSaved();
    setTimeout(() => sheet.open && sheet.close(), 700);
  });

  sheet.showModal();
}
