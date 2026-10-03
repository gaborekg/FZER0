// The calibration sheet: 5 seconds of normal talk sets how loud this
// patient's normal voice is. Opens from Measure (in place) and from Profile.
import { computeCeilingFromSamples, computeTypicalFromSamples } from './src/volume-calibration.js';
import { dayKey } from './src/day-groups.js';
import { startCapture } from './app/audio.js';

const LISTEN_MS = 5000;
const WARNING =
  "Recalibrating now changes how volume is measured. Today's volume before and after won't compare directly. Pitch is not affected.\n\nCalibrate anyway?";

export function openCalibration({ store, beforeListen = async () => {}, onListeningChange = () => {}, onSaved = () => {} }) {
  const profile = store.getProfile();
  const today = dayKey(Date.now());
  const recordedToday = store.listSessions().some((s) => dayKey(s.startedAtMs) === today);
  if (profile.calibratedAtMs && recordedToday && !window.confirm(WARNING)) return;

  const first = profile.firstName || 'the patient';
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
      <button type="button" class="ghost" data-action="cancel">Cancel</button>
      <button type="button" class="cream" data-action="listen">Start listening</button>
    </div>`;
  sheet.querySelector('#cal-title').textContent = `Calibrate ${first}'s voice`;
  sheet.querySelector('[data-el="text"]').textContent =
    `Ask ${first} to talk normally for 5 seconds. Keep the device about 30 cm away, the same distance every time.`;
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
  sheet.addEventListener('close', () => sheet.remove());
  sheet.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);

  listenButton.addEventListener('click', async () => {
    listenButton.disabled = true;
    cancelled = false;
    status.textContent = 'Waiting for the microphone…';
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
      status.textContent = 'The microphone is blocked. Allow it in Settings, then try again.';
      listenButton.textContent = 'Try again';
      listenButton.disabled = false;
      return;
    }
    onListeningChange(true);
    status.textContent = 'Listening…';
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
      status.textContent = 'Nothing came through. Check the microphone and try again.';
      listenButton.textContent = 'Try again';
      listenButton.disabled = false;
      return;
    }
    store.saveProfile({
      volumeCeilingRms: computeCeilingFromSamples(samples),
      typicalRms: computeTypicalFromSamples(samples),
      calibratedAtMs: Date.now(),
    });
    status.textContent = 'Saved';
    onSaved();
    setTimeout(() => sheet.open && sheet.close(), 700);
  });

  sheet.showModal();
}
