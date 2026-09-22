import { describe, expect, it } from 'vitest';
import {
  alreadySentToday, arrivalsSince, FIRST_RUN_REACH_HOURS, WINDOW_OVERLAP_MINUTES,
} from './digestWindow';

const now = new Date('2026-09-22T06:00:00Z');
const hoursBefore = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('arrivalsSince', () => {
  // Reaches back slightly PAST the previous send, not to it: that email queried its rows some
  // seconds before its send was recorded, and the difference belongs to neither window.
  it('reaches back past the previous send, so the seconds it spent sending are not lost', () => {
    const yesterdaysSend = hoursBefore(24);
    const start = arrivalsSince(yesterdaysSend, now);
    expect(start.getTime()).toBe(yesterdaysSend.getTime() - WINDOW_OVERLAP_MINUTES * 60_000);
    expect(start.getTime()).toBeLessThan(yesterdaysSend.getTime());
  });

  // The failure this module exists to remove: a window that cannot reach back far enough covers
  // part of an outage and drops the rest.
  it('reaches across a missed run rather than capping the window', () => {
    const twoWeeksAgo = hoursBefore(24 * 14);
    expect(arrivalsSince(twoWeeksAgo, now).getTime())
      .toBe(twoWeeksAgo.getTime() - WINDOW_OVERLAP_MINUTES * 60_000);
  });

  it('falls back to a wide reach when nothing has ever been delivered', () => {
    expect(arrivalsSince(null, now)).toEqual(hoursBefore(FIRST_RUN_REACH_HOURS));
  });

  // A future anchor yields an empty window, and an email reporting that nothing happened is worse
  // than one reporting too much: the first is believed.
  it('distrusts an anchor in the future instead of reporting an empty day', () => {
    expect(arrivalsSince(hoursBefore(-5), now)).toEqual(hoursBefore(FIRST_RUN_REACH_HOURS));
    expect(arrivalsSince(now, now)).toEqual(hoursBefore(FIRST_RUN_REACH_HOURS));
  });

  it('treats an unparseable date as absent', () => {
    expect(arrivalsSince(new Date('nonsense'), now)).toEqual(hoursBefore(FIRST_RUN_REACH_HOURS));
  });

  it('is three days on a first run, and overlaps the previous send by five minutes', () => {
    expect(FIRST_RUN_REACH_HOURS).toBe(72);
    expect(WINDOW_OVERLAP_MINUTES).toBe(5);
  });
});

describe('alreadySentToday', () => {
  const morning = new Date('2026-09-22T06:00:00');

  it('is false when nothing has ever been delivered', () => {
    expect(alreadySentToday(null, morning)).toBe(false);
  });

  // The restart case: runDailyJob fires once on startup, so without this a reboot posts a second
  // email on a day already served.
  it('is true for an earlier send on the same local day', () => {
    expect(alreadySentToday(new Date('2026-09-22T05:59:00'), morning)).toBe(true);
    expect(alreadySentToday(new Date('2026-09-22T00:00:01'), morning)).toBe(true);
  });

  it('is false for yesterday, however few minutes ago that was', () => {
    expect(alreadySentToday(new Date('2026-09-21T23:59:59'), morning)).toBe(false);
  });

  // A stepped clock must not be able to mute the digest indefinitely.
  it('does not treat a future send as today having been served', () => {
    expect(alreadySentToday(new Date('2026-09-23T06:00:00'), morning)).toBe(false);
  });

  it('treats an unparseable date as absent', () => {
    expect(alreadySentToday(new Date('nonsense'), morning)).toBe(false);
  });
});
