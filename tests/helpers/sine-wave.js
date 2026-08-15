export function generateSineWave(hz, sampleRate, numSamples, amplitude = 0.5) {
  const frame = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    frame[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return frame;
}

export function generateSilence(numSamples) {
  return new Float32Array(numSamples);
}
