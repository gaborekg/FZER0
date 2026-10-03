// The microphone for Measure. It opens on Ready, so the therapist can see it
// hears the patient before anything is recorded. After Start the same stream
// feeds the take: one microphone, not two.
import { createNoiseFloor } from './src/noise-floor.js';
import { classifyFrame } from './src/gate.js';
import { volumeLevel } from './src/gauge.js';
import { dbFromLevel } from './src/db-meter.js';
import { hzToNote } from './src/note-hz.js';
import { createSessionRecorder } from './src/session-recorder.js';
import { VOLUME_CEILING_RMS } from './src/config.js';
import { startCapture } from './app/audio.js';
import { canRecordAudio, startAudioRecording } from './app/audio-recorder.js';

// A voice heard within this long still counts as "hearing the patient".
const HEARD_FOR_MS = 800;

export function createLiveMic(getProfile) {
  let capture = null;
  let opening = null;
  let noiseFloor = createNoiseFloor();
  let recorder = null;
  let audio = null;
  let last = { hz: null, level: 0, db: null, heardAtMs: 0 };

  function onFrame(frame) {
    const now = Date.now();
    noiseFloor.addSample(frame.rms, now);
    const floorRms = noiseFloor.getFloor();
    const classified = classifyFrame(frame, { floorRms });
    const ceilingRms = getProfile().volumeCeilingRms ?? VOLUME_CEILING_RMS;
    const level = volumeLevel(frame.rms, { floorRms, ceilingRms });
    const db = dbFromLevel(level);
    const voiced = classified.category === 'voiced';
    last = {
      hz: voiced ? classified.hz : last.hz,
      level,
      db,
      heardAtMs: voiced ? now : last.heardAtMs,
    };
    // Driven from here, not from a timer: a hidden tab slows timers down but
    // keeps delivering audio frames.
    recorder?.observe({ note: voiced ? hzToNote(classified.hz) : null, hz: voiced ? classified.hz : null, db }, now);
  }

  return {
    async open() {
      if (capture) return;
      if (!opening) {
        opening = startCapture(onFrame)
          .then((c) => {
            capture = c;
            noiseFloor = createNoiseFloor();
            last = { hz: null, level: 0, db: null, heardAtMs: 0 };
          })
          .finally(() => {
            opening = null;
          });
      }
      await opening;
    },
    async close() {
      if (opening) await opening.catch(() => {});
      const c = capture;
      capture = null;
      await c?.stop();
    },
    isOpen: () => capture !== null,
    isRunning: () => capture?.isRunning() ?? false,
    resume: () => capture?.resume(),
    reading() {
      return { ...last, hearing: Date.now() - last.heardAtMs < HEARD_FOR_MS };
    },
    startTake(notes) {
      recorder = createSessionRecorder(notes);
      audio = null;
      let audioFailed = !canRecordAudio();
      if (!audioFailed) {
        try {
          audio = startAudioRecording(capture.stream);
        } catch {
          audioFailed = true;
        }
      }
      return { audioFailed };
    },
    // The audio recorder stops first: stopping the microphone first can lose
    // its last chunk.
    async stopTake(finishOptions) {
      const blob = audio ? await audio.stop().catch(() => null) : null;
      audio = null;
      const summary = recorder ? recorder.finish(finishOptions) : null;
      recorder = null;
      return { summary, blob };
    },
    isTaking: () => recorder !== null,
  };
}
