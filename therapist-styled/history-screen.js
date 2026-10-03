// History: where the latest day ended against the target, how its start and
// end compare with the previous and the first day, then every day's takes.
import { groupDays } from './src/day-groups.js';
import { summariseProgress } from './src/progress.js';
import { hzToNote } from './src/note-hz.js';
import { getAudio, deleteAudio } from './app/audio-store.js';
import { shareFiles } from './app/share.js';
import { filesForDay } from './day-share.js';
import { lineScaleSvg } from './scale.js';
import { distanceWords, shortWords, sideWords, textColour, shapeColour } from './zone.js';
import { takeValues, takeOff, closerWords, closerPhrase, louderPhrase } from './take-stats.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DIFFERENT = 'Different calibration. Compare volume with care.';
const CHANGED = 'Calibration changed during this day. Compare volume with care.';

const shortDay = (key) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => keyOf(new Date());
const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return keyOf(d);
};
// "Today, 10 Oct" / "Yesterday, 9 Oct" / "3 Oct"
const dayTitle = (key) => {
  if (key === todayKey()) return `Today, ${shortDay(key)}`;
  if (key === yesterdayKey()) return `Yesterday, ${shortDay(key)}`;
  return shortDay(key);
};
// Days shown at first, and added by each "Load more".
const DAYS_PER_PAGE = 3;
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

