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
import { takeValues, takeOff, closerWords, closerPhrase, louderPhrase, hasRealDb } from './take-stats.js';
import { t, shortDate, clockTime, recordingName } from './i18n.js';

const shortDay = shortDate;
const time = clockTime;
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayKey = () => keyOf(new Date());
const yesterdayKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return keyOf(d);
};
// "Today, 10 Oct" / "Yesterday, 9 Oct" / "3 Oct"
const dayTitle = (key) => {
  if (key === todayKey()) return t('h.todayTitle', { d: shortDay(key) });
  if (key === yesterdayKey()) return t('h.yesterdayTitle', { d: shortDay(key) });
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
    const note = target();
    const progress = summariseProgress(days);
    const day = progress.today.day;
    const endOff = off(day.last);
    const section = el('section', 'progress-card');
    section.appendChild(el('span', 'muted', day.key === todayKey() ? t('h.todayEnded') : t('h.dayEnded', { d: shortDay(day.key) })));
    const words = distanceWords(endOff, note);
    const headline = el('span', 'progress-headline', words);
    if (endOff !== null) headline.style.color = textColour(endOff);
    section.appendChild(headline);
    section.insertAdjacentHTML('beforeend', lineScaleSvg(endOff, { width: 420, label: words }));

    const card = el('dl', 'card progress-lines');
    const line = (label, text) => card.append(el('dt', '', label), el('dd', '', text));
    line(
      day.key === todayKey() ? t('h.today') : shortDay(day.key),
      progress.today.single
        ? t('h.oneRec', { s: sideWords(off(day.first)) })
        : t('h.startedEnded', { a: sideWords(off(day.first)), b: sideWords(endOff) })
    );
    const compare = (cmp, isFirst) =>
      line(
        t('h.vs', { d: shortDay(cmp.day.key) }),
        t('h.startedEnded', { a: closerWords(off(cmp.day.first), off(day.first)), b: closerWords(off(cmp.day.last), endOff) }) +
          (isFirst ? t('h.firstSession') : '')
      );
    const notes = [];
    if (progress.previous) {
      compare(progress.previous, progress.previousIsFirst);
      if (progress.previous.differentCalibration) notes.push(t('h.different'));
    }
    if (progress.first) {
      compare(progress.first, true);
      if (progress.first.differentCalibration && !notes.includes(t('h.different'))) notes.push(t('h.different'));
    }
    const foot = el('dd', 'progress-foot');
    foot.appendChild(el('i', '', t('h.distNote', { t: note })));
    card.append(el('dt'), foot);
    section.appendChild(card);
    notes.forEach((text) => section.appendChild(el('p', 'warn-note', text)));
    return section;
  }

  function openTake(rec) {
    const s = rec.session;
    const recName = recordingName(rec);
    const sheet = document.createElement('dialog');
    sheet.className = 'sheet';
    sheet.setAttribute('aria-label', recName);
    const takeOffValue = off(s);
    const words = distanceWords(takeOffValue, target());
    const grip = el('span', 'sheet-grip');
    grip.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'sheet-title', recName);
    const when = el('p', 'sheet-text', time(s.startedAtMs));
    const head = el('p', 'result-words', words);
    head.style.textAlign = 'center';
    if (takeOffValue !== null) head.style.color = textColour(takeOffValue);
    const name = el('label', 'field', t('h.name'));
    const input = el('input');
    input.maxLength = 40;
    input.value = String(s.customName ?? '').trim();
    input.placeholder = recordingName({ ...rec, session: { ...s, customName: null } });
    name.appendChild(input);
    const audioBox = el('div', 'small muted');
    const values = el('dl', 'card values');
    takeValues(s).forEach(({ label, value }) => values.append(el('dt', '', label), el('dd', '', value)));
    const x = el('button', 'sheet-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', t('common.close'));
    const del = el('button', 'text-danger', t('h.delete'));
    del.type = 'button';
    del.style.alignSelf = 'center';
    const close = el('button', 'ghost', t('common.close'));
    close.type = 'button';
    sheet.append(x, grip, title, when, head);
    sheet.insertAdjacentHTML('beforeend', lineScaleSvg(takeOffValue, { width: 420, label: words }));
    // Details first (audio, 7 values), then the name, then Delete and Close.
    sheet.append(audioBox, values, name, del, close);

    if (s.hasAudio) {
      audioBox.textContent = t('h.loadingAudio');
      getAudio(s.id)
        .then((blob) => {
          audioBox.textContent = '';
          if (!blob) {
            audioBox.textContent = t('h.audioGone');
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
          audioBox.textContent = t('h.audioError');
        });
    } else {
      audioBox.textContent = t('h.noAudio');
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
      if (!window.confirm(t('h.confirmDelete', { name: recName, time: time(s.startedAtMs) }))) return;
      store.deleteSessions([s.id]);
      deleteAudio([s.id]).catch(() => {});
      sheet.close();
      render();
    });
    document.body.appendChild(sheet);
    sheet.showModal();
  }

  // Health data: say how to share safely before the share sheet opens.
  function warnBeforeSharing(name, onContinue) {
    const sheet = document.createElement('dialog');
    sheet.className = 'sheet';
    sheet.setAttribute('aria-labelledby', 'share-title');
    const grip = el('span', 'sheet-grip');
    grip.setAttribute('aria-hidden', 'true');
    const title = el('h2', 'sheet-title', t('share.title', { name }));
    title.id = 'share-title';
    const actions = el('div', 'sheet-actions');
    const cancel = el('button', 'ghost', t('common.cancel'));
    cancel.type = 'button';
    const go = el('button', 'cream', t('common.continue'));
    go.type = 'button';
    actions.append(cancel, go);
    sheet.append(grip, title, el('p', 'sheet-text', t('share.text')), actions);
    sheet.addEventListener('close', () => sheet.remove());
    cancel.addEventListener('click', () => sheet.close());
    go.addEventListener('click', () => {
      sheet.close();
      onContinue();
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
      const realDb = hasRealDb(day.first) && hasRealDb(day.last);
      const parts = [closerPhrase(off(day.first), off(day.last)), realDb ? louderPhrase(day.comparison?.volumeDb) : ''].filter(Boolean);
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
      open.append(el('span', 'take-name', recordingName(rec)), el('span', 'small muted', `${time(s.startedAtMs)} · ${s.meanHz ? hzToNote(s.meanHz) : '—'}`));
      open.addEventListener('click', () => openTake(rec));
      const details = el('button', 'icon-button');
      details.type = 'button';
      details.setAttribute('aria-label', t('h.details', { name: recordingName(rec) }));
      details.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      details.addEventListener('click', () => openTake(rec));
      li.append(open, zoneLine(o, shortWords(o)), details);
      list.appendChild(li);
    });
    block.appendChild(list);

    const actions = el('div', 'day-actions');
    const share = el('button', 'ghost share-day', t('h.share'));
    share.type = 'button';
    let prepared = null;
    // Runs from the Continue tap of the warning, so iOS still counts it as a
    // tap. The first run prepares the files and shares straight away; if iOS
    // refuses because the tap was spent waiting, the next tap shares at once.
    const doShare = async () => {
      try {
        if (!prepared) {
          share.textContent = t('h.preparing');
          prepared = await filesForDay(day, patient);
        }
        share.textContent = t('h.share');
        await shareFiles(prepared, `FZero · ${shortDay(day.key)}`);
      } catch (error) {
        share.textContent = error?.name === 'NotAllowedError' ? t('h.tapAgain') : t('h.share');
      }
    };
    share.addEventListener('click', () => warnBeforeSharing(patient.displayName, doShare));
    actions.appendChild(share);
    block.appendChild(actions);
    if (day.calibrationChanged) block.appendChild(el('p', 'warn-note', t('h.changed')));
    return block;
  }

  let daysShown = DAYS_PER_PAGE;

  function render() {
    const days = groupDays(store.listSessions());
    const patient = getPatient();
    root.replaceChildren();
    if (days.length === 0) {
      const empty = el('div', 'empty');
      empty.append(el('strong', '', t('h.empty')), document.createTextNode(t('h.emptyHint')));
      root.appendChild(empty);
      return;
    }
    const layout = el('div', 'history-layout');
    layout.appendChild(progressCard(days));
    const list = el('div', 'days');
    days.slice(0, daysShown).forEach((day) => list.appendChild(dayBlock(day, patient)));
    if (days.length > daysShown) {
      const more = el('button', 'load-more', t('h.loadMore'));
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
