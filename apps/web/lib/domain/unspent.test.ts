import { describe, expect, it } from 'vitest';
import { checkMove, closeSchedule, closedMonths, leftover, UNSPENT_START } from './unspent';

describe('closedMonths', () => {
  it('starts at the owner\'s start month, and closes last month only after its grace days', () => {
    expect(UNSPENT_START).toEqual({ year: 2026, month: 9 });
    expect(closedMonths({ year: 2026, month: 9, day: 20 })).toEqual([]);
    expect(closedMonths({ year: 2026, month: 10, day: 3 })).toEqual([]);
    expect(closedMonths({ year: 2026, month: 10, day: 4 })).toEqual([{ year: 2026, month: 9 }]);
    expect(closedMonths({ year: 2027, month: 2, day: 10 })).toEqual([
      { year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 },
      { year: 2026, month: 12 }, { year: 2027, month: 1 },
    ]);
    expect(closedMonths({ year: 2027, month: 2, day: 1 }).at(-1)).toEqual({ year: 2026, month: 12 });
  });
});

describe('closedMonths without the grace', () => {
  // What "Close now" reaches. The month now running is never in it, whatever the grace: its
  // `actual` is a part-month figure, and a close is written once.
  it('reaches every month that has ended, and never the one running', () => {
    expect(closedMonths({ year: 2026, month: 11, day: 2 }, UNSPENT_START, 0)).toEqual([
      { year: 2026, month: 9 }, { year: 2026, month: 10 },
    ]);
    expect(closedMonths({ year: 2026, month: 10, day: 1 }, UNSPENT_START, 0)).toEqual([{ year: 2026, month: 9 }]);
    expect(closedMonths({ year: 2026, month: 9, day: 30 }, UNSPENT_START, 0)).toEqual([]);
  });
});

describe('closeSchedule', () => {
  const sep = { year: 2026, month: 9 };
  const oct = { year: 2026, month: 10 };

  // The state the owner hit: September closed and allocated to the cent, October over but still
  // inside its grace days, so no bucket is waiting and the card had nothing to say.
  it('names the ended month still waiting, and the day the job will take it', () => {
    const s = closeSchedule({ year: 2026, month: 11, day: 2 }, [sep]);
    expect(s.pending).toEqual([oct]);
    expect(s.next).toEqual(oct);
    expect(s.closesOn).toEqual({ year: 2026, month: 11, day: 4 });
    expect(s.ready).toBe(false);
  });

  it('calls a month past its grace ready, which is the job being late rather than the owner early', () => {
    const s = closeSchedule({ year: 2026, month: 11, day: 9 }, [sep]);
    expect(s.pending).toEqual([oct]);
    expect(s.ready).toBe(true);
  });

  it('looks ahead to the running month once nothing has ended unclosed', () => {
    const s = closeSchedule({ year: 2026, month: 11, day: 20 }, [sep, oct]);
    expect(s.pending).toEqual([]);
    expect(s.next).toEqual({ year: 2026, month: 11 });
    expect(s.closesOn).toEqual({ year: 2026, month: 12, day: 4 });
    expect(s.ready).toBe(false);
  });

  it('carries the next close into the following year from December', () => {
    const s = closeSchedule({ year: 2026, month: 12, day: 20 }, [sep, oct, { year: 2026, month: 11 }]);
    expect(s.next).toEqual({ year: 2026, month: 12 });
    expect(s.closesOn).toEqual({ year: 2027, month: 1, day: 4 });
  });

  it('lists every unclosed month when the job has been down, earliest first', () => {
    const s = closeSchedule({ year: 2027, month: 1, day: 10 }, [sep]);
    expect(s.pending).toEqual([oct, { year: 2026, month: 11 }, { year: 2026, month: 12 }]);
    expect(s.next).toEqual(oct);
    expect(s.ready).toBe(true);
  });
});

describe('leftover', () => {
  it('is the unspent part to the cent, and nothing for a month spent in full or over', () => {
    expect(leftover(100, 60.5)).toBe(39.5);
    expect(leftover(100, 100)).toBe(0);
    expect(leftover(100, 130)).toBe(0);
    expect(leftover(0.3, 0.1)).toBe(0.2);
  });
});

describe('checkMove', () => {
  const today = { year: 2026, month: 10 };
  it('allows the whole balance, into this month or later, or a release', () => {
    expect(checkMove({ amount: 40.1, balance: 40.1, action: 'carry', to: { year: 2026, month: 10 }, today })).toEqual({ ok: true });
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', to: { year: 2027, month: 1 }, today })).toEqual({ ok: true });
    expect(checkMove({ amount: 5, balance: 40, action: 'release', today })).toEqual({ ok: true });
  });
  it('refuses nothing, too much, a closed month, or a carry with nowhere to go', () => {
    expect(checkMove({ amount: 0, balance: 40, action: 'release', today }).ok).toBe(false);
    expect(checkMove({ amount: 40.11, balance: 40.1, action: 'release', today }).ok).toBe(false);
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', to: { year: 2026, month: 9 }, today }).ok).toBe(false);
    expect(checkMove({ amount: 5, balance: 40, action: 'carry', today }).ok).toBe(false);
  });
});
