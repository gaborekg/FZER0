export function gaugePosition(hz, { rangeLowHz, rangeHighHz }) {
  if (hz === null) return null;
  return (hz - rangeLowHz) / (rangeHighHz - rangeLowHz);
}

export function gaugeVerdict(position) {
  if (position === null) return null;
  return position > 1 ? 'Too high' : 'Good';
}

export function volumeLevel(rms, { floorRms, ceilingRms }) {
  if (rms === null) return null;
  const level = (rms - floorRms) / (ceilingRms - floorRms);
  return Math.max(0, Math.min(1, level));
}

export function volumeVerdict(rms, ceilingRms) {
  if (rms === null) return null;
  return rms > ceilingRms ? 'Too loud' : 'Good';
}
