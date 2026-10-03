// Measure: setup checklist, Ready (neutral mic check), Recording (zone
// colour), then the saved take or the After summary. Undo sits near Start
// until the next take.
import { setupStatus } from './src/patient-setup.js';
import { groupDays, dayKey } from './src/day-groups.js';
import { bandNotesFor } from './src/voice-bands.js';
import { hzToNote } from './src/note-hz.js';
import { makeId } from './src/app-store.js';
import { micHelpFor } from './src/mic-help.js';
import { putAudio, deleteAudio, askToPersist } from './app/audio-store.js';
import { createLiveMic } from './live-mic.js';
import { arcSvg, paintArc, lineScaleSvg } from './scale.js';
import { offFrom, liveWords, textColour, shapeColour, distanceWords, shortWords, clock, hueFor } from './zone.js';
import { takeValues, SHORT_KEYS, takeOff, changeSentence } from './take-stats.js';
import { openCalibration } from './calibration.js';

const MIN_TAKE_MS = 3000;
const FRAME_MS = 100;
const MIC_HEARD = '✓ Hearing the patient';
const MIC_SILENT = "Can't hear a voice yet. Ask the patient to say something, about 30 cm from the device.";

const MARKUP = `
  <div class="setup" data-el="setup" hidden>
    <div class="setup-box">
      <h1 class="setup-title" data-el="setup-title"></h1>
      <ul class="card checklist">
        <li data-el="check-notes"><span class="check" aria-hidden="true"></span><span class="grow">Voice notes set</span><button type="button" class="ghost" data-action="open-profile">Open Profile</button></li>
        <li data-el="check-cal"><span class="check" aria-hidden="true"></span><span class="grow">Voice calibrated</span><button type="button" class="ghost" data-action="calibrate">Calibrate</button></li>
      </ul>
    </div>
  </div>

  <div class="measure-layout" data-el="live" hidden>
    <div class="measure-main">
      <div class="dial">
        ${arcSvg()}
        <span class="ring breathe" data-el="ring" aria-hidden="true"></span>
        <span class="dial-text">
          <span class="dial-big" data-el="big">Ready</span>
          <span class="dial-sub" data-el="sub"></span>
          <span class="dial-note muted" data-el="note"></span>
          <span class="rec-line" data-el="rec-line" hidden><span class="rec-blink" aria-hidden="true"></span><span data-el="clock" role="timer">Recording 0:00</span></span>
        </span>
      </div>
      <p class="visually-hidden" aria-live="polite" data-el="announce"></p>
      <button type="button" class="start glow" data-action="toggle"><span class="stop-square" data-el="stop-square" aria-hidden="true" hidden></span><span data-el="toggle-label">Start</span></button>
    </div>
    <div class="measure-side">
      <p class="mic-line" role="status" data-el="mic-line"></p>
      <button type="button" class="ghost" data-action="mic-on" hidden>Turn on microphone</button>
      <p class="next-line muted" data-el="next-line"></p>
      <section class="card today">
        <h2>Today</h2>
        <p class="muted" data-el="no-takes" style="margin: 0">No recordings yet</p>
        <ul data-el="today-list"></ul>
      </section>
      <p class="undo-line" role="status" data-el="undo-line" hidden><span class="muted" data-el="undo-text"></span><button type="button" class="link" data-action="undo">Undo</button></p>
      <div class="note-line" role="status" data-el="note-line" hidden></div>
    </div>
  </div>

  <div class="result-layout" data-el="result" hidden></div>
`;

const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const ringFor = (off) => {
  const h = Math.round(hueFor(off));
  return `radial-gradient(circle, hsl(${h} 45% 55% / 0.32), hsl(${h} 45% 55% / 0.04) 70%)`;
};
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function zoneLine(off, words) {
  const line = el('span', 'zone-line');
  const dot = el('span', 'zone-dot');
  dot.setAttribute('aria-hidden', 'true');
  if (off !== null) {
    dot.style.background = shapeColour(off);
    line.style.color = textColour(off);
  }
  line.append(dot, document.createTextNode(words));
  return line;
}
function valuesList(values) {
  const dl = el('dl', 'card values');
  values.forEach(({ label, value }) => dl.append(el('dt', '', label), el('dd', '', value)));
  return dl;
}

