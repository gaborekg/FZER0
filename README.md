# FZER0

A Chrome extension that shows you how loudly you are speaking and which note
your voice is sitting on, while you are on a Google Meet call.

Everything is measured inside the page. Nothing is recorded, nothing is stored
outside your own browser, and there are no network calls anywhere in the code.
The only permission requested is `storage`.

Formerly called FNDMNTL — see [docs/README.md](docs/README.md).

## Layout

| Path                  | What lives there                                              |
| --------------------- | ------------------------------------------------------------- |
| `src/`                | Pure logic, no DOM and no `chrome.*`. Everything here is tested. |
| `extension/`          | The parts that touch a browser: service worker, content script, onboarding page, in-call panel, audio worklet. |
| `tests/`              | `node --test`, no framework, no build step.                    |
| `mock/meet.html`      | An offline stand-in for a Meet call — the panel, driven by a fake voice. |
| `docs/`               | The original design spec and build plans.                      |

The split is deliberate: `src/` can be tested in Node because it knows nothing
about the browser, and `extension/panel/panel.js` mounts into any element, which
is what lets `mock/meet.html` run the whole interface with no extension
installed.

## Running it

```sh
npm test                      # 99 tests
python3 -m http.server 8123   # then open http://localhost:8123/mock/meet.html
```

The mock page needs a server — the panel is an ES module, and module imports are
blocked over `file://`.

To load the real thing: `chrome://extensions` → Developer mode → Load unpacked →
choose this folder.

## How it measures

**Pitch** — autocorrelation over 2048-sample frames, in an audio worklet so it
runs off the main thread. Two details matter. The search band (50–500 Hz) is
deliberately wider than the band that gets accepted (65–400 Hz), so a genuine
tone near the edge shows up as a real interior peak rather than pinning at the
edge of the window where noise also pins. And the fundamental is taken as the
*shortest* lag whose correlation is within 90% of the best peak — normalised
correlation is near-identical at 2× and 3× the true period, so without that rule
the estimate lands an octave low.

**Volume** — RMS per frame, placed between a rolling noise floor (10th
percentile of the last 20 seconds) and a ceiling measured from the user's own
voice. There is no absolute sound-pressure reading available to a browser, so
every dB figure on the dial is relative to those two anchors.

**Calibration** is what makes the volume numbers mean anything. Five seconds of
normal speech gives a median (the comfortable speaking level, which becomes the
Target on the dial and sets how loud the reference tone plays) and a ceiling just
above normal speech (where the needle tops out). Without it the panel falls back
to constants that are a guess about somebody else's microphone, distance and
room. It is offered during onboarding, repeatable from the `⋯` button, and
persists across calls under its own storage keys so that editing your note range
can never overwrite it.

## The panel

Three views, one at a time:

- **Full** — Volume (Current / Average / Target + the dial) and Frequency
  (Current / Average / In zone + a bar per note from E2 to A3).
- **Minimized** — a thin ribbon: current volume with the dial, current note with
  its averages.
- **Details** (`⋯`) — note range, target note, and calibration.

Drag the panel anywhere. Click any bar to hear that note.

The bars decay: each note's weight halves every 10 seconds, and the whole chart
is scaled by how much of the recent window had voice in it. Decaying the bars
alone would not work — every weight shrinks by the same factor, so their heights
relative to each other would never change and the chart would look identical
during silence.

## Deliberate limits

- **Google Meet only**, desktop Chrome/Edge.
- **The dial is not calibrated SPL.** It cannot be; browsers expose no
  sound-pressure reading. The scale runs from your noise floor to your ceiling.
- **Not a medical device.** Onboarding refuses to guess a fundamental tone and
  points at a speech pathologist instead.
- Pitches outside E2–A3 are still detected and still named — they just have no
  bar on the chart.
