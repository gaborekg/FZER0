import { noteToHz } from './note-hz.js';

const DEFAULT_TONE_GAIN = 0.2;

export function createTonePlayer(audioContextFactory = () => new AudioContext()) {
  let audioContext = null;

  function play(note, { durationMs = 1200, gain = DEFAULT_TONE_GAIN, onStart, onEnd } = {}) {
    if (!audioContext) {
      audioContext = audioContextFactory();
    }
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = noteToHz(note);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = gain;
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    if (onStart) onStart();
    oscillator.start();
    oscillator.stop(audioContext.currentTime + durationMs / 1000);
    oscillator.onended = () => {
      if (onEnd) onEnd();
    };
  }

  return { play };
}
