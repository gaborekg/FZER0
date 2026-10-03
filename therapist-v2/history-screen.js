// History for one patient: Progress at the top, then one grouped section per
// day. The day names its own recordings; a recording opens in a sheet with
// its figures, player, name field and Delete.
import { groupDays, describeSemitones, describeDb } from './src/day-groups.js';
import { summariseProgress } from './src/progress.js';
import { hzToNote, noteToHz } from './src/note-hz.js';
import { buildSessionsCsv } from './src/session-csv.js';
import { getAudio, deleteAudio } from './app/audio-store.js';
import { shareFiles } from './app/share.js';
import { filesForDay } from './day-share.js';

const CHEVRON = '<svg class="chevron" viewBox="0 0 8 13" aria-hidden="true"><path d="M1.5 1.5l5 5-5 5" /></svg>';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DIFFERENT = 'Different calibration — compare volume with care.';
const CHANGED = 'Calibration changed during this day — compare volume with care.';

const dayLabel = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const shortDay = (key) => {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const note = (hz) => (hz ? hzToNote(hz) : '—');
// Colour says whether the voice moved towards this patient's own target —
// green closer, orange further — never that lower or higher is better.
const distance = (hz, targetHz) => Math.abs(12 * Math.log2(hz / targetHz));
function tone(fromHz, toHz, targetHz) {
  if (!fromHz || !toHz || !targetHz) return '';
  const closer = distance(fromHz, targetHz) - distance(toHz, targetHz);
  if (closer > 0.05) return 'good';
  if (closer < -0.05) return 'warn';
  return '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(title, detail, detailClass) {
  const li = el('li');
  const cell = el('div', 'cell');
  cell.append(el('span', 'cell-title', title), el('span', `cell-detail ${detailClass ?? ''}`.trim(), detail));
  li.appendChild(cell);
  return li;
}

export function createHistoryScreen(root, { store, getPatient }) {
  const sheet = document.querySelector('[data-el="recording-sheet"]');
  let sheetUrl = null;

  function closeSheet() {
    sheet.close();
  }
  sheet.addEventListener('close', () => {
    if (sheetUrl) URL.revokeObjectURL(sheetUrl);
    sheetUrl = null;
    sheet.replaceChildren();
  });

  function progressGroup(progress, targetHz) {
    const group = el('section', 'group');
    group.appendChild(el('div', 'list-header', 'Progress'));
    const list = el('ul', 'list');
    const today = progress.today;
    list.appendChild(
      row(
        `Today · ${shortDay(today.day.key)}`,
        today.single
          ? `${note(today.day.first.meanHz)} · only one recording`
          : `${note(today.day.first.meanHz)} → ${note(today.day.last.meanHz)}  ${describeSemitones(today.semitones)}`,
        tone(today.day.first.meanHz, today.day.last.meanHz, targetHz)
      )
    );
    const compareRows = (label, cmp) => {
      const t = progress.today.day;
      list.appendChild(row(`${label} · start`, describeSemitones(cmp.startSemitones), tone(cmp.day.first.meanHz, t.first.meanHz, targetHz)));
      list.appendChild(row(`${label} · end`, describeSemitones(cmp.endSemitones), tone(cmp.day.last.meanHz, t.last.meanHz, targetHz)));
    };
    const notes = [];
    if (progress.previous) {
      compareRows(`vs ${shortDay(progress.previous.day.key)}${progress.previousIsFirst ? ' (first day)' : ''}`, progress.previous);
      if (progress.previous.differentCalibration) notes.push(DIFFERENT);
    }
    if (progress.first) {
      compareRows(`vs ${shortDay(progress.first.day.key)} (first day)`, progress.first);
      if (progress.first.differentCalibration && !notes.includes(DIFFERENT)) notes.push(DIFFERENT);
    }
    group.appendChild(list);
    group.appendChild(
      el(
        'p',
        `list-footer${notes.length ? ' warn' : ''}`,
        notes.join(' ') || 'Average pitch, in semitones. Green: closer to the target. Orange: further away.'
      )
    );
    return group;
  }

  function openRecording(rec) {
    const s = rec.session;
    sheet.replaceChildren();
    const bar = el('div', 'sheet-bar');
    const cancel = el('button', 'nav-button', 'Cancel');
    cancel.type = 'button';
    const title = el('span', 'sheet-title', time(s.startedAtMs));
    const done = el('button', 'nav-button strong', 'Done');
    done.type = 'button';
    bar.append(cancel, title, done);

    const nameGroup = el('section', 'group');
    nameGroup.appendChild(el('div', 'list-header', 'Name'));
    const nameList = el('ul', 'list');
    const nameLi = el('li');
    const label = el('label', 'cell field');
    const input = el('input');
    input.maxLength = 40;
    input.value = String(s.customName ?? '').trim();
    input.placeholder = rec.autoName;
    input.setAttribute('aria-label', 'Recording name');
    label.appendChild(input);
    nameLi.appendChild(label);
    nameList.appendChild(nameLi);
    nameGroup.append(nameList, el('p', 'list-footer', `Leave empty to use “${rec.autoName}”, which follows the order of the day.`));

    const figures = el('section', 'group');
    figures.appendChild(el('div', 'list-header', 'Figures'));
    const fl = el('ul', 'list');
    fl.append(
      row('Average Pitch', s.meanHz ? `${note(s.meanHz)} · ${Math.round(s.meanHz)} Hz` : '—'),
      row('Time in Range', s.inZoneShare === null || s.inZoneShare === undefined ? '—' : `${Math.round(s.inZoneShare * 100)}%`),
      row('Pitch Spread', s.semitoneSd === null || s.semitoneSd === undefined ? '—' : `${s.semitoneSd.toFixed(1)} st`),
      row('Average Volume', s.meanDb === null || s.meanDb === undefined ? '—' : `${Math.round(s.meanDb)} dB`),
      row('Duration', `${Math.floor(Math.round(s.durationMs / 1000) / 60)}:${String(Math.round(s.durationMs / 1000) % 60).padStart(2, '0')}`)
    );
    figures.appendChild(fl);

    const audioGroup = el('section', 'group');
    const audioBox = el('div', 'list');
    audioBox.style.padding = '12px 16px';
    audioGroup.appendChild(audioBox);
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

    const del = el('section', 'group');
    const dl = el('ul', 'list');
    const delLi = el('li');
    const delButton = el('button', 'cell cell-destructive');
    delButton.type = 'button';
    delButton.appendChild(el('span', 'cell-title', 'Delete Recording'));
    delLi.appendChild(delButton);
    dl.appendChild(delLi);
    del.appendChild(dl);

    sheet.append(bar, nameGroup, audioGroup, figures, del);

    cancel.addEventListener('click', closeSheet);
    done.addEventListener('click', () => {
      const custom = input.value.trim();
      store.updateSession(s.id, { customName: custom || null });
      closeSheet();
      render();
    });
    delButton.addEventListener('click', () => {
      if (!window.confirm(`Delete “${rec.name}” (${time(s.startedAtMs)})? This cannot be undone.`)) return;
      store.deleteSessions([s.id]);
      deleteAudio([s.id]).catch(() => {});
      closeSheet();
      render();
    });

    sheet.showModal();
  }

  function dayGroup(day, patient) {
    const group = el('section', 'group');
    const header = el('div', 'list-header');
    header.append(el('span', '', dayLabel(day.key)));
    if (day.comparison) {
      header.append(el('span', 'detail', `${describeSemitones(day.comparison.pitchSemitones)} · ${describeDb(day.comparison.volumeDb)}`));
    }
    group.appendChild(header);

    const list = el('ul', 'list');
    day.recordings.forEach((rec) => {
      const li = el('li');
      const button = el('button', 'cell');
      button.type = 'button';
      const titleEl = el('span', 'cell-title', rec.name);
      titleEl.appendChild(el('small', '', time(rec.session.startedAtMs)));
      button.append(titleEl, el('span', 'cell-detail', note(rec.session.meanHz)));
      button.insertAdjacentHTML('beforeend', CHEVRON);
      button.addEventListener('click', () => openRecording(rec));
      li.appendChild(button);
      list.appendChild(li);
    });

    // Share day: the first tap prepares the files and shares straight away;
    // if iOS refuses because the tap was spent waiting, the files are kept
    // and the next tap shares immediately.
    const shareLi = el('li');
    const shareButton = el('button', 'cell cell-action');
    shareButton.type = 'button';
    const shareLabel = el('span', 'cell-title', 'Share Day');
    shareButton.appendChild(shareLabel);
    let prepared = null;
    shareButton.addEventListener('click', async () => {
      try {
        if (!prepared) {
          shareLabel.textContent = 'Preparing…';
          prepared = await filesForDay(day, patient);
        }
        shareLabel.textContent = 'Share Day';
        await shareFiles(prepared, `FZER0 · ${dayLabel(day.key)}`);
      } catch (error) {
        shareLabel.textContent = error?.name === 'NotAllowedError' ? 'Tap Again to Share' : 'Share Day';
      }
    });
    shareLi.appendChild(shareButton);
    list.appendChild(shareLi);
    group.appendChild(list);

    if (day.calibrationChanged) group.appendChild(el('p', 'list-footer warn', CHANGED));
    return group;
  }

  function render() {
    const sessions = store.listSessions();
    const days = groupDays(sessions);
    const patient = getPatient();
    root.replaceChildren();

    if (days.length === 0) {
      const empty = el('div', 'empty-state');
      empty.append(el('strong', '', 'No Recordings'), document.createTextNode('Recordings appear here, grouped by day.'));
      root.appendChild(empty);
      return;
    }

    const targetNote = store.getProfile().targetNote;
    root.appendChild(progressGroup(summariseProgress(days), targetNote ? noteToHz(targetNote) : null));
    days.forEach((day) => root.appendChild(dayGroup(day, patient)));

    const exportGroup = el('section', 'group');
    const el2 = el('ul', 'list');
    const li = el('li');
    const csv = el('button', 'cell cell-action');
    csv.type = 'button';
    csv.appendChild(el('span', 'cell-title', 'Export All as CSV'));
    csv.addEventListener('click', () => {
      const text = buildSessionsCsv(store.listSessions(), store.getProfile());
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `fzer0-${(patient.fileName || 'patient').replace(/\s+/g, '-')}-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
    li.appendChild(csv);
    el2.appendChild(li);
    exportGroup.appendChild(el2);
    root.appendChild(exportGroup);
  }

  return { render };
}
