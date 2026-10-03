export function computeCeilingFromSamples(rmsSamples) {
  if (rmsSamples.length === 0) {
    throw new Error('Cannot calibrate from an empty sample list');
  }
  const sorted = [...rmsSamples].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (sorted.length - 1));
  return sorted[idx] * 1.5;
}

// The median of the same "talk normally" samples — a typical comfortable
// speaking level, distinct from the ceiling (which is deliberately above
// normal speech, to flag only when the user goes louder than usual).
export function computeTypicalFromSamples(rmsSamples) {
  if (rmsSamples.length === 0) {
    throw new Error('Cannot calibrate from an empty sample list');
  }
  const sorted = [...rmsSamples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
