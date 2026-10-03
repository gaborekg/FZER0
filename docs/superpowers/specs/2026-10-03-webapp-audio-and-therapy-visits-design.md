# FZER0 web app — audio recordings and therapy visits

Web app only (`webapp/`). The Google Meet extension is out of scope and must
keep working unchanged.

## Purpose

In speech therapy, the voice is measured before the session and again after
it, to see whether the exercises lowered the pitch. Today the measuring
happens in FZER0 and the audio is recorded in a separate app. This feature
brings both into FZER0:

- FZER0 records the audio itself, from the same microphone it measures with.
- A **therapy visit** pairs a Before and an After measurement and shows the
  change between them.
- Recordings and results are saved as ordinary files in a folder on the
  iPhone/iPad, and can be emailed to the therapist.

This reverses a v1 principle ("nothing is recorded") for the web app only.
It is still local: no server, no account, no network calls, no paid service.

## Target devices

iPhone and iPad, Safari (in the browser or added to the Home Screen).

## Decisions

| Question | Decision |
|---|---|
| Who records the audio | FZER0 itself |
| Before/After | Paired into a therapy visit, with a computed comparison |
| When audio is recorded | Visits: always. Normal sessions: optional switch |
| Recording length | No limit — runs until the user taps Stop |
| Format sent/saved | Separate files, no Zip |
| Where the permanent copy lives | A folder the user picks in the Files app, via the iOS share sheet |

### Why separate files, not a Zip

A Zip has to be unpacked before anything can be played, which is awkward on
a phone, for the user and for the therapist. The iOS share sheet accepts
several files at once: "Save to Files" puts them all in the chosen folder,
and Mail attaches them all to one email. File names start with the date, so
a folder with many visits stays sorted.

### Why the share sheet, not automatic saving

A website cannot write into a phone folder by itself; iOS blocks it. Saving
without a tap would need a native app, which on iOS needs a paid Apple
developer account. The share sheet costs one or two taps and produces real
files that iOS never clears.

## Screens

### Measure

```
[x] Also record audio        ← switch, remembered between uses
[ Start measuring ]          ← normal session, as today
[ Start therapy visit ]      ← new
```

The "Also record audio" switch applies to normal sessions only. Visit
recordings always include audio.

### Therapy visit flow

1. **Before** — Start … Stop. Measurement and audio are saved.
2. Waiting state: "Do your session. Come back after." Shows a Cancel visit
   button.
3. **After** — Start … Stop. Measurement and audio are saved.
4. **Result** — Before vs After figures, the change in semitones, and two
   buttons: **Save to Files** and **Send by email**.

An open visit survives closing the app. On reopening, Measure shows
"Visit in progress — record After" and continues at step 3.

### History

Visits and normal sessions appear in one list, newest first.

```
┌─ Therapy visit · 3 Oct ──────┐
│ Before  A2 110 Hz  ▶ 0:45    │
│ After   G2  98 Hz  ▶ 0:50    │
│ Change  ↓ 2 semitones        │
│ [ Save to Files ] [ Email ]  │
└──────────────────────────────┘
┌─ Session · 2 Oct 18:10 ──────┐
│ Average G2 · 71%   ▶ 12:03   │  ← ▶ and buttons only if it has audio
│ [ Save to Files ] [ Email ]  │
└──────────────────────────────┘
```

- **▶** plays the recording inside the app.
- An item with audio that has never been saved or sent shows a
  **"Not saved yet"** label.
- The visit's figures are part of the progress trend the same way normal
  sessions are (each of Before and After counts as a session).
- The existing "Export for your therapist (CSV)" button stays as it is.

## Files produced

All files in one share go out together. Names for a visit:

```
2026-10-03 visit - before.m4a
2026-10-03 visit - after.m4a
2026-10-03 visit - results.txt
```

For a normal session with audio:

```
2026-10-02 18-10 session.m4a
2026-10-02 18-10 session - results.txt
```

If two visits happen on the same day, the time is added to the name
(`2026-10-03 14-30 visit - before.m4a`) so files never overwrite each other.

