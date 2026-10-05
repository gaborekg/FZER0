// The microphone for Measure. It opens on Start and closes on Stop; the same
// stream feeds the take and its audio: one microphone, not two.
import { createNoiseFloor } from './src/noise-floor.js';
import { classifyFrame } from './src/gate.js';
import { volumeLevel } from './src/gauge.js';
import { hzToNote } from './src/note-hz.js';
import { createSessionRecorder } from './src/session-recorder.js';
import { VOLUME_CEILING_RMS } from './src/config.js';
import { startCapture } from './app/audio.js';
import { canRecordAudio, startAudioRecording } from './app/audio-recorder.js';
import { createPitchSmoother } from './pitch-smoother.js';
import { createSplMeter, micOf, rememberMic, volumeFields } from './spl.js';

// A voice heard within this long still counts as "hearing the patient".
const HEARD_FOR_MS = 800;
// The circle follows loudness quickly when it rises and eases off when it
// falls, so it breathes with the voice instead of twitching with each frame.
const LEVEL_ATTACK = 0.5;
const LEVEL_RELEASE = 0.12;

export function createLiveMic(getProfile) {
  let capture = null;
  let opening = null;
  let noiseFloor = createNoiseFloor();
  let recorder = null;
  let audio = null;
  let spl = null;
  const smoother = createPitchSmoother();
  let last = { level: 0, heardAtMs: 0 };

  function onFrame(frame) {
    const now = Date.now();
    noiseFloor.addSample(frame.rms, now);
    const floorRms = noiseFloor.getFloor();
    const classified = classifyFrame(frame, { floorRms });
    const ceilingRms = getProfile().volumeCeilingRms ?? VOLUME_CEILING_RMS;
    const level = volumeLevel(frame.rms, { floorRms, ceilingRms });
    const voiced = classified.category === 'voiced';
    spl?.add(frame.rms, voiced, now);
    if (voiced) smoother.add(classified.hz, now);
    const ease = level > last.level ? LEVEL_ATTACK : LEVEL_RELEASE;
    last = {
      level: last.level + (level - last.level) * ease,
      heardAtMs: voiced ? now : last.heardAtMs,
    };
    // Driven from here, not from a timer: a hidden tab slows timers down but
    // keeps delivering audio frames. Volume is measured by spl.js instead.
    recorder?.observe({ note: voiced ? hzToNote(classified.hz) : null, hz: voiced ? classified.hz : null, db: null }, now);
  }

  return {
    async open() {
      if (capture) return;
      if (!opening) {
        opening = startCapture(onFrame)
          .then((c) => {
            capture = c;
            noiseFloor = createNoiseFloor();
            smoother.reset();
            last = { level: 0, heardAtMs: 0 };
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
    // hz is the median of the last second of voice (see pitch-smoother.js),
    // held between words. The take itself records every frame unsmoothed.
    reading() {
      const now = Date.now();
      return { ...last, hz: smoother.hz(now), hearing: now - last.heardAtMs < HEARD_FOR_MS };
    },
    startTake(notes) {
      recorder = createSessionRecorder(notes);
      spl = createSplMeter();
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
      const finished = recorder ? recorder.finish(finishOptions) : null;
      const mic = micOf(capture?.stream);
      rememberMic(mic);
      const summary = finished ? { ...finished, ...volumeFields(spl.result(), mic) } : null;
      recorder = null;
      spl = null;
      return { summary, blob };
    },
    isTaking: () => recorder !== null,
  };
}
