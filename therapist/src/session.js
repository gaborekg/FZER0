import { CATEGORIES } from './gate.js';

const EMPTY_COUNTS = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));

// Frames arrive ~20x a second, so an unbounded history would grow to tens of
// thousands of entries over a long call — and every chart redraw copies it.
// Counts are tracked separately, so dropping the oldest entries costs nothing
// but the far end of the chart.
const MAX_HISTORY_ENTRIES = 5000;

export function createSession() {
  let counts = { ...EMPTY_COUNTS };
  let history = [];

  function record({ category, hz }, timestampMs) {
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Unrecognized category: ${category}`);
    }
    counts[category] += 1;
    history.push({ timestampMs, category, hz });
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.shift();
    }
  }

  function getCounts() {
    return { ...counts };
  }

  function getHistory() {
    return history.slice();
  }

  function reset() {
    counts = { ...EMPTY_COUNTS };
    history = [];
  }

  return { record, getCounts, getHistory, reset };
}