export function createHistoryScreen(root, { store, getPatient }) {
  let sheetUrl = null;

  const target = () => store.getProfile().targetNote;
  const off = (session) => takeOff(session, target());

  function progressCard(days) {
    const t = target();
    const progress = summariseProgress(days);
    const day = progress.today.day;
    const endOff = off(day.last);
    const section = el('section', 'progress-card');
    section.appendChild(el('span', 'muted', day.key === todayKey() ? 'Today ended' : `${shortDay(day.key)} ended`));
    const words = distanceWords(endOff, t);
    const headline = el('span', 'progress-headline', words);
    if (endOff !== null) headline.style.color = textColour(endOff);
    section.appendChild(headline);
    section.insertAdjacentHTML('beforeend', lineScaleSvg(endOff, { width: 420, label: words }));

    const card = el('dl', 'card progress-lines');
    const line = (label, text) => card.append(el('dt', '', label), el('dd', '', text));
    line(
      day.key === todayKey() ? 'Today' : shortDay(day.key),
      progress.today.single ? `one recording, ${sideWords(off(day.first))}` : `started ${sideWords(off(day.first))}, ended ${sideWords(endOff)}`
    );
    const compare = (cmp, isFirst) =>
      line(
        `vs ${shortDay(cmp.day.key)}`,
        `started ${closerWords(off(cmp.day.first), off(day.first))}, ended ${closerWords(off(cmp.day.last), endOff)}${isFirst ? ' (first session)' : ''}`
      );
    const notes = [];
    if (progress.previous) {
      compare(progress.previous, progress.previousIsFirst);
      if (progress.previous.differentCalibration) notes.push(DIFFERENT);
    }
    if (progress.first) {
      compare(progress.first, true);
      if (progress.first.differentCalibration && !notes.includes(DIFFERENT)) notes.push(DIFFERENT);
    }
    const foot = el('dd', 'progress-foot');
    foot.appendChild(el('i', '', `Distances in semitones from ${t}.`));
    card.append(el('dt'), foot);
    section.appendChild(card);
    notes.forEach((text) => section.appendChild(el('p', 'warn-note', text)));
    return section;
  }

  function openTake(rec) {
    const s = rec.session;
    const sheet = document.createElement('dialog');
    sheet.className = 'sheet';
    sheet.setAttribute('aria-label', rec.name);
    const takeOffValue = off(s);
    const words = distanceWords(takeOffValue, target());
    const grip = el('span', 'sheet-grip');
    grip.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'sheet-title', rec.name);
    const when = el('p', 'sheet-text', time(s.startedAtMs));
    const head = el('p', 'result-words', words);
    head.style.textAlign = 'center';
    if (takeOffValue !== null) head.style.color = textColour(takeOffValue);
    const name = el('label', 'field', 'Name');
    const input = el('input');
    input.maxLength = 40;
    input.value = String(s.customName ?? '').trim();
    input.placeholder = rec.autoName;
    name.appendChild(input);
    const audioBox = el('div', 'small muted');
    const values = el('dl', 'card values');
    takeValues(s).forEach(({ label, value }) => values.append(el('dt', '', label), el('dd', '', value)));
    const x = el('button', 'sheet-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    const del = el('button', 'text-danger', 'Delete recording');
    del.type = 'button';
    del.style.alignSelf = 'center';
    const close = el('button', 'ghost', 'Close');
    close.type = 'button';
    sheet.append(x, grip, title, when, head);
    sheet.insertAdjacentHTML('beforeend', lineScaleSvg(takeOffValue, { width: 420, label: words }));
    // Details first (audio, 7 values), then the name, then Delete and Close.
    sheet.append(audioBox, values, name, del, close);

    if (s.hasAudio) {
      audioBox.textContent = 'Loading audio…';
      getAudio(s.id)
        .then((blob) => {
          audioBox.textContent = '';
          if (!blob) {
            audioBox.textContent = 'Audio no longer on this device.';
            return;
          }
          sheetUrl = URL.createObjectURL(blob);
          const audio = el('audio');
          audio.controls = true;
          audio.preload = 'metadata';
          audio.src = sheetUrl;
          audioBox.appendChild(audio);
        })
        .catch(() => {
          audioBox.textContent = 'Audio could not be loaded.';
        });
    } else {
      audioBox.textContent = 'Recorded without audio.';
    }

    sheet.addEventListener('close', () => {
      if (sheetUrl) URL.revokeObjectURL(sheetUrl);
      sheetUrl = null;
      sheet.remove();
      if (renamed) render();
    });
    // The name saves as it is edited, and on every way of closing.
    let renamed = false;
    const saveName = () => {
      const custom = input.value.trim() || null;
      if (custom !== (String(s.customName ?? '').trim() || null)) {
        store.updateSession(s.id, { customName: custom });
        s.customName = custom;
        renamed = true;
      }
    };
    input.addEventListener('change', saveName);
    const finish = () => {
      saveName();
      sheet.close();
    };
    close.addEventListener('click', finish);
    x.addEventListener('click', finish);
    sheet.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    });
    del.addEventListener('click', () => {
      if (!window.confirm(`Delete “${rec.name}” (${time(s.startedAtMs)})? This cannot be undone.`)) return;
      store.deleteSessions([s.id]);
      deleteAudio([s.id]).catch(() => {});
      sheet.close();
      render();
    });
    document.body.appendChild(sheet);
    sheet.showModal();
  }

  function dayBlock(day, patient) {
    const block = el('section', 'day');
    const head = el('div', 'day-head');
    head.appendChild(el('h2', '', dayTitle(day.key)));
    if (day.recordings.length > 1) {
      // First take of the day against the last: "1 semitone (0.5 tones) closer · 3 dB louder"
      const parts = [closerPhrase(off(day.first), off(day.last)), louderPhrase(day.comparison?.volumeDb)].filter(Boolean);
      head.appendChild(el('span', 'muted day-change', parts.join(' · ')));
    }
    block.appendChild(head);

    const list = el('ul', 'card takes');
    day.recordings.forEach((rec) => {
      const s = rec.session;
      const o = off(s);
      const li = el('li', 'take');
      const open = el('button', 'take-open');
      open.type = 'button';
      open.append(el('span', 'take-name', rec.name), el('span', 'small muted', `${time(s.startedAtMs)} · ${s.meanHz ? hzToNote(s.meanHz) : '—'}`));
      open.addEventListener('click', () => openTake(rec));
      const details = el('button', 'icon-button');
      details.type = 'button';
      details.setAttribute('aria-label', `Show details of ${rec.name}`);
      details.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      details.addEventListener('click', () => openTake(rec));
      li.append(open, zoneLine(o, shortWords(o)), details);
      list.appendChild(li);
    });
    block.appendChild(list);

    const actions = el('div', 'day-actions');
    const share = el('button', 'ghost share-day', 'Share day');
    share.type = 'button';
    let prepared = null;
    // The first tap prepares the files and shares straight away; if iOS
    // refuses because the tap was spent waiting, the next tap shares at once.
    share.addEventListener('click', async () => {
      try {
        if (!prepared) {
          share.textContent = 'Preparing…';
          prepared = await filesForDay(day, patient);
        }
        share.textContent = 'Share day';
        await shareFiles(prepared, `FZero · ${shortDay(day.key)}`);
      } catch (error) {
        share.textContent = error?.name === 'NotAllowedError' ? 'Tap again to share' : 'Share day';
      }
    });
    actions.appendChild(share);
    block.appendChild(actions);
    if (day.calibrationChanged) block.appendChild(el('p', 'warn-note', CHANGED));
    return block;
  }

  let daysShown = DAYS_PER_PAGE;

  function render() {
    const days = groupDays(store.listSessions());
    const patient = getPatient();
    root.replaceChildren();
    if (days.length === 0) {
      const empty = el('div', 'empty');
      empty.append(el('strong', '', 'No recordings yet'), document.createTextNode('Recordings appear here, grouped by day.'));
      root.appendChild(empty);
      return;
    }
    const layout = el('div', 'history-layout');
    layout.appendChild(progressCard(days));
    const list = el('div', 'days');
    days.slice(0, daysShown).forEach((day) => list.appendChild(dayBlock(day, patient)));
    if (days.length > daysShown) {
      const more = el('button', 'load-more', 'Load more');
      more.type = 'button';
      more.addEventListener('click', () => {
        daysShown += DAYS_PER_PAGE;
        render();
      });
      list.appendChild(more);
    }
    layout.appendChild(list);
    root.appendChild(layout);
  }

  return { render };
}
