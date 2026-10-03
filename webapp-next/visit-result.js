// "Visit complete": Before vs After, the change, and the two ways to keep it.
import { hzToNote } from './src/note-hz.js';
import { compareVisit, describeChange } from './src/visit.js';
import { filesForVisit, createShareButtons } from './share.js';

const pitch = (s) => (s?.meanHz ? `${hzToNote(s.meanHz)} · ${Math.round(s.meanHz)} Hz` : '—');
const percent = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

export async function showVisitResult(dialog, { store, visit, onShared }) {
  const sessions = store.listSessions();
  const before = sessions.find((s) => s.id === visit.beforeId) ?? null;
  const after = sessions.find((s) => s.id === visit.afterId) ?? null;

  dialog.querySelector('[data-el="visit-result-change"]').textContent =
    `Change: ${describeChange(compareVisit(before, after))}`;

  dialog.querySelector('[data-el="visit-result-figures"]').innerHTML = `
    <span></span><span class="head">Before</span><span class="head">After</span>
    <span>Average</span><b>${pitch(before)}</b><b>${pitch(after)}</b>
    <span>In range</span><b>${percent(before?.inZoneShare)}</b><b>${percent(after?.inZoneShare)}</b>
  `;

  const actions = dialog.querySelector('[data-el="visit-result-actions"]');
  actions.textContent = 'Preparing files…';
  dialog.showModal();

  const { files } = await filesForVisit(visit, before, after, store.listVisits());
  actions.replaceChildren(
    createShareButtons({
      files,
      title: 'FZER0 therapy visit',
      onShared: () => {
        const latest = store.listVisits().find((v) => v.id === visit.id);
        if (latest) store.saveVisit({ ...latest, shared: true });
        onShared?.();
      },
    })
  );
}
