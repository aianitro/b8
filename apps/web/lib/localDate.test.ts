import { describe, it, expect } from 'vitest';
import { localIsoDate } from './localDate';

describe('localIsoDate', () => {
  it('uses the local calendar, not UTC', () => {
    // 9pm local on Oct 6 — the hour a UTC date would already call the 7th west of Greenwich.
    expect(localIsoDate(new Date(2026, 9, 6, 21, 0))).toBe('2026-10-06');
  });

  it('pads month and day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});
