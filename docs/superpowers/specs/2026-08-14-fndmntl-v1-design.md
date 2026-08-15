# FNDMNTL — v1 design

## Purpose

FNDMNTL is a Chrome extension that measures the fundamental frequency and
volume of the user's own voice during Google Meet calls, and shows where it
sits relative to a target the user supplies themselves. It is an instrument,
not a coach: it reports a position, never a judgment, and never invents or
suggests a target — the user's speech pathologist does that, outside the
tool.

Nothing is recorded and nothing is transmitted. Audio is analyzed in memory
and discarded. Only the user's setup (their range and target note) persists
locally; everything about a live call — readings, history, session summary —
is gone the moment the call ends.

This is a new, independent build. It is not a fork or continuation of any
other project, though it draws on the same well-established math (pitch
autocorrelation, self-calibrating noise floor) as a proven *approach*, not as
reused code.

## Scope for v1

- **Adult male voices only**, expressed as two separate bands with two
  separate jobs (see "Detector reliability" for why these must not be the
  same band):
  - **Selectable range band: F2 (87.31 Hz) to C3 (130.81 Hz).** This is
    what the range picker offers, what the shaded "your range" band on the
    gauge represents, and it is explicitly labeled in the UI as a male
    voice range (a stated MVP scope, not silently hidden).
  - **Detection band: 65–400 Hz.** The detector measures and reports any
    pitch in this wider band, including well above the user's chosen
    ceiling — that's how screaming (the exact failure this product exists
    to catch) gets shown as "Too high" instead of silently discarded.
    Only readings outside 65–400 Hz are rejected as "out of range"
    (implausible: noise, octave errors, non-speech).
- **Google Meet only**, via Chrome extension. No standalone web app, no
  other call platforms.
- **One estimator implementation**, running in an AudioWorklet on the audio
  thread — no separate batch/web-page estimator, since there is no
  companion web page.

## Onboarding flow

```
Install extension
  → Disclaimer screen: "This plugin needs the microphone. We don't record
     or keep anything." [Accept] [Decline]
       Decline → screen explains the extension cannot function without
                  mic access, and that removing it means uninstalling from
                  chrome://extensions (an extension cannot uninstall itself)
       Accept  → Instructions screen: "Headphones mandatory. Measures volume."
                  → "Do you know your fundamental tone?"
                       No  → Disclaimer: "This is not a medical device — ask
                              your speech pathologist to find your
                              fundamental tone first." Hard stop: no
                              fallback, no estimate, no guess.
                       Yes → Setup screen: range picker (low/high note,
                              bounded to F2–C3) + target note within that
                              range → saved to chrome.storage.local
  → Ready. Joining any Meet call triggers the panel automatically.
```

Setup is reachable again later from the in-call panel's `⋯` details view,
so changing range/target doesn't require reinstalling.

## Architecture

- **Manifest V3 extension**, with a single content script targeting
  `meet.google.com`, running in the default **ISOLATED world**. Confirmed
  by live testing on a real, in-progress Meet call (2026-08-14): calling
  `getUserMedia` from an ISOLATED-world content script silently reuses the
  microphone permission the user already granted to Meet — no second
  browser permission prompt, and no separate MAIN-world script or
  postMessage bridge is needed. One script gets direct access to both
  `chrome.storage`/`chrome.runtime` (for prefs and messaging) and
  `getUserMedia` (for capture), which is a meaningful simplification over
  the two-world split considered earlier.
- **One AudioWorklet-based F0 + volume estimator**, running on the audio
  thread. No second, separate estimator implementation is needed since
  there's no companion web tool.
- **Shadow DOM overlay panel**, injected into the Meet page, fully
  self-scoped so it inherits no styles from Meet and Meet's own layout
  cannot bleed into it.
- **Settings storage**: `chrome.storage.local` holds only the user's range
  and target note. No session voice data is ever written to any storage —
  it lives in memory for the duration of the call and is discarded when the
  call ends.
- **Reference tone playback**: generated in-browser (Web Audio oscillator),
  routed to the output device only — never mixed into the microphone stream
  Meet transmits. Because echo cancellation is deliberately **off** on the
  analysis stream (needed for accurate pitch measurement), the tone would
  otherwise corrupt the user's *own* reading, not leak to other call
  participants — that's why pitch analysis pauses while the tone plays and
  resumes shortly after (a short fixed delay after playback ends).

## Call-time face (the only thing visible during a live call)

Deliberately non-technical. No Hz, no note names, no numbers while a call is
active.

- **Vertical gauge**: a shaded band = the user's range, a marker = current
  position, a line = the ceiling. Above the ceiling is plain, unshaded space
  — and the marker *can* sit there: a reading above the ceiling is a live,
  valid, in-detection-band measurement (e.g. screaming), not a rejected one.
  A position, not a word — reads in about one second.
