import { hzToNote, noteToHz } from '../src/note-hz.js';
import { summariseTrend, MIN_SESSIONS_FOR_TREND } from '../src/trend.js';
import { buildSessionsCsv } from '../src/session-csv.js';

function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms) {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  return `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`;
}

const percent = (share) => (share === null ? '—' : `${Math.round(share * 100)}%`);
const note = (hz) => (hz === null ? '—' : hzToNote(hz));
const hz = (value) => (value === null ? '—' : `${Math.round(value)} Hz`);

// "In range" means nothing without saying which range — and each session
// stores the one that was actually in force when it was measured.
const rangeLabel = (summary) =>
  summary.rangeLowNote && summary.rangeHighNote
    ? `range (${summary.rangeLowNote}–${summary.rangeHighNote})`
    : 'range';

const zoneHeading = (profile) =>
  profile.rangeLowNote && profile.rangeHighNote
    ? `Time in ${profile.rangeLowNote}–${profile.rangeHighNote}`
    : 'Time in range';

const PITCH_WORDS = {
  closer: ['Closer', 'good'],
  further: ['Further', 'away'],
  same: ['Holding', 'flat'],
};

const ZONE_WORDS = {
  up: ['More', 'good'],
  down: ['Less', 'away'],
  same: ['Holding', 'flat'],
};

function trendItem(label, [verdict, mood], detail) {
  return `
    <div class="trend-item">
      <span class="stat-label">${label}</span>
      <span class="trend-verdict" data-mood="${mood}">${verdict}</span>
      <span class="trend-detail">${detail}</span>
    </div>
  `;
}

function renderTrend(card, sessions, profile) {
  const targetNote = profile.targetNote || profile.fundamentalNote;
  if (!targetNote) {
    card.innerHTML =
      '<p class="trend-empty">Set your target note in Profile and this will start tracking which way your voice is moving.</p>';
    return;
  }

  const trend = summariseTrend(sessions, noteToHz(targetNote));

  if (trend.status === 'not-enough') {
    const needed = trend.sessionsNeeded;
    card.innerHTML = `<p class="trend-empty">
      ${trend.sessionsRecorded} of ${MIN_SESSIONS_FOR_TREND} sessions recorded.
      ${needed} more and this will compare your recent calls against the ones before them.
    </p>`;
    return;
  }

  const pitchDetail =
    trend.pitch.direction === 'same'
      ? `${hz(trend.pitch.recentHz)} · target ${targetNote}`
      : `${Math.abs(trend.pitch.closerBySemitones).toFixed(1)} semitones · now ${note(trend.pitch.recentHz)}`;

  const zoneDetail =
    trend.inZone.deltaPoints === null
      ? '—'
      : `${percent(trend.inZone.earlierShare)} → ${percent(trend.inZone.recentShare)}`;

  card.innerHTML = `
    <div class="trend-grid">
      ${trendItem('To your target', PITCH_WORDS[trend.pitch.direction], pitchDetail)}
      ${trendItem(zoneHeading(profile), ZONE_WORDS[trend.inZone.direction], zoneDetail)}
    </div>
    <p class="trend-note">
      Comparing your last ${trend.sessionsCompared} sessions with the ${trend.sessionsCompared} before them.
    </p>
  `;
}

function sessionCard(summary) {
  const button = document.createElement('button');
  button.className = 'session';
  button.type = 'button';
  button.innerHTML = `
    <div class="session-head">
      <span class="session-date">${formatDate(summary.startedAtMs)}</span>
      <span class="session-head-right">
        <span class="session-duration">${formatDuration(summary.durationMs)}</span>
        <span class="session-chevron" aria-hidden="true">›</span>
      </span>
    </div>
    <div class="session-figures">
      <span>Average <b>${note(summary.meanHz)}</b></span>
      <span>In ${rangeLabel(summary)} <b>${percent(summary.inZoneShare)}</b></span>
      <span>Spoke <b>${percent(summary.voicedShare)}</b></span>
    </div>
  `;

  // The full figures are the ones a speech therapist would want; they are one
  // tap down so the list stays readable.
  const detail = document.createElement('dl');
  detail.className = 'session-detail';
  detail.hidden = true;
  detail.innerHTML = `
    <dt>Average pitch</dt><dd>${note(summary.meanHz)} · ${hz(summary.meanHz)}</dd>
    <dt>Pitch spread</dt><dd>${summary.semitoneSd === null ? '—' : `${summary.semitoneSd.toFixed(1)} semitones`}</dd>
    <dt>Range (5–95%)</dt><dd>${note(summary.p5Hz)} – ${note(summary.p95Hz)}</dd>
    <dt>Time in ${rangeLabel(summary)}</dt><dd>${percent(summary.inZoneShare)}</dd>
    <dt>Time speaking</dt><dd>${formatDuration(summary.voicedMs)}</dd>
    <dt>Average volume</dt><dd>${summary.meanDb === null ? '—' : `${Math.round(summary.meanDb)} dB`}</dd>
    <dt>Loudest</dt><dd>${summary.maxDb === null ? '—' : `${Math.round(summary.maxDb)} dB`}</dd>
    <dt>Target then</dt><dd>${summary.targetNote ?? '—'}</dd>
  `;
  button.appendChild(detail);

  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    detail.hidden = !detail.hidden;
    button.setAttribute('aria-expanded', String(!detail.hidden));
  });

  return button;
}

export function createHistoryScreen(root, { store }) {
  const trendCard = root.querySelector('[data-el="trend-card"]');
  const listEl = root.querySelector('[data-el="session-list"]');
  const exportButton = root.querySelector('[data-action="export-sessions"]');

  exportButton.addEventListener('click', () => {
    const sessions = store.listSessions();
    if (sessions.length === 0) return;

    const csv = buildSessionsCsv(sessions, store.getProfile());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fzer0-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  return {
    render() {
      const sessions = store.listSessions();
      renderTrend(trendCard, sessions, store.getProfile());
      exportButton.disabled = sessions.length === 0;

      listEl.replaceChildren();
      if (sessions.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No sessions yet. Measure a call and it will show up here.';
        listEl.appendChild(empty);
        return;
      }

      // Newest first — the reverse of how they are stored.
      [...sessions].reverse().forEach((summary) => listEl.appendChild(sessionCard(summary)));
    },
  };
}