export function createMeasureScreen(
  root,
  { store, getPatient, onSessionSaved, onRecordingChange, onBusyChange, onOpenProfile, onOpenHistory, onListeningChange = () => {} }
) {
  root.innerHTML = MARKUP;
  const $ = (selector) => root.querySelector(selector);
  const views = { setup: $('[data-el="setup"]'), live: $('[data-el="live"]'), result: $('[data-el="result"]') };
  const arc = $('.arc');
  const ring = $('[data-el="ring"]');
  const toggle = $('[data-action="toggle"]');
  const micOnButton = $('[data-action="mic-on"]');
  const micLine = $('[data-el="mic-line"]');
  const noteLine = $('[data-el="note-line"]');

  let profile = store.getProfile();
  const mic = createLiveMic(() => profile);
  let visible = false;
  let micWanted = false;
  let timer = null;
  let takeStartedAt = null;
  let calibrationAtStart = null;
  let stopping = false;
  let listening = false;
  let wakeLock = null;
  let announced = null;
  // The last take's undo: { kind: 'saved' | 'discarded', session, blob, name }.
  let pending = null;
  // The take on the result screen: { session, blob, name }.
  let shown = null;

  const isReady = () => setupStatus(profile, new Date().getFullYear()).ready;
  const isBusy = () => mic.isTaking() || stopping;

  function showView(name) {
    Object.entries(views).forEach(([key, node]) => {
      node.hidden = key !== name;
    });
  }

  function say(text, steps = []) {
    noteLine.hidden = !text;
    noteLine.replaceChildren();
    if (!text) return;
    noteLine.appendChild(el('span', '', text));
    if (steps.length) {
      const ol = el('ol');
      steps.forEach((step) => ol.appendChild(el('li', '', step)));
      noteLine.appendChild(ol);
    }
  }

  // --- setup ----------------------------------------------------------------
  function renderSetup() {
    const status = setupStatus(profile, new Date().getFullYear());
    $('[data-el="setup-title"]').textContent = `Before ${profile.firstName || 'the patient'}'s first recording`;
    [
      ['check-notes', status.notes, 'open-profile'],
      ['check-cal', status.calibrated, 'calibrate'],
    ].forEach(([key, done, action]) => {
      const li = $(`[data-el="${key}"]`);
      li.classList.toggle('done', done);
      li.querySelector('.check').textContent = done ? '✓' : '';
      li.querySelector(`[data-action="${action}"]`).hidden = done;
    });
  }

  function calibrate() {
    if (isBusy()) return;
    openCalibration({
      store,
      beforeListen: () => mic.close(),
      onListeningChange: (on) => {
        listening = on;
        toggle.disabled = on;
        onListeningChange(on);
      },
      onSaved: () => {
        refreshProfile();
        onSessionSaved();
      },
    });
  }
  $('[data-action="calibrate"]').addEventListener('click', calibrate);
  $('[data-action="open-profile"]').addEventListener('click', () => onOpenProfile());

  // --- live view --------------------------------------------------------------
  function renderSide() {
    const today = groupDays(store.listSessions()).find((day) => day.key === dayKey(Date.now()));
    const recs = today ? today.recordings : [];
    $('[data-el="next-line"]').textContent = recs.length === 0 ? 'Next: Before session' : 'Next: After session';
    $('[data-el="no-takes"]').hidden = recs.length > 0;
    $('[data-el="today-list"]').replaceChildren(
      ...recs.map((rec) => {
        const s = rec.session;
        const off = takeOff(s, profile.targetNote);
        const li = el('li');
        const top = el('span', 'row-top');
        top.append(el('span', '', rec.name), el('span', 'small muted', `${time(s.startedAtMs)} · ${s.meanHz ? hzToNote(s.meanHz) : '—'}`));
        li.append(top, zoneLine(off, shortWords(off)));
        return li;
      })
    );
    const undo = $('[data-el="undo-line"]');
    undo.hidden = !pending;
    if (pending) $('[data-el="undo-text"]').textContent = `${pending.name} ${pending.kind} ·`;
  }

  function renderLive() {
    const recording = mic.isTaking();
    const r = mic.reading();
    const target = profile.targetNote;
    const off = mic.isOpen() && r.hz ? offFrom(r.hz, target) : null;
    const active = recording || r.hearing;
    paintArc(arc, { off, recording, hearing: r.hearing && mic.isOpen() });
    ring.style.transform = `scale(${(0.45 + 0.55 * (active ? r.level : 0.15)).toFixed(3)})`;
    ring.style.background = recording && off !== null ? ringFor(off) : '';
    ring.classList.toggle('breathe', !recording);

    const big = $('[data-el="big"]');
    const sub = $('[data-el="sub"]');
    if (recording && off !== null) {
      const words = liveWords(off, target);
      big.textContent = words.big;
      sub.textContent = words.sub;
      big.style.color = sub.style.color = textColour(off);
      $('[data-el="note"]').textContent = `Voice on ${hzToNote(r.hz)}`;
    } else {
      big.textContent = recording ? 'Listening' : 'Ready';
      sub.textContent = '';
      big.style.color = sub.style.color = '';
      $('[data-el="note"]').textContent = '';
    }
    // Announced only when the reading changes: a live region firing ten
    // times a second would make a screen reader unusable.
    const spoken = recording && off !== null ? distanceWords(off, target) : '';
    if (spoken !== announced) {
      announced = spoken;
      $('[data-el="announce"]').textContent = spoken;
    }

    $('[data-el="rec-line"]').hidden = !recording;
    if (recording) $('[data-el="clock"]').textContent = `Recording ${clock(Date.now() - takeStartedAt)}`;

    micOnButton.hidden = recording || mic.isOpen();
    micLine.classList.remove('heard', 'silent');
    if (recording) micLine.textContent = '';
    else if (!mic.isOpen()) micLine.textContent = 'Microphone is off.';
    else {
      micLine.textContent = r.hearing ? MIC_HEARD : MIC_SILENT;
      micLine.classList.add(r.hearing ? 'heard' : 'silent');
    }

    toggle.classList.toggle('glow', !recording);
    $('[data-el="stop-square"]').hidden = !recording;
    if (!stopping) $('[data-el="toggle-label"]').textContent = recording ? 'Stop' : 'Start';
  }

  function startTimer() {
    if (!timer) timer = setInterval(renderLive, FRAME_MS);
  }
  function stopTimer() {
    clearInterval(timer);
    timer = null;
  }

  async function turnMicOn() {
    micWanted = true;
    try {
      await mic.open();
      say('');
    } catch {
      const help = micHelpFor(navigator.userAgent, { origin: window.location.origin });
      say(`FZero could not use the microphone. In ${help.name}:`, help.steps);
    }
    renderLive();
  }
  micOnButton.addEventListener('click', turnMicOn);

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      wakeLock = null;
    }
  }
  async function releaseWakeLock() {
    try {
      await wakeLock?.release();
    } catch {
      // Already gone.
    }
    wakeLock = null;
  }

  // --- recording --------------------------------------------------------------
  async function start() {
    if (!isReady() || listening) return;
    pending = null;
    say('');
    toggle.disabled = true;
    await turnMicOn();
    if (!mic.isOpen()) {
      toggle.disabled = false;
      return;
    }
    calibrationAtStart = profile.calibratedAtMs ?? null;
    const { audioFailed } = mic.startTake(bandNotesFor(profile.sex));
    takeStartedAt = Date.now();
    await requestWakeLock();
    toggle.disabled = false;
    onRecordingChange(true);
    if (audioFailed) say('Audio could not be recorded, so only the numbers will be saved.');
    renderSide();
    renderLive();
  }

  async function stop() {
    stopping = true;
    onBusyChange();
    toggle.disabled = true;
    $('[data-el="toggle-label"]').textContent = 'Saving…';
    const tookMs = Date.now() - takeStartedAt;
    try {
      const { summary, blob } = await mic.stopTake({
        zoneNotes: [profile.targetNote],
        rangeLowNote: profile.rangeLowNote,
        rangeHighNote: profile.rangeHighNote,
        targetNote: profile.targetNote,
      });
      await releaseWakeLock();
      takeStartedAt = null;
      onRecordingChange(false);

      if (!summary || tookMs < MIN_TAKE_MS) {
        say(`Too short to save (${clock(tookMs)}). Try again.`);
        return;
      }
      const id = makeId();
      let hasAudio = false;
      let audioNote = '';
      if (blob) {
        try {
          await putAudio(id, blob);
          hasAudio = true;
          askToPersist();
        } catch (error) {
          audioNote = error?.name === 'QuotaExceededError' ? "Audio couldn't be saved: storage is full." : "Audio couldn't be saved.";
        }
      }
      const session = { ...summary, id, hasAudio, shared: false, calibratedAtMs: calibrationAtStart };
      const { droppedIds } = store.addSession(session);
      if (droppedIds.length > 0) deleteAudio(droppedIds).catch(() => {});
      onSessionSaved();
      showResult(session, hasAudio ? blob : null);
      say(audioNote);
    } finally {
      stopping = false;
      toggle.disabled = listening;
      // Left Measure while it was saving: let go of the mic now.
      if (!visible) await mic.close();
      onBusyChange();
      renderLive();
    }
  }

  toggle.addEventListener('click', () => {
    if (stopping) return;
    if (mic.isTaking()) stop();
    else start();
  });

  // --- results ----------------------------------------------------------------
  function todayDayOf(session) {
    return groupDays(store.listSessions()).find((day) => day.key === dayKey(session.startedAtMs));
  }

  function showResult(session, blob) {
    const day = todayDayOf(session);
    const rec = day?.recordings.find((r) => r.session.id === session.id);
    shown = { session, blob, name: rec ? rec.name : 'Recording' };
    const result = views.result;
    result.replaceChildren();
    const off = takeOff(session);
    const words = distanceWords(off, session.targetNote);
    const head = el('div', 'result-head');
    const side = el('div', 'result-side');

    if (!rec || rec.position === 1) {
      head.append(el('p', 'muted', `Saved · today ${time(session.startedAtMs)}`), el('h1', 'result-name', shown.name));
      const w = el('p', 'result-words', words);
      if (off !== null) w.style.color = textColour(off);
      head.appendChild(w);
      head.insertAdjacentHTML('beforeend', lineScaleSvg(off, { width: 420, label: words }));
      head.appendChild(el('p', 'muted', 'The next recording today becomes the After session.'));
      side.appendChild(valuesList(takeValues(session)));
      const actions = el('div', 'result-actions');
      const done = el('button', 'cream', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => backToLive('saved'));
      actions.appendChild(done);
      const discard = el('button', 'text-danger', 'Discard take');
      discard.type = 'button';
      discard.style.alignSelf = 'flex-start';
      discard.addEventListener('click', discardShown);
      side.append(actions, discard);
    } else {
      const before = day.first;
      head.appendChild(el('p', 'muted', `${getPatient().displayName} · today ${time(session.startedAtMs)} · ${shown.name}`));
      const headline = el('div', 'headline');
      const halo = el('span', 'halo');
      halo.setAttribute('aria-hidden', 'true');
      if (off !== null) halo.style.setProperty('--zone', shapeColour(off));
      const w = el('p', 'result-words', words);
      if (off !== null) w.style.color = textColour(off);
      headline.append(halo, w);
      head.appendChild(headline);
      head.insertAdjacentHTML('beforeend', lineScaleSvg(off, { width: 420, label: words }));
      head.appendChild(el('p', '', changeSentence(before, session)));

      const card = el('section', 'card compare');
      const grid = el('div', 'compare-grid');
      // Time on target is only comparable when both takes had the same target.
      const beforeValues = takeValues({
        ...before,
        targetNote: session.targetNote,
        inZoneShare: before.targetNote === session.targetNote ? before.inZoneShare : null,
      });
      const afterValues = takeValues(session);
      let all = false;
      const more = el('button', 'link', 'Show all 7 values ›');
      more.type = 'button';
      more.style.alignSelf = 'flex-start';
      const fillGrid = () => {
        grid.replaceChildren(el('span'), el('span', 'head', 'Before'), el('span', 'head', 'After'));
        // Short list in the decided order: Time on target, pitch, volume.
        const keys = all ? afterValues.map((v) => v.key) : SHORT_KEYS;
        keys.forEach((key) => {
          const i = afterValues.findIndex((v) => v.key === key);
          // The note under the table says what the percentage is of.
          const cell = (v) => el('span', '', v.replace(' of speaking time', ''));
          grid.append(el('span', 'muted', afterValues[i].label), cell(beforeValues[i].value), cell(afterValues[i].value));
        });
        more.textContent = all ? 'Show fewer' : 'Show all 7 values ›';
      };
      more.addEventListener('click', () => {
        all = !all;
        fillGrid();
      });
      fillGrid();
      card.append(grid, more);
      side.append(card, el('p', 'small muted', `Time on ${session.targetNote} = share of speaking time within ½ semitone of ${session.targetNote}.`));
      const actions = el('div', 'result-actions two');
      const done = el('button', 'cream', 'Done');
      done.type = 'button';
      done.addEventListener('click', () => {
        backToLive('saved');
        onOpenHistory();
      });
      const another = el('button', 'ghost', 'Record another');
      another.type = 'button';
      another.addEventListener('click', () => backToLive('saved'));
      actions.append(done, another);
      side.appendChild(actions);
    }
    result.append(head, side);
    showView('result');
    stopTimer();
  }

  function backToLive(kind) {
    if (shown) pending = { kind, ...shown };
    shown = null;
    render();
  }

  function discardShown() {
    if (!shown) return;
    store.deleteSessions([shown.session.id]);
    deleteAudio([shown.session.id]).catch(() => {});
    onSessionSaved();
    backToLive('discarded');
  }

  $('[data-action="undo"]').addEventListener('click', async () => {
    const p = pending;
    pending = null;
    if (!p) return;
    if (p.kind === 'saved') {
      store.deleteSessions([p.session.id]);
      deleteAudio([p.session.id]).catch(() => {});
    } else {
      store.addSession(p.session);
      if (p.blob) await putAudio(p.session.id, p.blob).catch(() => {});
    }
    onSessionSaved();
    renderSide();
  });

  // --- screen -----------------------------------------------------------------
  function render() {
    if (shown) return;
    if (!isReady() && !isBusy()) {
      renderSetup();
      showView('setup');
      stopTimer();
      return;
    }
    showView('live');
    renderSide();
    renderLive();
    if (visible) startTimer();
  }

  function refreshProfile() {
    profile = store.getProfile();
    render();
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !mic.isOpen()) return;
    // The browser drops the wake lock whenever the page is hidden.
    if (mic.isTaking() && (!wakeLock || wakeLock.released)) await requestWakeLock();
    if (!mic.isRunning()) await mic.resume();
  });

  return {
    async show() {
      visible = true;
      profile = store.getProfile();
      render();
      if (micWanted && isReady() && !shown) await turnMicOn();
    },
    // Leaving Measure lets go of the microphone, unless a take is running.
    async hide() {
      visible = false;
      stopTimer();
      if (!isBusy()) await mic.close();
    },
    refreshProfile,
    isBusy,
    setListening(on) {
      listening = on;
      toggle.disabled = on;
    },
  };
}