- **One verdict word** under the gauge: "Good" or "Too high" — always paired
  with color, never color alone (blue-to-warm axis, not red-green, so it
  survives the common forms of color-vision deficiency).
- **A volume meter** (segmented bar) + one verdict word: "Good" or "Too
  loud". Same rule: no word for "too quiet" — only a ceiling-style verdict.
- **One button**: "Hear your tone" — plays the reference tone chosen during
  setup, audible only via the user's own headphones, pauses live analysis
  while it plays.
- **Idle state, and how it differs from "too high":** these are two
  different states and must look different. When there's genuinely no
  voiced signal (silence, or a frame gated as too-quiet/no-pitch), the gauge
  marker freezes at its last known position and does not update until a new
  valid reading arrives. When a frame *is* voiced but its pitch is above the
  ceiling (within the wider 65–400 Hz detection band), that is a fresh valid
  reading — the marker moves live into the unshaded zone and "Too high"
  shows immediately. Freezing must never be used to paper over an
  above-ceiling reading.
- Nothing else lives on this face. No history, no live Hz reading, no
  charts.

## Details view (`⋯` / `←`)

A second, separate view — not an expandable section, to avoid layout
overlap — reached via a `⋯` button on the call-time face, with a `←` back
button. Contains everything technical:

- Range picker (two note selects, low/high, bounded to F2–C3)
- Reference-tone picker (select, drawn only from notes inside the range)
- Volume calibration: a "talk normally, then set it" button
- Live Hz + note name readout
- Gate-rejection counters: voiced / too quiet / no pitch / out of range
- History chart: where the voice has spent the session so far

## Detector reliability

The technical system behind the friendly face, built to the same standard
of rigor as prior work in this space:

- **Self-calibrating noise floor**: rather than a fixed loudness threshold,
  the gate learns the room's own 10th-percentile noise floor over a rolling
  ~20-second window, and gates a fixed margin above it (in dB). Bounded by a
  configured min/max so it can't calibrate to something absurd. This means
  no manual tuning ritual, and it works across different microphones.
- **Confidence threshold**: the autocorrelation-based pitch estimate carries
  a confidence score; frames below a tuned minimum are discarded as
  "no pitch" rather than reported as a wrong or noisy value. The threshold
  is set low enough to keep genuinely-voiced-but-quiet frames (this tool
  only needs "inside range vs. above," not lab-grade precision), and no
  lower.
- **One floor value, shared**: the same learned noise floor feeds both the
  pitch gate and the volume meter's "is this speech" check, so the two
  readings never disagree about what counts as voice versus room noise.
- **Gate-rejection categories** are surfaced (not hidden) in the details
  view: voiced / too quiet / no pitch / out of range — so a confusing
  silence has an explanation available on request, even though the
  call-time face stays wordless about it. **"Out of range" here means
  outside the 65–400 Hz detection band** (implausible: noise, octave
  errors, non-speech) — it is not what happens when a voiced reading
  lands above the user's F2–C3 ceiling. Above-ceiling readings count as
  "voiced" and drive the live "Too high" state; they are a measurement
  success, not a rejection.

## Data lifecycle

- **Persists** (via `chrome.storage.local`): range, target note. Set once
  during onboarding, editable later from the details view.
- **Never persists**: any live reading, the session history, gate-rejection
  counts. All memory-only, discarded the moment the call ends. There is no
  `MediaRecorder` and no network call anywhere in the extension.

## Testing approach

- **Synthetic-signal tests** for the estimator: known-frequency tones and
  harmonic-shape variations, checked against expected Hz/note output and
  against the F2–C3 gate boundaries specifically.
- **Noise-floor and confidence-gate tests**: synthetic quiet/loud/silent
  segments, confirming the self-calibration converges and the gate
  categories (voiced / too quiet / no pitch / out of range) sort correctly.
- **Mock Meet page** for panel development: an offline stand-in for Meet's
  layout, used to build and check the Shadow DOM panel without needing a
  live call for every iteration.
- **Live-call verification**, done deliberately and explicitly before
  calling anything final: confirming the MAIN-world mic-permission reuse
  actually avoids a second prompt on a real `meet.google.com` call, and that
  the panel injects, measures, and tears down correctly there. This is
  called out separately because it is the one thing synthetic testing and
  mocks cannot answer.

## Open risks (carried forward, not solved by this design)

- Mic permission reuse (confirmed working from ISOLATED world) still
  depends on Meet's origin already holding a standing "granted" permission;
  a fresh profile or reset permission would still show a normal browser
  prompt at that point — expected, not a bug.
- `echoCancellation: false` / `autoGainControl: false` constraints are not
  guaranteed to be honored by every microphone driver.
- Auto-injecting into `meet.google.com` requires a standing host permission
  in the manifest, which Chrome surfaces at install time; the onboarding
  disclaimer screen needs to explain why, not just what.
- Meet's DOM is not a stable public API; injection selectors may need
  updates if Google changes Meet's layout.
