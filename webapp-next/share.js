// Hands recordings and results.txt to the iOS share sheet — "Save to Files"
// puts them in a folder, Mail attaches them. A website cannot write into a
// folder by itself; this is the one door iOS leaves open.
import { getAudio } from './audio-store.js';
import { audioExtension, visitFileNames, sessionFileNames } from './src/share-files.js';
import { buildVisitResultsText, buildSessionResultsText } from './src/results-text.js';

async function loadAudio(summary) {
  if (!summary?.hasAudio) return null;
  try {
    return await getAudio(summary.id);
  } catch {
    return null;
  }
}

const textFile = (text, name) => new File([text], name, { type: 'text/plain' });
const audioFile = (blob, name) => new File([blob], name, { type: blob.type || 'audio/mp4' });

export async function filesForVisit(visit, before, after, allVisits) {
  const [beforeBlob, afterBlob] = await Promise.all([loadAudio(before), loadAudio(after)]);
  const others = allVisits.filter((v) => v.id !== visit.id).map((v) => v.startedAtMs);
  const names = visitFileNames(visit.startedAtMs, others, {
    beforeExt: audioExtension(beforeBlob?.type),
    afterExt: audioExtension(afterBlob?.type),
  });

  const files = [];
  if (beforeBlob) files.push(audioFile(beforeBlob, names.before));
  if (afterBlob) files.push(audioFile(afterBlob, names.after));
  files.push(textFile(buildVisitResultsText(visit, before, after), names.results));

  return {
    files,
    blobs: { before: beforeBlob, after: afterBlob },
    missingAudio: Boolean((before?.hasAudio && !beforeBlob) || (after?.hasAudio && !afterBlob)),
  };
}

export async function filesForSession(session) {
  const blob = await loadAudio(session);
  const names = sessionFileNames(session.startedAtMs, audioExtension(blob?.type));
  const files = [];
  if (blob) files.push(audioFile(blob, names.audio));
  files.push(textFile(buildSessionResultsText(session), names.results));
  return { files, blob, missingAudio: Boolean(session.hasAudio && !blob) };
}

// Without file sharing (a desktop browser, mostly) each file downloads instead.
export async function shareFiles(files, title) {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }

  files.forEach((file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
  return 'downloaded';
}

// Both buttons open the same iOS sheet — Files, WhatsApp, Mail, AirDrop and
// any other app that takes files. Two labels so keeping a copy is obvious. The files are built BEFORE this is shown: iOS refuses to
// open the sheet if the tap is spent waiting on storage first.
export function createShareButtons({ files, title, onShared }) {
  const wrap = document.createElement('div');
  wrap.className = 'share-actions';
  const message = document.createElement('p');
  message.className = 'share-message';
  message.setAttribute('role', 'status');

  [
    ['Save to Files', 'save'],
    ['Share', 'share'],
  ].forEach(([label, kind]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wide-button';
    button.dataset.share = kind;
    button.textContent = label;
    button.addEventListener('click', async () => {
      message.textContent = '';
      try {
        const result = await shareFiles(files, title);
        if (result !== 'cancelled') onShared?.();
      } catch {
        message.textContent = 'iPhone did not open the share window. Tap the button again.';
      }
    });
    wrap.appendChild(button);
  });

  wrap.appendChild(message);
  return wrap;
}