The audio format is whatever Safari's recorder produces (`audio/mp4`, saved
as `.m4a`), which plays natively on iPhone, iPad, Mac and Windows.

### results.txt

Plain text, readable on any device without an app:

```
FZER0 · Therapy visit · 3 Oct 2026

            Before        After
Average     A2 (110 Hz)   G2 (98 Hz)
In range    71%           84%
Spread      2.1 st        1.6 st
Volume      58 dB         61 dB
Duration    0:45          0:50

Change: 2 semitones lower
Target: G2 · Range: F2–A2
```

A normal session's results.txt has a single column with the same rows.

## Storage

```
Inside FZER0 (browser storage)
  Numbers  → localStorage, as today
  Audio    → IndexedDB (large browser storage)
  Used for: playback, sharing, holding Before until After exists
                 │  Save to Files
                 ▼
Files › (folder the user picks)
  the permanent copy
```

- **The Files copy is the safe one.** The app's own copy is for
  convenience; Safari may clear website data after 7 days without use.
  Adding FZER0 to the Home Screen exempts it from that rule. The app
  suggests this once, in plain words, the first time audio is recorded.
- Audio is roughly 0.5–1 MB per minute. Storage is not a practical limit.
- Each session gets a stable `id`, which is the key linking it to its audio.
  Sessions saved before this feature have no audio and no id; they keep
  working unchanged.
- A visit is stored as a record holding its two session ids, its state
  (`waiting-for-after` / `complete`), and whether it has been saved or sent.
- When the 200-session cap drops old sessions, their audio is deleted too.
- "Delete all sessions" in Profile also deletes all audio and visits, and its
  warning says so.

## When something goes wrong

| Situation | Behaviour |
|---|---|
| Microphone blocked | The existing help explains how to unblock it in Safari. |
| App closed between Before and After | Before is kept; on reopen the visit continues at After. |
| App closed during a recording | That recording is lost (browser limit). On reopen: "The last recording was interrupted" with **Record again**. The rest of the visit is kept. |
| Cancel visit | Asks for confirmation, then deletes the visit and its audio. |
| Storage full | Numbers are still saved. Message: "Audio couldn't be saved — phone storage is full." |
| Share sheet cancelled | Nothing changes; "Not saved yet" stays. |
| App's audio copy cleared by iOS | ▶ and Save/Email are hidden for that item, which shows "Audio no longer in the app — check your Files folder." The numbers and results.txt remain. |
| Recorder not supported by the browser | The audio switch and visit button explain that this browser cannot record; normal measuring still works. |

## Code layout

Following the existing split: logic without the browser goes in `src/` and
is tested in Node; browser-touching code goes in `webapp/`.

New in `src/` (tested):

- `visit.js` — the visit states and transitions (start, Before done, After
  done, cancel, interrupted), and the Before/After comparison.
- `share-files.js` — file names for a visit or session, including the
  same-day rule.
- `results-text.js` — builds results.txt from one or two session summaries.

New in `webapp/`:

- `audio-store.js` — IndexedDB: save, read, delete, list audio by session id.
- `audio-recorder.js` — wraps Safari's recorder around the stream the
  measurement already opened, so there is one microphone, not two.
- `share.js` — hands files to the iOS share sheet; on browsers without file
  sharing it downloads them instead.

Changed: `measure.js` (switch, visit flow), `history.js` (visit cards,
playback, share buttons, "Not saved yet"), `profile.js` (delete warning),
`index.html`, `app.css`, `src/app-store.js` (session ids, visits, cap
deletes audio). `webapp/audio.js` exposes its stream to the recorder.

## Testing

- Automatic (`npm test`): visit states, comparison, file names,
  results.txt, store changes (ids, visits, cap). Existing tests keep passing.
- On a real iPhone and iPad, by checklist: record with switch on/off, a full
  visit, closing the app mid-visit, playback, Save to Files into a folder,
  Send by email, Cancel visit, Delete all sessions.

## Out of scope

- The Google Meet extension.
- Attaching recordings from other apps.
- Zip packaging.
- Automatic saving to a folder without a tap.
- Editing or trimming recordings.
