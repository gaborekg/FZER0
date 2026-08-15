import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseTrend, MIN_SESSIONS_FOR_TREND } from '../src/trend.js';

const TARGET_HZ = 110; // A2

const session = (meanHz, inZoneShare = 0.5) => ({ meanHz, inZoneShare });
const semitonesAbove = (hz, semitones) => hz * 2 ** (semitones / 12);

test('a trend needs four sessions before it says anything', () => {
  for (let count = 0; count < MIN_SESSIONS_FOR_TREND; count++) {
    const summaries = Array.from({ length: count }, () => session(120));
    const trend = summariseTrend(summaries, TARGET_HZ);
    assert.equal(trend.status, 'not-enough', `${count} sessions should not be enough`);
    assert.equal(trend.sessionsRecorded, count);
    assert.equal(trend.sessionsNeeded, MIN_SESSIONS_FOR_TREND - count);
  }
});

test('sessions with no pitch at all do not count towards the four', () => {
  const summaries = [session(120), session(120), { meanHz: null, inZoneShare: null }];
  assert.equal(summariseTrend(summaries, TARGET_HZ).status, 'not-enough');
});

test('moving towards the target reads as closer, whichever side you start from', () => {
  const far = semitonesAbove(TARGET_HZ, 4);
  const near = semitonesAbove(TARGET_HZ, 1);

  const fromAbove = summariseTrend([session(far), session(far), session(near), session(near)], TARGET_HZ);
  assert.equal(fromAbove.pitch.direction, 'closer');
  assert.ok(fromAbove.pitch.closerBySemitones > 2.9);

  const fromBelow = summariseTrend(
    [
      session(semitonesAbove(TARGET_HZ, -4)),
      session(semitonesAbove(TARGET_HZ, -4)),
      session(semitonesAbove(TARGET_HZ, -1)),
      session(semitonesAbove(TARGET_HZ, -1)),
    ],
    TARGET_HZ
  );
  assert.equal(fromBelow.pitch.direction, 'closer');
});

test('drifting away from the target reads as further', () => {
  const near = semitonesAbove(TARGET_HZ, 1);
  const far = semitonesAbove(TARGET_HZ, 5);
  const trend = summariseTrend([session(near), session(near), session(far), session(far)], TARGET_HZ);
  assert.equal(trend.pitch.direction, 'further');
});

test('movement under half a semitone is reported as no change', () => {
  const a = semitonesAbove(TARGET_HZ, 3);
  const b = semitonesAbove(TARGET_HZ, 2.7);
  const trend = summariseTrend([session(a), session(a), session(b), session(b)], TARGET_HZ);
  assert.equal(trend.pitch.direction, 'same');
});

test('crossing the target and overshooting by the same distance is no change', () => {
  // Two semitones above, then two below: the voice moved four semitones, but
  // it is no nearer the target than it was.
  const above = semitonesAbove(TARGET_HZ, 2);
  const below = semitonesAbove(TARGET_HZ, -2);
  const trend = summariseTrend([session(above), session(above), session(below), session(below)], TARGET_HZ);

  assert.equal(trend.pitch.direction, 'same');
  assert.ok(Math.abs(trend.pitch.movedSemitones + 4) < 1e-6, 'it did move, though');
});

test('time in the zone is compared in percentage points', () => {
  const trend = summariseTrend(
    [session(110, 0.2), session(110, 0.2), session(110, 0.5), session(110, 0.5)],
    TARGET_HZ
  );
  assert.equal(trend.inZone.direction, 'up');
  assert.ok(Math.abs(trend.inZone.deltaPoints - 30) < 1e-9);
});

test('a small change in time in the zone is reported as no change', () => {
  const trend = summariseTrend(
    [session(110, 0.5), session(110, 0.5), session(110, 0.53), session(110, 0.53)],
    TARGET_HZ
  );
  assert.equal(trend.inZone.direction, 'same');
});

test('only the most recent sessions are compared once there are plenty', () => {
  // Ten sessions: the first four are wild, and must not be in the baseline.
  const noise = Array.from({ length: 4 }, () => session(semitonesAbove(TARGET_HZ, 12)));
  const steady = Array.from({ length: 6 }, () => session(TARGET_HZ));
  const trend = summariseTrend([...noise, ...steady], TARGET_HZ);

  assert.equal(trend.sessionsCompared, 3);
  assert.equal(trend.pitch.direction, 'same');
  assert.ok(Math.abs(trend.pitch.earlierHz - TARGET_HZ) < 1e-9);
});
