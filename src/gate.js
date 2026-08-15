import { DETECTION_BAND_HZ } from './note-hz.js';
import { CONFIDENCE_MIN } from './config.js';

export const CATEGORIES = ['voiced', 'too-quiet', 'no-pitch', 'out-of-range'];

export function classifyFrame({ hz, confidence, rms }, { floorRms, confidenceMin = CONFIDENCE_MIN }) {
  if (rms < floorRms) {
    return { category: 'too-quiet', hz: null };
  }
  if (hz === null || confidence < confidenceMin) {
    return { category: 'no-pitch', hz: null };
  }
  if (hz < DETECTION_BAND_HZ.min || hz > DETECTION_BAND_HZ.max) {
    return { category: 'out-of-range', hz: null };
  }
  return { category: 'voiced', hz };
}
