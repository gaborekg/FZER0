# Design record

These four documents were written while the extension was being built, when it
was still called **FNDMNTL**. They are kept unedited — the name in them is not a
mistake to fix, it is what the project was called at the time.

- `specs/2026-08-14-fndmntl-v1-design.md` — the original v1 design.
- `plans/2026-08-14-fndmntl-detection-engine.md` — pitch detection and the
  volume gate.
- `plans/2026-08-15-fndmntl-extension-shell-onboarding.md` — manifest, service
  worker, onboarding.
- `plans/2026-08-15-fndmntl-incall-panel.md` — the first in-call panel.

They describe the reasoning behind `src/`, which has barely changed since, so
they are still the best explanation of *why* the detection works the way it
does.

They do **not** describe the current interface. Everything in `extension/panel/`
was redesigned afterwards — the note ladder became a dB dial plus a per-note bar
chart, with Current/Average/Target readouts, a target zone, a minimized ribbon
and a draggable panel. For the interface as it stands, read the README at the
root of the project, and the code.
